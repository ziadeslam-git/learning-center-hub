# Phase 0 Audit — LRC Booking Platform (منصة حجز مركز مصادر التعلم)

Date: 2026-11-17 · Branch: `main` @ `86dd3f2` · Scope: read-only audit. No application code was changed for this document.

---

## 1. Real stack (differs from the brief)

| Area | What the brief assumed | What the repo actually is |
|---|---|---|
| Framework | Next.js (App/Pages router) | **Vite 7 + React 19.1 SPA** (`artifacts/learning-center-booking`). No Next.js anywhere. |
| Routing | Next router | **wouter 3** client-side routes in `src/App.tsx` (`/dashboard`, `/schedule`, `/reservations`, `/reservations/new`, `/reports`, `/accounts`, `/settings`, `/login`, `/recover`, `/reset-password`). |
| Backend | API routes / Server Actions / Node server | **No app server.** The browser talks to Supabase directly (PostgREST + Auth) with the publishable key. All rules are enforced by **Postgres RLS + `SECURITY DEFINER` triggers**. Privileged operations run in **Supabase Edge Functions**: `admin-invite-user`, `admin-delete-user` (Deno, service-role key server-side only). |
| Auth | unknown | Supabase Auth email/password, persistent session, password recovery (`/recover` → `/reset-password`), invite flow lands on `/reset-password`. Profiles auto-provisioned **inactive** by trigger on `auth.users` insert. |
| State | — | One React context (`src/context/AppContext.tsx`) loads profile, then bookings/blocked slots/settings/profiles/`occupancy_schedule` in parallel; Supabase Realtime subscription refreshes in background. |
| Reports | — | `src/ReportsPage.tsx` (HTML report + `@media print` → PDF) and `src/lib/exportDocx.ts` (`docx@9`, generated **client-side**, RTL/bidi). |
| Monorepo | — | pnpm workspace with catalog. Also contains Replit leftovers: `artifacts/api-server` (Express, **unused** by the app), `artifacts/mockup-sandbox` (unused), `@replit/*` vite plugins in the catalog, `@replit/connectors-sdk` in root `package.json`. |
| Styling | `next/font` | Tailwind 4 + a large hand-written `src/index.css`; font **IBM Plex Sans Arabic** from Google Fonts. Fully RTL. |
| Tests | — | `node --test` with `--experimental-strip-types`: 28 unit tests (`schoolCalendar.test.mjs`, `bookingAndSettings.test.mjs`). No DB/RLS/concurrency tests. |

### Vercel-only features
None in code. The only Vercel artifact is `vercel.json` (pnpm install/build + SPA rewrite `/(.*) → /index.html`). No `@vercel/*` packages, no Edge Config, no cron, no image optimization.
**Consequence:** the production build (`dist/public`) is plain static files and already runs on any host, including Hostinger, given an SPA fallback rule (e.g. `.htaccess` rewrite to `index.html`). No Node process is required.

---

## 2. Current database schema (`supabase/migrations/001_initial_schema.sql`)

