-- 005: Roles (admin → coordinator, + super_admin), bookings v2, and every
-- policy rewritten to scope by school. Supersedes 002 (initplan fix is applied
-- here by wrapping helpers in sub-selects).
--
-- Data mapping (nothing is deleted):
--   role 'admin'                 → 'coordinator'
--   status 'completed'           → status 'confirmed',  execution_status 'executed'
--   status 'not_completed'       → status 'confirmed',  execution_status 'not_executed'
--   subject/grade/section text   → kept as snapshots; FK columns backfilled by name
--   school_settings              → renamed school_settings_legacy (data lives in schools)

-- Roles ----------------------------------------------------------------------

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles disable trigger user;
update public.profiles set role = 'coordinator' where role = 'admin';
alter table public.profiles enable trigger user;
alter table public.profiles add constraint profiles_role_check
  check (role in ('teacher', 'coordinator', 'principal', 'super_admin'));
alter table public.profiles add column phone text;

create or replace function public.is_school_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'coordinator', false)
$$;

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

  -- Only server-side code (no auth.uid()) may move a profile between schools.
  if auth.uid() is not null and new.school_id is distinct from old.school_id then
    raise exception using errcode = '42501', message = 'A profile cannot change school.';
  end if;

  if auth.uid() = old.id
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception using errcode = '42501', message = 'Users cannot change their own role or active state.';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_last_active_admin_lockout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'coordinator'
     and old.is_active
     and (new.role <> 'coordinator' or not new.is_active) then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coordinator:' || old.school_id::text, 0));
    if not exists (
      select 1
      from public.profiles as p
      where p.id <> old.id
        and p.school_id = old.school_id
        and p.role = 'coordinator'
        and p.is_active
    ) then
      raise exception using errcode = '23514', message = 'The last active coordinator cannot be demoted or deactivated.';
    end if;
  end if;
  return new;
end;
$$;

-- Bookings v2 ----------------------------------------------------------------

drop trigger validate_booking_write on public.bookings;

alter table public.bookings
  add column subject_id uuid references public.subjects (id) on delete restrict,
  add column grade_id smallint references public.grades (id),
  add column section_id uuid references public.sections (id) on delete restrict,
  add column resource_ids uuid[] not null default '{}',
  add column execution_status text not null default 'pending',
  add column cancelled_by uuid references public.profiles (id) on delete set null,
  add column cancelled_at timestamptz,
  add column cancel_reason text;

alter table public.bookings alter column lesson_topic drop not null;
alter table public.bookings drop constraint bookings_status_check;

alter table public.bookings disable trigger user;

update public.bookings
set execution_status = case status
      when 'completed' then 'executed'
      when 'not_completed' then 'not_executed'
      else 'pending'
    end,
    status = case when status in ('completed', 'not_completed') then 'confirmed' else status end;

update public.bookings as b set grade_id = g.id
from public.grades as g where g.name_ar = b.grade;

update public.bookings as b set subject_id = s.id
from public.subjects as s where s.school_id = b.school_id and s.name_ar = b.subject;

update public.bookings as b set section_id = sec.id
from public.sections as sec
where sec.school_id = b.school_id and sec.grade_id = b.grade_id and sec.name_ar = b.section;

-- Old resource labels were shorter than the seeded ones.
update public.bookings as b
set resource_ids = coalesce((
  select array_agg(r.id order by r.sort_order)
  from public.learning_resources as r
  where r.school_id = b.school_id
    and r.name_ar = any (
      select coalesce(alias.new_name, old_name)
      from unnest(b.resources) as old_name
      left join (values
        ('جهاز العرض', 'جهاز العرض التفاعلي'),
        ('برامج المحاكاة', 'برامج المحاكاة التعليمية'),
        ('أخرى', 'مصادر أخرى')
      ) as alias (old, new_name) on alias.old = old_name
    )
), '{}');

alter table public.bookings enable trigger user;

alter table public.bookings
  add constraint bookings_status_check check (status in ('confirmed', 'cancelled')),
  add constraint bookings_execution_status_check check (execution_status in ('pending', 'executed', 'not_executed')),
  add constraint bookings_cancelled_not_executed check (status = 'confirmed' or execution_status = 'pending'),
  add constraint bookings_cancel_reason_check check (cancel_reason is null or length(trim(cancel_reason)) > 0);

