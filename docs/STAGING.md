# Staging setup (test schema v2 before production)

A separate Supabase project used only for testing. Production data is never touched.

## 1. Create the project (Supabase dashboard)

1. supabase.com → **New project** → name `learning-center-staging`, region closest to Riyadh, any DB password (keep it to yourself).
2. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up".
3. **Project Settings → API**: copy the **Project URL** and the **publishable key** (`sb_publishable_…`). Never copy the `service_role` / secret key anywhere.

## 2. Apply the migrations (SQL Editor, in this exact order)

Open each file from `supabase/migrations/`, paste its full content into **SQL Editor → New query**, run, and confirm "Success" before the next one.

| Order | File | Note |
|---|---|---|
| 1 | `001_initial_schema.sql` | Original schema |
| — | `002_profiles_policy_initplan.sql` | **Skip** (superseded by 005) |
| 2 | `003_tenancy.sql` | Schools + `school_id` |
| 3 | `004_catalog.sql` | Grades, sections, subjects, study plan 1447هـ |
| 4 | `005_roles_and_bookings_v2.sql` | Roles, bookings v2, policies |
| 5 | `006_audit_log.sql` | Audit log |

## 3. Create the first coordinator

1. **Authentication → Users → Add user → Create new user**: your email + a password, tick "Auto Confirm User".
2. SQL Editor (replace the email):

```sql
update public.profiles
set role = 'coordinator', is_active = true
where id = (select id from auth.users where email = 'YOUR_EMAIL');
```

3. Optional test teacher: create a second user the same way, then:

```sql
update public.profiles
set is_active = true
where id = (select id from auth.users where email = 'TEACHER_EMAIL');
```

## 4. Edge Functions (only needed to test invite / delete)

**Edge Functions → Deploy a new function → Via Editor**, once per function, pasting the file content:

- `admin-invite-user` ← `supabase/functions/admin-invite-user/index.ts`
- `admin-delete-user` ← `supabase/functions/admin-delete-user/index.ts`

**Edge Functions → Secrets → Add**: `APP_URL` = `http://127.0.0.1:5173`.
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase automatically.

## 5. Run the app against staging (local machine)

Create `.env.staging.local` in the **repository root** (git-ignored; overrides `.env.local` only in staging mode):

```
VITE_SUPABASE_URL=https://YOUR_STAGING_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Then:

```
pnpm --filter @workspace/learning-center-booking run dev:staging
```

Open http://127.0.0.1:5173 and sign in with the staging coordinator.

## 6. What to check

- Booking form: grade → section → subject list follows the study plan for the current semester.
- Same-day booking works until a period starts (set times in `periods` to test cut-off).
- Thursday is bookable; Friday/Saturday are not; dates beyond 30 days are not.
- Teacher sees other teachers' bookings in the grid, but only their own in "حجوزاتي".
- Coordinator cancel requires a reason; teacher cancel works before the period starts only.
- Settings: semester, booking window and footer fields persist after reload.

## 7. Production rollout (after staging passes)

1. Back up production (Database → Backups, or download a dump).
2. Run 003 → 006 on production in the same order (001 already applied; skip 002).
3. Redeploy both Edge Functions with the new code.
4. Push `main` so Vercel deploys the matching frontend.