Single-tenant. No `school_id` anywhere.

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id → auth.users` (cascade), `full_name`, `role ∈ {teacher, admin, principal}`, `is_active` | `admin` = أمين المركز (the brief's `coordinator`). No phone, no subjects. |
| `bookings` | `teacher_id → profiles` (**ON DELETE RESTRICT**), `booking_date`, `period_number 1..7`, `subject` **text**, `education_stage ∈ {متوسط, ثانوي}`, `grade` text, `section` text, `lesson_topic`, `resources text[]`, `student_count`, `notes`, `status ∈ {confirmed, completed, not_completed, cancelled}` | Subject/grade/section/resources are free text, not FKs. Execution is folded into `status`. No `cancelled_by` / `cancel_reason`. |
| `school_settings` | singleton `id = 1`: school name, authority, region, center admin name, principal name, `periods_per_day = 7` | |
| `blocked_slots` | `blocked_date`, `period_number` (null = whole day), `reason` | Serves as holidays/closures. |
| view `occupancy_schedule` | `booking_date, period_number, status` of non-cancelled bookings | Owner-rights view so teachers can see *that* a slot is taken without seeing other teachers' rows. |

**Conflict prevention (already correct, DB-level):**
- Partial unique index `bookings_active_period_unique (booking_date, period_number) WHERE status IN ('confirmed','completed','not_completed')`.
- `validate_booking_write` trigger takes a `pg_advisory_xact_lock` per (date, period), rejects Fri/Sat (`extract(dow) in (5,6)` — Postgres 0 = Sunday, correct), past/today dates, blocked periods, non-active teachers, role misuse.
- Client maps `23505` to «عذرًا، هذه الحصة محجوزة بالفعل…» — verified live on 2026-10-28.

**Other triggers:** self role/active change blocked; last active admin cannot be demoted/deactivated; blocked slot cannot overlap active bookings; `updated_at` maintenance.

**Unapplied:** `002_profiles_policy_initplan.sql` (perf-only rewrite of `profiles_read_scoped`, wraps `auth.uid()` in a sub-select). Awaiting approval.

---

## 3. Existing pages and features

| Page | Roles | Status |
|---|---|---|
| Login, password recovery, set password | all | Working (verified 2026-10-28). |
| Dashboard (stats, today, mini week, usage bars) | all | Working, real data. |
| Weekly grid `/schedule` (Sun–Thu × 7, week nav, current-week, mobile day tabs) | all | Working. See bug B1. |
| New booking `/reservations/new` (+ slot modal) | teacher, admin | Working; conflict + persistence verified live. |
| Bookings list `/reservations` (filters, cancel, status) | all (scoped) | Working. Admin marks completed / not completed / cancelled. |
| Reports `/reports` (week / month / custom, occupancy, subjects, stages, per-teacher, detail table, print, DOCX) | admin, principal | Renders real data. **DOCX and print/PDF output not yet visually verified.** |
| Accounts `/accounts` (invite, role, activate, permanent delete) | admin | Invite requires Edge Function + SMTP; delete blocked for accounts that own bookings (by design). |
| Settings `/settings` (school info, blocked periods) | admin | Working, persistence verified. |
| Mobile bottom tab bar, PWA | — | Bottom bar done. **No PWA manifest.** |

---

## 4. Bugs and gaps found

### B1 — "Thursday shows as unavailable" (root cause found)
**Not** a `getDay()` mapping or UTC/`Asia/Riyadh` bug. Verified:
- `schoolCalendar.ts` builds dates with `Date.UTC` and reads `getUTCDay()`; Thursday = 4 → school day. `schoolTodayISO()` uses `Intl` with `timeZone: 'Asia/Riyadh'`. Weekday names array is `['الأحد',…,'الخميس']` aligned with `weekStartISO` (Sunday).
- DB rejects only `dow in (5,6)` = Fri/Sat. Correct.

**Actual cause:** the current business rule is *future dates only*. The DB trigger rejects `booking_date <= today (Riyadh)` and the UI mirrors it (`slotState`: `date <= today → 'past'`; booking form `isBookableDate: date > today`). So **every period of the current day is unavailable**. Because Thursday is the last school day:
- On a Thursday, all of Thursday shows «غير متاحة» and **nothing in the visible week is bookable** (`scheduleAnchor()` only jumps to next week when `weekEnd < today`, i.e. Fri/Sat).
- From Wed evening onward, the only bookable day left in the visible week is Thursday — then it disappears.

**Fix (needs your decision, see D2):** the brief's rule is "from today up to 30 days, until the period starts". That requires real **period start times** (none exist today). Plan: add `periods(start_time, end_time)`; allow today's periods whose start time (Riyadh) has not passed; fall back to "whole of today bookable" only if times are not configured. On Thursday afternoon (all periods started) the grid should auto-advance to next week.

### B2 — Subjects do not match the official study plan
`data.ts` hard-codes 9 generic subjects (incl. «الحاسب الآلي», «الدراسات الاجتماعية» used for both stages) with no grade/semester filtering. The 1447هـ plan (PDF, 2 pages) lists different subjects per grade × semester, with weekly periods. See §6 of the brief; the PDF text matches the brief's tables and adds weekly period counts (useful for `grade_subjects.weekly_periods`).

### B3 — Sections hard-coded `أ ب ج د`
Not editable; the brief wants coordinator-managed sections per grade («شعبة 1، شعبة 2»).

### B4 — Secondary track system not modelled
Grades are flat strings; no semester or track.

### B5 — Cancellation rule narrower than the brief
Teacher can cancel only future-dated confirmed bookings; admin can cancel without a reason. Brief: teacher until the period starts; coordinator must give a reason.

### B6 — No booking window
No 30-day limit; any future school day is accepted.

### B7 — No audit log
Create / cancel / execution changes are not recorded with actor and time (only `updated_at`).

### B8 — No Hijri dates, no editable footer, no MoE logo asset
Dates are Gregorian only (`ar-SA-u-ca-gregory`). Footer text not present/configurable. The MoE «وزارة التعليم» text exists in the report header but **there is no logo file in the repo** (`public/` has only `favicon.svg`, `robots.txt`; `docs/` did not exist).

### B9 — Data issue
`school_settings.school_name` is stored truncated: «مدرسة الإمام تركي بن عبد». Must be corrected in Settings (not a code bug).

### B10 — Performance / hygiene
- Single 896 kB JS chunk (no code-splitting). Many shadcn/Radix components and deps are bundled or installed but appear unused.
- `profiles` is fetched twice on load (own profile, then list).
- Unused workspace packages (`api-server`, `mockup-sandbox`) and Replit-only deps.

### B11 — Tests
No tests for concurrency, RLS, or DB weekday rules. Existing tests are pure-function only.

---

## 5. Security review

| Item | Status |
|---|---|
| Service-role key in browser | **Not exposed.** Only read via `Deno.env` inside Edge Functions. `.env.local` git-ignored; no secrets in tracked files (scanned). |
| RLS | Enabled on all 4 tables; policies scope teachers to own rows; principal read-only; admin writes. Mutations double-checked by `SECURITY DEFINER` triggers. |
| Client-only validation | No — every booking/block rule is re-validated in the DB. |
| `.env.example` | Contains the **real project URL and publishable key**. The publishable key is public by design (low risk) but the example should use placeholders. |
| Edge Functions CORS | `Access-Control-Allow-Origin: *`. Mitigated by mandatory bearer token + admin check; tighten to `APP_URL`. |
| Public sign-up | Any `auth.users` insert becomes an **inactive teacher** (cannot act). Confirm "Allow new users to sign up" is **disabled** in Supabase Auth settings — cannot be verified from the repo. |
| `occupancy_schedule` (Advisor: security-definer view) | Intentional: switching to `security_invoker` would hide other teachers' bookings from teachers and show taken slots as free. Exposes only date/period/status, gated by `current_app_role()`, revoked from `anon`. Keep, document. |
| `profiles_read_scoped` (Advisor: initplan) | Fix drafted in `002` (unapplied). |
| Email | Default Supabase SMTP is rate-limited (hit on 2026-10-28). Custom SMTP needed for production. |

---

## 6. Decisions required before coding

| # | Decision | My recommendation |
|---|---|---|
| **D1** | Brief requires Next.js (`next build && next start`). The app is a Vite SPA. | **Do not migrate to Next.js.** A rewrite adds risk and buys nothing here: Supabase RLS + Edge Functions already provide the server-side enforcement, and the static build runs on Hostinger and Vercel unchanged. Zod validation goes into Edge Functions and the client; Postgres stays the source of truth. |
| **D2** | Same-day booking (brief: today → +30 days, until period starts). Currently future-only. | Adopt the brief. Needs period start/end times from the school. |
| **D3** | Role rename `admin → coordinator`, add `super_admin`. | Rename in DB via migration (data-preserving), keep Arabic labels; `super_admin` role only, no UI. |
| **D4** | Status model: one `status` column today vs brief's `status` + `execution_status`. | Split, migrating data: `completed → (confirmed, executed)`, `not_completed → (confirmed, not_executed)`. |
| **D5** | Holidays: brief adds `school_holidays`; we already have `blocked_slots`. | Extend `blocked_slots` with `kind ∈ {holiday, closure}` and date ranges, instead of a parallel table. |
| **D6** | DOCX generated client-side; brief wants a server route. | Keep client-side: no secrets involved and data is already RLS-filtered. Server generation would need a new Edge Function for no gain. |
| **D7** | Multi-tenant now (R6). | Add `schools` + `school_id` on every table, backfilled to one school; RLS scoped via a `current_school_id()` helper. Unique index becomes `(school_id, booking_date, period_no)`. No onboarding/billing UI. |
| **D8** | Hard delete of accounts with bookings. | Keep refusal (history must survive). Offer deactivate instead. |
| **D9** | Remove unused `api-server`, `mockup-sandbox`, Replit deps. | Yes, in a separate cleanup commit. |
| **D10** | Testing RLS/concurrency safely. | Needs a **non-production** database: Supabase local (Docker) or a separate staging project. I will not run destructive tests against production. |

---

## 7. Implementation plan (after approval)

Each step = its own commit; migrations are new numbered files, data-preserving, never re-running `001`. Each migration is shown to you before it is applied to the live project.

**Phase 1 — Database (migrations `003`–`008`)**
1. `003_tenancy.sql` — `schools` (name, department, logo_url, `settings jsonb`: footer text, current semester, booking window days); copy `school_settings` into it; add `school_id` to `profiles`, `bookings`, `blocked_slots` with backfill; `current_school_id()`; rewrite all policies to scope by school; unique index with `school_id`.
2. `004_roles.sql` — `admin → coordinator`, add `super_admin`; update functions/policies/triggers and the Edge Functions' role checks.
3. `005_catalog.sql` — `stages`, `grades`, `sections`, `subjects`, `grade_subjects (semester, track, weekly_periods)`, `learning_resources`, `periods (period_no, start_time, end_time)`, `booking_resources`. Seed subjects from the 1447هـ plan (both stages, both semesters, weekly periods from the PDF).
4. `006_bookings_v2.sql` — FK columns (`subject_id`, `grade_id`, `section_id`) **plus** kept text snapshots for history; backfill by name; `execution_status`, `cancelled_by`, `cancel_reason` (required for coordinator cancels); same-day-until-start rule; booking window from settings; holiday ranges via `blocked_slots.kind`.
5. `007_audit_log.sql` — append-only `audit_log` + triggers on booking insert/cancel/execution change.
6. `002` (initplan) — apply together with the policy rewrite.

**Phase 2 — Frontend**
7. Dependent dropdowns (grade → section; grade + current semester → subjects), resources from table.
8. Grid: same-day logic with period times, auto-advance after Thursday's last period, holidays shown.
9. Coordinator screens: execution marking with reason-required cancel; CRUD for sections, subjects, periods, holidays, settings (semester, window, footer).
10. Teacher CSV import (Edge Function, batched invites; respects SMTP limits).
11. Hijri (Umm al-Qura) next to Gregorian everywhere; reports date range in both.
12. Header with MoE logo + school/department names from `schools`; editable footer.
13. PWA manifest + icons (no offline data caching).
14. Code-split routes; drop unused deps/packages.

**Phase 3 — Tests**
15. Pure tests: weekday/timezone (Thursday bookable; Fri/Sat rejected; Riyadh midnight boundary), same-day cut-off.
16. DB tests on local/staging Supabase: two concurrent inserts for one slot → exactly one success; teacher cannot cancel another teacher's booking; principal cannot write; cross-school isolation.

**Phase 4 — Docs**
17. `docs/DEPLOYMENT.md` (Supabase migrations, Edge Functions, SMTP, Hostinger static deploy with SPA fallback, Vercel, domain/SSL), `.env.example` with placeholders, `README.md` checklist.

---

## 8. What I need from you / the school

1. Approval of D1–D10 (especially **D1: stay on Vite** and **D2: same-day booking**).
2. **Ministry of Education logo** file (official SVG/PNG) — must come from you; I will use a neutral placeholder until then.
3. **Period start/end times** (7 periods).
4. **Sections per grade** (e.g. أول متوسط: 1، 2، 3 …).
5. **Teacher list** for CSV import (name, email, phone, subjects).
6. Current **semester** and the holiday calendar for 1447هـ.
7. Footer developer credit text (or leave empty).
8. A **staging** Supabase project or permission to run Supabase locally with Docker for DB/RLS tests.
9. Confirm Supabase Auth → "Allow new users to sign up" is disabled.