-- One confirmed booking per school, date and period.
drop index public.bookings_active_period_unique;
create unique index uq_booking_slot
  on public.bookings (school_id, booking_date, period_number)
  where status = 'confirmed';

-- Blocked slots: holidays vs. one-off closures, scoped by school.
alter table public.blocked_slots
  add column kind text not null default 'closure' check (kind in ('holiday', 'closure'));

drop index public.blocked_slots_period_unique;
drop index public.blocked_slots_whole_day_unique;
create unique index blocked_slots_period_unique
  on public.blocked_slots (school_id, blocked_date, period_number)
  where period_number is not null;
create unique index blocked_slots_whole_day_unique
  on public.blocked_slots (school_id, blocked_date)
  where period_number is null;

create or replace function public.validate_booking_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_role text := public.current_app_role();
  my_school uuid := public.current_school_id();
  today date := (now() at time zone 'Asia/Riyadh')::date;
  now_time time := (now() at time zone 'Asia/Riyadh')::time;
  period_start time;
  window_days integer;
  current_sem smallint;
  period_started boolean;
begin
  if app_role is null or my_school is null then
    raise exception using errcode = '42501', message = 'An active school profile is required.';
  end if;
  if new.school_id is distinct from my_school then
    raise exception using errcode = '42501', message = 'Bookings belong to the user''s own school.';
  end if;

  select p.start_time into period_start
  from public.periods as p
  where p.school_id = new.school_id and p.period_no = new.period_number;

  -- With no configured start time, today's period counts as not yet started.
  period_started := new.booking_date < today
    or (new.booking_date = today and period_start is not null and period_start <= now_time);

  if tg_op = 'INSERT' then
    if app_role not in ('teacher', 'coordinator') then
      raise exception using errcode = '42501', message = 'This role cannot create bookings.';
    end if;
    if new.status <> 'confirmed' or new.execution_status <> 'pending'
       or new.cancelled_by is not null or new.cancelled_at is not null or new.cancel_reason is not null then
      raise exception using errcode = '23514', message = 'New bookings must start as confirmed.';
    end if;
    if app_role = 'teacher' and new.teacher_id <> auth.uid() then
      raise exception using errcode = '42501', message = 'Teachers may only create their own bookings.';
    end if;
    if not exists (
      select 1 from public.profiles as p
      where p.id = new.teacher_id and p.school_id = new.school_id
        and p.is_active and p.role in ('teacher', 'coordinator')
    ) then
      raise exception using errcode = '23514', message = 'Bookings must be assigned to an active teacher of this school.';
    end if;

    if extract(dow from new.booking_date) in (5, 6) then
      raise exception using errcode = '23514', message = 'Bookings are only available Sunday through Thursday.';
    end if;
    if new.booking_date < today then
      raise exception using errcode = '23514', message = 'Bookings cannot be made in the past.';
    end if;
    if period_started then
      raise exception using errcode = '23514', message = 'This period has already started.';
    end if;

    select coalesce((s.settings ->> 'booking_window_days')::integer, 30),
           coalesce((s.settings ->> 'current_semester')::smallint, 1)
      into window_days, current_sem
    from public.schools as s where s.id = new.school_id;
    if new.booking_date > today + window_days then
      raise exception using errcode = '23514', message = 'The booking date is beyond the booking window.';
    end if;

    if new.grade_id is null or new.subject_id is null or new.section_id is null then
      raise exception using errcode = '23514', message = 'Subject, grade and section are required.';
    end if;
    if not exists (
      select 1 from public.sections as sec
      where sec.id = new.section_id and sec.school_id = new.school_id
        and sec.grade_id = new.grade_id and sec.is_active
    ) then
      raise exception using errcode = '23514', message = 'The section does not belong to this grade.';
    end if;
    if not exists (
      select 1
      from public.grade_subjects as gs
      join public.subjects as s on s.id = gs.subject_id
      where gs.school_id = new.school_id and gs.grade_id = new.grade_id
        and gs.subject_id = new.subject_id and gs.semester = current_sem and s.is_active
    ) then
      raise exception using errcode = '23514', message = 'The subject is not in this grade''s current study plan.';
    end if;
    if exists (
      select 1 from unnest(new.resource_ids) as rid
      where not exists (
        select 1 from public.learning_resources as r
        where r.id = rid and r.school_id = new.school_id and r.is_active
      )
    ) then
      raise exception using errcode = '23514', message = 'Unknown learning resource.';
    end if;

    -- Text snapshots keep reports readable even if the catalog changes later.
    select g.name_ar, st.name_ar into new.grade, new.education_stage
    from public.grades as g join public.stages as st on st.id = g.stage_id
    where g.id = new.grade_id;
    select s.name_ar into new.subject from public.subjects as s where s.id = new.subject_id;
    select sec.name_ar into new.section from public.sections as sec where sec.id = new.section_id;
    select coalesce(array_agg(r.name_ar order by r.sort_order), '{}') into new.resources
    from public.learning_resources as r where r.id = any (new.resource_ids);

    if exists (
      select 1 from public.blocked_slots as b
      where b.school_id = new.school_id and b.blocked_date = new.booking_date
        and (b.period_number is null or b.period_number = new.period_number)
    ) then
      raise exception using errcode = '23514', message = 'The requested period is blocked.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      new.school_id::text || ':' || new.booking_date::text || ':' || new.period_number::text, 0));
    return new;
  end if;

  -- UPDATE: details are immutable; only cancellation or execution may change.
  if (to_jsonb(new) - 'status' - 'execution_status' - 'cancelled_by' - 'cancelled_at' - 'cancel_reason' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'status' - 'execution_status' - 'cancelled_by' - 'cancelled_at' - 'cancel_reason' - 'updated_at') then
    raise exception using errcode = '42501', message = 'Booking details cannot be edited.';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'confirmed' or new.status <> 'cancelled' then
      raise exception using errcode = '23514', message = 'Only confirmed bookings can be cancelled.';
    end if;
    if new.execution_status is distinct from old.execution_status or old.execution_status <> 'pending' then
      raise exception using errcode = '23514', message = 'A booking with recorded execution cannot be cancelled.';
    end if;
    if app_role = 'teacher' then
      if old.teacher_id <> auth.uid() then
        raise exception using errcode = '42501', message = 'Teachers may only cancel their own bookings.';
      end if;
      if period_started then
        raise exception using errcode = '42501', message = 'Teachers may cancel only before the period starts.';
      end if;
    elsif app_role = 'coordinator' then
      if new.cancel_reason is null then
        raise exception using errcode = '23514', message = 'A cancellation reason is required.';
      end if;
    else
      raise exception using errcode = '42501', message = 'This role cannot cancel bookings.';
    end if;
    new.cancelled_by := auth.uid();
    new.cancelled_at := now();
    return new;
  end if;

  if (new.cancelled_by, new.cancelled_at, new.cancel_reason)
     is distinct from (old.cancelled_by, old.cancelled_at, old.cancel_reason) then
    raise exception using errcode = '42501', message = 'Cancellation details cannot be edited.';
  end if;

  if new.execution_status is distinct from old.execution_status then
    if app_role <> 'coordinator' then
      raise exception using errcode = '42501', message = 'Only the coordinator can record execution.';
    end if;
    if old.status <> 'confirmed' then
      raise exception using errcode = '23514', message = 'Execution can be recorded only for confirmed bookings.';
    end if;
    if not period_started and not (new.booking_date = today and period_start is null) then
      raise exception using errcode = '23514', message = 'Execution can be recorded only after the period starts.';
    end if;
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
  if not public.is_school_manager() or new.school_id is distinct from public.current_school_id() then
    raise exception using errcode = '42501', message = 'Only the coordinator may manage blocked periods.';
  end if;

  if tg_op <> 'INSERT' then
    raise exception using errcode = '42501', message = 'Blocked periods cannot be edited.';
  end if;

  if new.blocked_date < (now() at time zone 'Asia/Riyadh')::date
     or extract(dow from new.blocked_date) in (5, 6) then
    raise exception using errcode = '23514', message = 'Blocks must be on a current or future school day.';
  end if;

  for lock_period in
    select n from generate_series(1, 7) as n
    where new.period_number is null or n = new.period_number
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      new.school_id::text || ':' || new.blocked_date::text || ':' || lock_period::text, 0));
  end loop;

  if exists (
    select 1 from public.blocked_slots as b
    where b.school_id = new.school_id and b.blocked_date = new.blocked_date
      and ((new.period_number is null and b.period_number is not null)
        or (new.period_number is not null and b.period_number is null))
  ) then
    raise exception using errcode = '23514', message = 'A whole-day block conflicts with period blocks on the same day.';
  end if;

  if exists (
    select 1 from public.bookings as b
    where b.school_id = new.school_id and b.booking_date = new.blocked_date
      and b.status = 'confirmed'
      and (new.period_number is null or b.period_number = new.period_number)
  ) then
    raise exception using errcode = '23514', message = 'An active booking already uses this period.';
  end if;
  return new;
