-- 004: Academic catalog (stages, grades, sections, subjects, study plan,
-- learning resources, periods). Seeded from the official study plan 1447هـ
-- (مدرسة الإمام تركي بن عبدالله بالربوعة, بنين, المسار العام).
-- stages/grades are national reference data (no school_id); everything the
-- coordinator edits is per school.

-- Manager check used by every catalog policy. 005 narrows it to 'coordinator'
-- after the role rename; 'admin' is accepted here so this file stays usable on
-- its own.
create or replace function public.is_school_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('admin', 'coordinator'), false)
$$;

revoke all on function public.is_school_manager() from public, anon;
grant execute on function public.is_school_manager() to authenticated;

create table public.stages (
  id smallint primary key,
  code text not null unique,
  name_ar text not null unique
);

create table public.grades (
  id smallint primary key,
  stage_id smallint not null references public.stages (id),
  code text not null unique,
  name_ar text not null unique,
  sort_order smallint not null
);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null default public.current_school_id() references public.schools (id) on delete restrict,
  grade_id smallint not null references public.grades (id),
  name_ar text not null check (length(trim(name_ar)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, grade_id, name_ar)
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null default public.current_school_id() references public.schools (id) on delete restrict,
  name_ar text not null check (length(trim(name_ar)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, name_ar)
);

-- Which subjects a grade studies each semester. `track` is null for the
-- intermediate stage and 'general' for the secondary general track.
create table public.grade_subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null default public.current_school_id() references public.schools (id) on delete restrict,
  grade_id smallint not null references public.grades (id),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  semester smallint not null check (semester in (1, 2)),
  track text,
  weekly_periods smallint check (weekly_periods is null or weekly_periods >= 0),
  unique (school_id, grade_id, subject_id, semester, track)
);

create table public.learning_resources (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null default public.current_school_id() references public.schools (id) on delete restrict,
  name_ar text not null check (length(trim(name_ar)) > 0),
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  unique (school_id, name_ar)
);

-- Period times are optional; when set, same-day booking closes at start_time.
create table public.periods (
  school_id uuid not null default public.current_school_id() references public.schools (id) on delete restrict,
  period_no smallint not null check (period_no between 1 and 7),
  start_time time,
  end_time time,
  primary key (school_id, period_no),
  check (start_time is null or end_time is null or end_time > start_time)
);

create index sections_school_grade_idx on public.sections (school_id, grade_id);
create index grade_subjects_lookup_idx on public.grade_subjects (school_id, grade_id, semester);

-- Reference data -------------------------------------------------------------

insert into public.stages (id, code, name_ar) values
  (1, 'intermediate', 'متوسط'),
  (2, 'secondary', 'ثانوي');

-- Names match the strings already stored in bookings.grade.
insert into public.grades (id, stage_id, code, name_ar, sort_order) values
  (1, 1, 'int1', 'الأول المتوسط', 1),
  (2, 1, 'int2', 'الثاني المتوسط', 2),
  (3, 1, 'int3', 'الثالث المتوسط', 3),
  (4, 2, 'sec1', 'الأول الثانوي', 4),
  (5, 2, 'sec2', 'الثاني الثانوي', 5),
  (6, 2, 'sec3', 'الثالث الثانوي', 6);

-- Seed for the original school -----------------------------------------------

-- Sections أ–د match existing bookings; the coordinator edits them in the UI.
insert into public.sections (school_id, grade_id, name_ar)
select '00000000-0000-4000-8000-000000000001', g.id, s.name
from public.grades as g
cross join (values ('أ'), ('ب'), ('ج'), ('د')) as s (name);

insert into public.learning_resources (school_id, name_ar, sort_order)
select '00000000-0000-4000-8000-000000000001', r.name, r.ord
from (values
  ('أجهزة الحاسب الآلي', 1),
  ('جهاز العرض التفاعلي', 2),
  ('السبورة الذكية', 3),
  ('الاتصال بالإنترنت', 4),
  ('المنصات التعليمية', 5),
  ('مصادر التعلم الرقمية', 6),
  ('برامج المحاكاة التعليمية', 7),
  ('مصادر أخرى', 8)
) as r (name, ord);

insert into public.periods (school_id, period_no)
select '00000000-0000-4000-8000-000000000001', n from generate_series(1, 7) as n;

