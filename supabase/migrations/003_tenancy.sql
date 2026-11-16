-- 003: Tenancy root. Adds `schools` and a `school_id` on every tenant table.
-- Data-preserving: the existing school_settings row becomes the first school and
-- every existing row is assigned to it. Existing policies keep working (single
-- school); 005 rewrites them to scope by school.
-- Apply 003–006 together with the matching frontend + Edge Function release.

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null check (length(trim(name_ar)) > 0),
  education_department_ar text not null check (length(trim(education_department_ar)) > 0),
  region_ar text,
  logo_url text,
  -- center_administrator_name, principal_name, current_semester (1|2),
  -- booking_window_days, footer_copyright, footer_credit
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger schools_set_updated_at
  before update on public.schools
  for each row execute function public.set_updated_at();

-- Fixed id for the original school so backfills are deterministic.
insert into public.schools (id, name_ar, education_department_ar, region_ar, settings)
select
  '00000000-0000-4000-8000-000000000001',
  s.school_name,
  s.education_authority,
  s.region_name,
  jsonb_build_object(
    'center_administrator_name', s.center_administrator_name,
    'principal_name', s.principal_name,
    'current_semester', 1,
    'booking_window_days', 30,
    'footer_copyright', 'جميع الحقوق محفوظة © {hijri_year}هـ',
    'footer_credit', null
  )
from public.school_settings as s
where s.id = 1
on conflict (id) do nothing;

alter table public.profiles add column school_id uuid references public.schools (id) on delete restrict;
alter table public.bookings add column school_id uuid references public.schools (id) on delete restrict;
alter table public.blocked_slots add column school_id uuid references public.schools (id) on delete restrict;

-- Triggers on these tables reject writes without an app session, so they are
-- disabled for the backfill only.
alter table public.profiles disable trigger user;
alter table public.bookings disable trigger user;
update public.profiles set school_id = '00000000-0000-4000-8000-000000000001' where school_id is null;
update public.bookings set school_id = '00000000-0000-4000-8000-000000000001' where school_id is null;
update public.blocked_slots set school_id = '00000000-0000-4000-8000-000000000001' where school_id is null;
alter table public.profiles enable trigger user;
alter table public.bookings enable trigger user;

alter table public.profiles alter column school_id set not null;
alter table public.bookings alter column school_id set not null;
alter table public.blocked_slots alter column school_id set not null;

create index profiles_school_idx on public.profiles (school_id);
create index bookings_school_date_idx on public.bookings (school_id, booking_date);
create index blocked_slots_school_date_idx on public.blocked_slots (school_id, blocked_date);

-- School of the signed-in, active user. SECURITY DEFINER for the same reason as
-- current_app_role(): policies must not recurse into profiles' own RLS.
create or replace function public.current_school_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.school_id
  from public.profiles as p
  where p.id = auth.uid()
    and p.is_active = true
  limit 1
$$;

revoke all on function public.current_school_id() from public, anon;
grant execute on function public.current_school_id() to authenticated;

-- New rows default to the caller's school; RLS (005) rejects any other value.
alter table public.bookings alter column school_id set default public.current_school_id();
alter table public.blocked_slots alter column school_id set default public.current_school_id();

-- Invited users get the school passed in user metadata by admin-invite-user.
-- With exactly one school (today), it is used as the fallback.
create or replace function public.provision_inactive_teacher_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
  target_school uuid;
begin
  profile_name :=
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'مستخدم جديد'
    );

  select s.id into target_school
  from public.schools as s
  where s.id::text = new.raw_user_meta_data ->> 'school_id';

  if target_school is null and (select count(*) from public.schools) = 1 then
    select s.id into target_school from public.schools as s;
  end if;

  if target_school is null then
    raise exception using errcode = '23514', message = 'A school is required to create an account.';
  end if;

  insert into public.profiles (id, full_name, role, is_active, school_id)
  values (new.id, profile_name, 'teacher', false, target_school)
  on conflict (id) do nothing;

  return new;
end;
$$;
