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
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'Profile identity fields cannot be changed.';
  end if;

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

create or replace function public.prevent_last_active_admin_lockout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin'
     and old.is_active
     and (new.role <> 'admin' or not new.is_active) then
    perform pg_catalog.pg_advisory_xact_lock(741852963);
    if not exists (
      select 1
      from public.profiles as p
      where p.id <> old.id
        and p.role = 'admin'
        and p.is_active
    ) then
      raise exception using errcode = '23514', message = 'The last active administrator cannot be demoted or deactivated.';
    end if;
  end if;
  return new;
end;
$$;

create trigger prevent_last_active_admin_lockout
  before update on public.profiles
  for each row execute function public.prevent_last_active_admin_lockout();

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
    if new.status <> 'confirmed' then
      raise exception using errcode = '23514', message = 'New bookings must start as confirmed.';
    end if;
    if app_role = 'teacher' and new.teacher_id <> auth.uid() then
      raise exception using errcode = '42501', message = 'Teachers may only create their own bookings.';
    end if;
    if app_role = 'admin' and not exists (
      select 1 from public.profiles as p
      where p.id = new.teacher_id and p.role = 'teacher' and p.is_active
    ) then
      raise exception using errcode = '23514', message = 'Bookings must be assigned to an active teacher.';
    end if;
    if new.booking_date <= (now() at time zone 'Asia/Riyadh')::date then
      raise exception using errcode = '23514', message = 'Bookings must be scheduled for a future date.';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.booking_date::text || ':' || new.period_number::text, 0)
    );
  elsif app_role = 'teacher' then
    if old.teacher_id <> auth.uid()
       or old.status <> 'confirmed'
       or new.status <> 'cancelled'
       or old.booking_date <= (now() at time zone 'Asia/Riyadh')::date then
      raise exception using errcode = '42501', message = 'Teachers may only cancel their own future confirmed bookings.';
    end if;
    if (to_jsonb(new) - 'status' - 'updated_at') is distinct from
       (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception using errcode = '42501', message = 'Teachers cannot edit booking details.';
    end if;
  elsif app_role <> 'admin' then
    raise exception using errcode = '42501', message = 'This role cannot update bookings.';
  elsif tg_op = 'UPDATE' then
    if old.id is distinct from new.id
       or old.created_at is distinct from new.created_at
       or old.teacher_id is distinct from new.teacher_id
       or old.booking_date is distinct from new.booking_date
       or old.period_number is distinct from new.period_number
       or old.subject is distinct from new.subject
       or old.education_stage is distinct from new.education_stage
       or old.grade is distinct from new.grade
       or old.section is distinct from new.section
       or old.lesson_topic is distinct from new.lesson_topic
       or old.resources is distinct from new.resources
       or old.student_count is distinct from new.student_count
       or old.notes is distinct from new.notes then
      raise exception using errcode = '42501', message = 'Administrators may only update booking status.';
    end if;
    if old.status <> 'confirmed' or new.status not in ('completed', 'cancelled', 'not_completed') then
      raise exception using errcode = '42501', message = 'Only confirmed bookings may be completed, cancelled, or marked not completed.';
    end if;
    if new.status in ('completed', 'not_completed')
       and new.booking_date > (now() at time zone 'Asia/Riyadh')::date then
      raise exception using errcode = '23514', message = 'A future booking cannot be marked completed.';
    end if;
  end if;

  if tg_op = 'INSERT' and new.status in ('confirmed', 'completed', 'not_completed')
     and new.booking_date < (now() at time zone 'Asia/Riyadh')::date then
    raise exception using errcode = '23514', message = 'Active bookings cannot be scheduled in the past.';
  end if;

  if tg_op = 'INSERT' and extract(dow from new.booking_date) in (5, 6) then
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
declare
  lock_period integer;
begin
  if public.current_app_role() <> 'admin' then
    raise exception using errcode = '42501', message = 'Only administrators may manage blocked periods.';
  end if;

  if tg_op <> 'INSERT' then
    raise exception using errcode = '42501', message = 'Blocked periods cannot be edited.';
  end if;

  if new.blocked_date <= (now() at time zone 'Asia/Riyadh')::date
     or extract(dow from new.blocked_date) in (5, 6) then
    raise exception using errcode = '23514', message = 'Blocks must be scheduled for a future school day.';
  end if;

  if new.period_number is null then
    for lock_period in select generate_series(1, 7) order by 1 loop
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(new.blocked_date::text || ':' || lock_period::text, 0)
      );
    end loop;
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.blocked_date::text || ':' || new.period_number::text, 0)
    );
  end if;

  if new.period_number is null and exists (
    select 1 from public.blocked_slots
    where blocked_date = new.blocked_date and period_number is not null
      and (tg_op = 'INSERT' or id <> new.id)
  ) then
    raise exception using errcode = '23514', message = 'A whole-day block conflicts with existing period blocks.';
  end if;

  if new.period_number is not null and exists (
    select 1 from public.blocked_slots
    where blocked_date = new.blocked_date and period_number is null
      and (tg_op = 'INSERT' or id <> new.id)
  ) then
    raise exception using errcode = '23514', message = 'A period block conflicts with an existing whole-day block.';
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
  before insert on public.blocked_slots
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
    or (public.current_app_role() = 'teacher' and teacher_id = auth.uid() and status = 'confirmed' and booking_date > (now() at time zone 'Asia/Riyadh')::date)
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
grant select, insert, delete on public.blocked_slots to authenticated;
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
)
on conflict (id) do nothing;