-- Study plan 1447هـ: (grade code, semester, track, subject, weekly periods).
-- Intermediate subjects are the same in both semesters.
create temporary table plan_seed (grade_code text, semester smallint, track text, subject text, weekly smallint);

insert into plan_seed
select g.code, sem.n, null, p.subject, p.weekly
from (values
  ('int1', 'القرآن الكريم والدراسات الإسلامية', 5), ('int2', 'القرآن الكريم والدراسات الإسلامية', 5), ('int3', 'القرآن الكريم والدراسات الإسلامية', 5),
  ('int1', 'اللغة العربية', 5), ('int2', 'اللغة العربية', 5), ('int3', 'اللغة العربية', 4),
  ('int1', 'الاجتماعيات', 3), ('int2', 'الاجتماعيات', 3), ('int3', 'الاجتماعيات', 2),
  ('int1', 'الرياضيات', 6), ('int2', 'الرياضيات', 6), ('int3', 'الرياضيات', 6),
  ('int1', 'العلوم', 4), ('int2', 'العلوم', 4), ('int3', 'العلوم', 4),
  ('int1', 'اللغة الإنجليزية', 4), ('int2', 'اللغة الإنجليزية', 4), ('int3', 'اللغة الإنجليزية', 4),
  ('int1', 'المهارات الرقمية', 2), ('int2', 'المهارات الرقمية', 2), ('int3', 'المهارات الرقمية', 2),
  ('int1', 'التربية الفنية', 2), ('int2', 'التربية الفنية', 2), ('int3', 'التربية الفنية', 2),
  ('int1', 'التربية البدنية', 2), ('int2', 'التربية البدنية', 2), ('int3', 'التربية البدنية', 2),
  ('int3', 'التفكير الناقد', 2),
  ('int1', 'المهارات الحياتية', 1), ('int2', 'المهارات الحياتية', 1), ('int3', 'المهارات الحياتية', 1),
  ('int1', 'النشاط', 1), ('int2', 'النشاط', 1), ('int3', 'النشاط', 1)
) as p (grade_code, subject, weekly)
join public.grades as g on g.code = p.grade_code
cross join (values (1::smallint), (2::smallint)) as sem (n);