end;
$$;

-- Policies -------------------------------------------------------------------

drop policy profiles_read_scoped on public.profiles;
drop policy profiles_update_admin on public.profiles;
drop policy bookings_read_scoped on public.bookings;
drop policy bookings_insert_teacher_or_admin on public.bookings;
drop policy bookings_update_teacher_or_admin on public.bookings;
drop policy school_settings_read_active on public.school_settings;
drop policy school_settings_update_admin on public.school_settings;
drop policy blocked_slots_read_active on public.blocked_slots;
drop policy blocked_slots_insert_admin on public.blocked_slots;
drop policy blocked_slots_delete_admin on public.blocked_slots;

create policy profiles_read on public.profiles for select to authenticated
  using (
    school_id = (select public.current_school_id())
    and (id = (select auth.uid()) or (select public.current_app_role()) in ('coordinator', 'principal'))
  );

create policy profiles_update_manager on public.profiles for update to authenticated
  using (school_id = (select public.current_school_id()) and (select public.is_school_manager()))
  with check (school_id = (select public.current_school_id()) and (select public.is_school_manager()));

create policy bookings_read on public.bookings for select to authenticated
  using (
    school_id = (select public.current_school_id())
    and ((select public.current_app_role()) in ('coordinator', 'principal') or teacher_id = (select auth.uid()))
  );

