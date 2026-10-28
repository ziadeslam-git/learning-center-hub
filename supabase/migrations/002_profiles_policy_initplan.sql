-- DRAFT: not applied. Requires owner approval before running on the live project.
--
-- Advisor finding B: auth.uid() in profiles_read_scoped is re-evaluated per row.
-- Wrapping it in a scalar subselect lets Postgres evaluate it once per query.
-- Semantics are unchanged.
--
-- Advisor finding A (occupancy_schedule) is intentionally NOT changed here:
-- switching the view to security_invoker = true would apply bookings RLS to the
-- caller, so teachers would stop seeing other teachers' booked periods and the
-- schedule would show them as available. The view is the deliberate, narrow
-- (date, period, status only) exception and is already gated by
-- current_app_role() and revoked from anon.

drop policy if exists profiles_read_scoped on public.profiles;

create policy profiles_read_scoped
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.current_app_role()) in ('admin', 'principal')
  );