insert into plan_seed (grade_code, semester, track, subject, weekly) values
  -- الأول الثانوي
  ('sec1', 1, 'general', 'القرآن الكريم وتفسيره', 4),
  ('sec1', 1, 'general', 'الرياضيات', 5),
  ('sec1', 1, 'general', 'اللغة الإنجليزية', 5),
  ('sec1', 1, 'general', 'التقنية الرقمية', 3),
  ('sec1', 1, 'general', 'الأحياء', 3),
  ('sec1', 1, 'general', 'الكيمياء', 3),
  ('sec1', 1, 'general', 'الكفايات اللغوية', 4),
  ('sec1', 1, 'general', 'التفكير الناقد', 3),
  ('sec1', 1, 'general', 'التربية الصحية والبدنية', 2),
  ('sec1', 2, 'general', 'الرياضيات', 5),
  ('sec1', 2, 'general', 'اللغة الإنجليزية', 5),
  ('sec1', 2, 'general', 'التقنية الرقمية', 3),
  ('sec1', 2, 'general', 'الفيزياء', 3),
  ('sec1', 2, 'general', 'علم البيئة', 2),
  ('sec1', 2, 'general', 'الكفايات اللغوية', 3),
  ('sec1', 2, 'general', 'الحديث', 2),
  ('sec1', 2, 'general', 'المعرفة المالية', 2),
  ('sec1', 2, 'general', 'الدراسات الاجتماعية', 3),
  ('sec1', 2, 'general', 'التربية المهنية', 2),
  ('sec1', 2, 'general', 'التربية الصحية والبدنية', 2),
  -- الثاني الثانوي
  ('sec2', 1, 'general', 'الرياضيات', 5),
  ('sec2', 1, 'general', 'اللغة الإنجليزية', 5),
  ('sec2', 1, 'general', 'الكيمياء', 5),
  ('sec2', 1, 'general', 'الأحياء', 4),
  ('sec2', 1, 'general', 'الفيزياء', 4),
  ('sec2', 1, 'general', 'الكفايات اللغوية', 4),
  ('sec2', 1, 'general', 'التاريخ', 3),
  ('sec2', 1, 'general', 'النشاط', 2),
  ('sec2', 2, 'general', 'الرياضيات', 5),
  ('sec2', 2, 'general', 'اللغة الإنجليزية', 5),
  ('sec2', 2, 'general', 'الكيمياء', 5),
  ('sec2', 2, 'general', 'الأحياء', 4),
  ('sec2', 2, 'general', 'التوحيد', 2),
  ('sec2', 2, 'general', 'اللياقة والثقافة الصحية', 3),
  ('sec2', 2, 'general', 'التقنية الرقمية', 4),
  ('sec2', 2, 'general', 'النشاط', 2),
  ('sec2', 2, 'general', 'الفنون', 2),
  -- الثالث الثانوي
  ('sec3', 1, 'general', 'الرياضيات', 4),
  ('sec3', 1, 'general', 'اللغة الإنجليزية', 4),
  ('sec3', 1, 'general', 'الكيمياء', 3),
  ('sec3', 1, 'general', 'الفيزياء', 5),
  ('sec3', 1, 'general', 'علوم الأرض والفضاء', 3),
  ('sec3', 1, 'general', 'التقنية الرقمية', 2),
  ('sec3', 1, 'general', 'اللياقة والثقافة الصحية', 3),
  ('sec3', 1, 'general', 'البحث ومصادر المعلومات', 2),
  ('sec3', 1, 'general', 'المجال الاختياري', 5),
  ('sec3', 1, 'general', 'النشاط', 1),
  ('sec3', 2, 'general', 'الرياضيات', 4),
  ('sec3', 2, 'general', 'اللغة الإنجليزية', 4),
  ('sec3', 2, 'general', 'علوم الأرض والفضاء', 3),
  ('sec3', 2, 'general', 'الفيزياء', 5),
  ('sec3', 2, 'general', 'الفقه', 2),
  ('sec3', 2, 'general', 'الدراسات النفسية والاجتماعية', 2),
  ('sec3', 2, 'general', 'المهارات الحياتية', 2),
  ('sec3', 2, 'general', 'الدراسات الأدبية', 2),
  ('sec3', 2, 'general', 'المجال الاختياري', 2),
  ('sec3', 2, 'general', 'النشاط', 2),
  ('sec3', 2, 'general', 'المواطنة الرقمية', 2),
  ('sec3', 2, 'general', 'الجغرافيا', 2);

insert into public.subjects (school_id, name_ar)
select distinct '00000000-0000-4000-8000-000000000001'::uuid, subject from plan_seed;

insert into public.grade_subjects (school_id, grade_id, subject_id, semester, track, weekly_periods)
select '00000000-0000-4000-8000-000000000001', g.id, s.id, p.semester, p.track, p.weekly
from plan_seed as p
join public.grades as g on g.code = p.grade_code
join public.subjects as s
  on s.school_id = '00000000-0000-4000-8000-000000000001' and s.name_ar = p.subject;

drop table plan_seed;

-- RLS ------------------------------------------------------------------------

alter table public.stages enable row level security;
alter table public.grades enable row level security;
alter table public.sections enable row level security;
alter table public.subjects enable row level security;
alter table public.grade_subjects enable row level security;
alter table public.learning_resources enable row level security;
alter table public.periods enable row level security;

create policy stages_read on public.stages for select to authenticated
  using ((select public.current_app_role()) is not null);
create policy grades_read on public.grades for select to authenticated
  using ((select public.current_app_role()) is not null);

-- Per-school tables: everyone in the school reads; the manager writes.
do $$
declare
  t text;
begin
  foreach t in array array['sections', 'subjects', 'grade_subjects', 'learning_resources', 'periods'] loop
    execute format(
      'create policy %1$s_read on public.%1$I for select to authenticated
         using (school_id = (select public.current_school_id()))', t);
    execute format(
      'create policy %1$s_write on public.%1$I for all to authenticated
         using (school_id = (select public.current_school_id()) and (select public.is_school_manager()))
         with check (school_id = (select public.current_school_id()) and (select public.is_school_manager()))', t);
  end loop;
end;
$$;

revoke all on public.stages, public.grades, public.sections, public.subjects,
  public.grade_subjects, public.learning_resources, public.periods from anon, authenticated;
grant select on public.stages, public.grades to authenticated;
grant select, insert, update, delete on public.sections, public.subjects,
  public.grade_subjects, public.learning_resources, public.periods to authenticated;
