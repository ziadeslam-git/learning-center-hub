-- Learning Resources Center Booking Platform
-- Run once in Supabase SQL Editor on a new project.
-- No data is deleted by this migration.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  role text not null check (role in ('teacher', 'admin', 'principal')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  booking_date date not null,
  period_number integer not null check (period_number between 1 and 7),
  subject text not null check (length(trim(subject)) > 0),
  education_stage text not null check (education_stage in ('متوسط', 'ثانوي')),
  grade text not null check (length(trim(grade)) > 0),
  section text,
  lesson_topic text not null check (length(trim(lesson_topic)) > 0),
  resources text[] not null default '{}',
  student_count integer check (student_count is null or student_count > 0),
  notes text,
  status text not null check (status in ('confirmed', 'completed', 'cancelled', 'not_completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.school_settings (
  id integer primary key check (id = 1),
  school_name text not null,
  education_authority text not null,
  region_name text not null,
  center_administrator_name text not null,
  principal_name text not null,
  periods_per_day integer not null default 7 check (periods_per_day = 7),
  updated_at timestamptz not null default now()
);

create table public.blocked_slots (
  id uuid primary key default gen_random_uuid(),
  blocked_date date not null,
  period_number integer check (period_number is null or period_number between 1 and 7),
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);

create index bookings_teacher_date_idx on public.bookings (teacher_id, booking_date);
create index bookings_date_status_idx on public.bookings (booking_date, status);
create index blocked_slots_date_idx on public.blocked_slots (blocked_date);

-- A cancelled record no longer occupies a period. Every other status does.
create unique index bookings_active_period_unique
  on public.bookings (booking_date, period_number)
  where status in ('confirmed', 'completed', 'not_completed');

create unique index blocked_slots_period_unique
  on public.blocked_slots (blocked_date, period_number)
  where period_number is not null;

create unique index blocked_slots_whole_day_unique
  on public.blocked_slots (blocked_date)
  where period_number is null;

-- The role helper is SECURITY DEFINER so policies can check the current user's
-- profile without recursively invoking the profiles table's own RLS policies.
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = auth.uid()
    and p.is_active = true
  limit 1
$$;

revoke all on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated;

create or replace function public.provision_inactive_teacher_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
begin
  profile_name :=
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'مستخدم جديد'
    );

  insert into public.profiles (id, full_name, role, is_active)
  values (new.id, profile_name, 'teacher', false)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger auth_user_profile_provision
  after insert on auth.users
  for each row execute function public.provision_inactive_teacher_profile();

create or replace function public.protect_profile_self_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() = old.id
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception using errcode = '42501', message = 'Users cannot change their own role or active state.';
  end if;
  return new;
end;
$$;

create trigger protect_profile_self_changes
  before update on public.profiles
  for each row execute function public.protect_profile_self_changes();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

create trigger school_settings_set_updated_at
  before update on public.school_settings
  for each row execute function public.set_updated_at();

create or replace function public.validate_booking_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_role text;
begin
  app_role := public.current_app_role();
  if app_role is null then
    raise exception using errcode = '42501', message = 'An active school profile is required.';
  end if;

  if tg_op = 'INSERT' then
    if app_role not in ('teacher', 'admin') then
      raise exception using errcode = '42501', message = 'This role cannot create bookings.';
    end if;
    if app_role = 'teacher' and new.teacher_id <> auth.uid() then
      raise exception using errcode = '42501', message = 'Teachers may only create their own bookings.';
    end if;
    if new.booking_date < current_date then
      raise exception using errcode = '23514', message = 'Bookings cannot be created for past dates.';
    end if;
  elsif app_role = 'teacher' then
    if old.teacher_id <> auth.uid()
       or old.status <> 'confirmed'
       or new.status <> 'cancelled'
       or old.booking_date <= current_date then
      raise exception using errcode = '42501', message = 'Teachers may only cancel their own future confirmed bookings.';
    end if;
    if (to_jsonb(new) - 'status' - 'updated_at') is distinct from
       (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception using errcode = '42501', message = 'Teachers cannot edit booking details.';
    end if;
  elsif app_role <> 'admin' then
    raise exception using errcode = '42501', message = 'This role cannot update bookings.';
  end if;

  if extract(dow from new.booking_date) in (5, 6) then
    raise exception using errcode = '23514', message = 'Bookings are only available Sunday through Thursday.';
  end if;

  if new.status in ('confirmed', 'completed', 'not_completed')
     and exists (
       select 1
       from public.blocked_slots as b
       where b.blocked_date = new.booking_date
         and (b.period_number is null or b.period_number = new.period_number)
     ) then
    raise exception using errcode = '23514', message = 'The requested period is blocked.';
  end if;

  return new;
end;
$$;

create trigger validate_booking_write
  before insert or update on public.bookings
  for each row execute function public.validate_booking_write();

create or replace function public.validate_blocked_slot_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() <> 'admin' then
    raise exception using errcode = '42501', message = 'Only administrators may manage blocked periods.';
  end if;

  if exists (
    select 1
    from public.bookings as b
    where b.booking_date = new.blocked_date
      and b.status in ('confirmed', 'completed', 'not_completed')
      and (new.period_number is null or b.period_number = new.period_number)
      and (tg_op = 'INSERT' or b.id <> new.id)
  ) then
    raise exception using errcode = '23514', message = 'An active booking already uses this period.';
  end if;
  return new;
end;
$$;

create trigger validate_blocked_slot_write
  before insert or update on public.blocked_slots
  for each row execute function public.validate_blocked_slot_write();

alter table public.profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.school_settings enable row level security;
alter table public.blocked_slots enable row level security;

create policy profiles_read_scoped
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_app_role() in ('admin', 'principal'));

create policy profiles_update_admin
  on public.profiles for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy bookings_read_scoped
  on public.bookings for select to authenticated
  using (
    public.current_app_role() in ('admin', 'principal')
    or (public.current_app_role() = 'teacher' and teacher_id = auth.uid())
  );

create policy bookings_insert_teacher_or_admin
  on public.bookings for insert to authenticated
  with check (
    public.current_app_role() = 'admin'
    or (public.current_app_role() = 'teacher' and teacher_id = auth.uid())
  );

create policy bookings_update_teacher_or_admin
  on public.bookings for update to authenticated
  using (
    public.current_app_role() = 'admin'
    or (public.current_app_role() = 'teacher' and teacher_id = auth.uid() and status = 'confirmed' and booking_date > current_date)
  )
  with check (
    public.current_app_role() = 'admin'
    or (public.current_app_role() = 'teacher' and teacher_id = auth.uid() and status = 'cancelled')
  );

create policy school_settings_read_active
  on public.school_settings for select to authenticated
  using (public.current_app_role() in ('teacher', 'admin', 'principal'));

create policy school_settings_update_admin
  on public.school_settings for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy blocked_slots_read_active
  on public.blocked_slots for select to authenticated
  using (public.current_app_role() in ('teacher', 'admin', 'principal'));

create policy blocked_slots_insert_admin
  on public.blocked_slots for insert to authenticated
  with check (public.current_app_role() = 'admin');

create policy blocked_slots_update_admin
  on public.blocked_slots for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy blocked_slots_delete_admin
  on public.blocked_slots for delete to authenticated
  using (public.current_app_role() = 'admin');

-- Teachers need availability, not other teachers' booking details. This view
-- deliberately exposes only date, period, and status to authenticated users.
create view public.occupancy_schedule
with (security_barrier = true)
as
  select b.booking_date, b.period_number, b.status
  from public.bookings as b
  where b.status <> 'cancelled'
    and public.current_app_role() in ('teacher', 'admin', 'principal');

revoke all on public.profiles, public.bookings, public.school_settings, public.blocked_slots from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.bookings to authenticated;
grant select, update on public.school_settings to authenticated;
grant select, insert, update, delete on public.blocked_slots to authenticated;
revoke all on public.occupancy_schedule from public, anon;
grant select on public.occupancy_schedule to authenticated;

insert into public.school_settings (
  id, school_name, education_authority, region_name,
  center_administrator_name, principal_name, periods_per_day
) values (
  1,
  'مدرسة الإمام تركي بن عبدالله بالربوعة',
  'الإدارة العامة للتعليم بمنطقة عسير',
  'منطقة عسير',
  'أمين مركز مصادر التعلم',
  'قائد المدرسة',
  7
);
