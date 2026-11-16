-- 006: Append-only audit log for booking create / cancel / execution changes.
-- Written only by a SECURITY DEFINER trigger; users can read their school's log
-- (coordinator, principal) but can never insert, edit or delete rows.

create table public.audit_log (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools (id) on delete restrict,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('booking.create', 'booking.cancel', 'booking.execution')),
  entity_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_school_time_idx on public.audit_log (school_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_id);

create or replace function public.log_booking_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (school_id, actor_id, action, entity_id, details)
    values (new.school_id, auth.uid(), 'booking.create', new.id, jsonb_build_object(
      'teacher_id', new.teacher_id, 'booking_date', new.booking_date, 'period_number', new.period_number,
      'subject', new.subject, 'grade', new.grade, 'section', new.section));
  elsif new.status is distinct from old.status and new.status = 'cancelled' then
    insert into public.audit_log (school_id, actor_id, action, entity_id, details)
    values (new.school_id, auth.uid(), 'booking.cancel', new.id, jsonb_build_object(
      'booking_date', new.booking_date, 'period_number', new.period_number, 'reason', new.cancel_reason));
  elsif new.execution_status is distinct from old.execution_status then
    insert into public.audit_log (school_id, actor_id, action, entity_id, details)
    values (new.school_id, auth.uid(), 'booking.execution', new.id, jsonb_build_object(
      'from', old.execution_status, 'to', new.execution_status));
  end if;
  return null;
end;
$$;

create trigger log_booking_change
  after insert or update on public.bookings
  for each row execute function public.log_booking_change();

alter table public.audit_log enable row level security;

create policy audit_log_read on public.audit_log for select to authenticated
  using (
    school_id = (select public.current_school_id())
    and (select public.current_app_role()) in ('coordinator', 'principal')
  );

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