create policy bookings_insert on public.bookings for insert to authenticated
  with check (
    school_id = (select public.current_school_id())
    and ((select public.is_school_manager())
      or ((select public.current_app_role()) = 'teacher' and teacher_id = (select auth.uid())))
  );

create policy bookings_update on public.bookings for update to authenticated
  using (
    school_id = (select public.current_school_id())
    and ((select public.is_school_manager())
      or ((select public.current_app_role()) = 'teacher' and teacher_id = (select auth.uid()) and status = 'confirmed'))
  )
  with check (
    school_id = (select public.current_school_id())
    and ((select public.is_school_manager())
      or ((select public.current_app_role()) = 'teacher' and teacher_id = (select auth.uid()) and status = 'cancelled'))
  );

create policy blocked_slots_read on public.blocked_slots for select to authenticated
  using (school_id = (select public.current_school_id()));

create policy blocked_slots_insert on public.blocked_slots for insert to authenticated
  with check (school_id = (select public.current_school_id()) and (select public.is_school_manager()));

create policy blocked_slots_delete on public.blocked_slots for delete to authenticated
  using (school_id = (select public.current_school_id()) and (select public.is_school_manager()));

alter table public.schools enable row level security;

create policy schools_read on public.schools for select to authenticated
  using (id = (select public.current_school_id()));

create policy schools_update_manager on public.schools for update to authenticated
  using (id = (select public.current_school_id()) and (select public.is_school_manager()))
  with check (id = (select public.current_school_id()) and (select public.is_school_manager()));

alter table public.school_settings rename to school_settings_legacy;
revoke all on public.school_settings_legacy from anon, authenticated;

revoke all on public.schools from anon, authenticated;
grant select on public.schools to authenticated;
grant update (name_ar, education_department_ar, region_ar, logo_url, settings) on public.schools to authenticated;

-- Grid view ------------------------------------------------------------------
-- Owner-rights view: every member of the school sees which periods are taken
-- and by whom (brief §5.2), without read access to other teachers' full rows.
drop view public.occupancy_schedule;
create view public.occupancy_schedule
with (security_barrier = true)
as
  select b.id, b.booking_date, b.period_number, b.status, b.execution_status,
         b.teacher_id, p.full_name as teacher_name,
         b.subject, b.education_stage, b.grade, b.section
  from public.bookings as b
  join public.profiles as p on p.id = b.teacher_id
  where b.status = 'confirmed'
    and b.school_id = public.current_school_id()
    and public.current_app_role() is not null;

revoke all on public.occupancy_schedule from public, anon;
grant select on public.occupancy_schedule to authenticated;
