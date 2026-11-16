export type Role = 'المعلم' | 'أمين مركز مصادر التعلم' | 'قائد المدرسة';
export type RoleCode = 'teacher' | 'coordinator' | 'principal' | 'super_admin';
// UI status combines the booking state and the execution record.
export type Status = 'مؤكد' | 'تم التنفيذ' | 'ملغي' | 'لم يتم التنفيذ';
export type BookingStatusCode = 'confirmed' | 'cancelled';
export type ExecutionCode = 'pending' | 'executed' | 'not_executed';
export type Stage = 'متوسط' | 'ثانوي';

export const roles: Role[] = ['المعلم', 'أمين مركز مصادر التعلم', 'قائد المدرسة'];
export const roleToCode: Record<Role, RoleCode> = {
  'المعلم': 'teacher',
  'أمين مركز مصادر التعلم': 'coordinator',
  'قائد المدرسة': 'principal',
};
// super_admin has no school UI yet; it gets the read-only experience.
export const roleFromCode: Record<RoleCode, Role> = {
  teacher: 'المعلم',
  coordinator: 'أمين مركز مصادر التعلم',
  principal: 'قائد المدرسة',
  super_admin: 'قائد المدرسة',
};

export function statusFromCodes(status: BookingStatusCode, execution: ExecutionCode): Status {
  if (status === 'cancelled') return 'ملغي';
  if (execution === 'executed') return 'تم التنفيذ';
  if (execution === 'not_executed') return 'لم يتم التنفيذ';
  return 'مؤكد';
}

export type StatusPatch = { status?: BookingStatusCode; execution_status?: ExecutionCode; cancel_reason?: string | null };

export function statusPatch(next: Status, cancelReason?: string): StatusPatch {
  if (next === 'ملغي') return { status: 'cancelled', cancel_reason: cancelReason?.trim() || null };
  if (next === 'تم التنفيذ') return { execution_status: 'executed' };
  if (next === 'لم يتم التنفيذ') return { execution_status: 'not_executed' };
  return { execution_status: 'pending' };
}

export type Teacher = {
  id: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
};
export type Reservation = {
  id: string;
  teacherId: string;
  teacherName: string;
  subject: string;
  stage: Stage;
  grade: string;
  section: string;
  date: string;
  period: number;
  lessonTopic: string;
  resources: string[];
  studentCount?: number;
  notes?: string;
  status: Status;
  cancelReason?: string;
};
export type BlockedSlot = { id: string; date: string; period: number | null; reason: string; kind: 'holiday' | 'closure' };
// Every confirmed booking in the school, including other teachers' (grid view).
export type OccupancySlot = {
  id: string;
  date: string;
  period: number;
  status: Status;
  teacherId: string;
  teacherName: string;
  subject: string;
  stage: Stage;
  grade: string;
  section: string;
};
export type SchoolSettings = {
  schoolId: string;
  school: string;
  administration: string;
  region: string;
  logoUrl: string | null;
  centerAdmin: string;
  principal: string;
  semester: 1 | 2;
  bookingWindowDays: number;
  footerCopyright: string;
  footerCredit: string | null;
  days: string[];
  periods: number;
  // Raw jsonb, kept so saving one field never drops keys this app version
  // does not know about.
  raw: Record<string, unknown>;
};

export type GradeItem = { id: number; name: string; stage: Stage; order: number };
export type SectionItem = { id: string; gradeId: number; name: string; isActive: boolean };
export type SubjectItem = { id: string; name: string; isActive: boolean };
export type PlanItem = { gradeId: number; subjectId: string; semester: 1 | 2; weeklyPeriods: number | null };
export type ResourceItem = { id: string; name: string; order: number; isActive: boolean };
export type PeriodItem = { no: number; start: string | null; end: string | null };
export type Catalog = {
  grades: GradeItem[];
  sections: SectionItem[];
  subjects: SubjectItem[];
  plan: PlanItem[];
  resources: ResourceItem[];
  periods: PeriodItem[];
};

export type DemoData = {
  teachers: Teacher[];
  reservations: Reservation[];
  occupancy: OccupancySlot[];
  blocked: BlockedSlot[];
  settings: SchoolSettings;
  catalog: Catalog;
};

export const emptyData: DemoData = {
  teachers: [],
  reservations: [],
  occupancy: [],
  blocked: [],
  settings: {
    schoolId: '',
    school: '',
    administration: '',
    region: '',
    logoUrl: null,
    centerAdmin: '',
    principal: '',
    semester: 1,
    bookingWindowDays: 30,
    footerCopyright: '',
    footerCredit: null,
    days: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'],
    periods: 7,
    raw: {},
  },
  catalog: { grades: [], sections: [], subjects: [], plan: [], resources: [], periods: [] },
};

// Subjects a grade studies in the given semester, in catalog order.
export function subjectsFor(catalog: Catalog, gradeId: number, semester: 1 | 2): SubjectItem[] {
  const allowed = new Set(
    catalog.plan.filter((p) => p.gradeId === gradeId && p.semester === semester).map((p) => p.subjectId),
  );
  return catalog.subjects.filter((s) => s.isActive && allowed.has(s.id));
}

export function sectionsFor(catalog: Catalog, gradeId: number): SectionItem[] {
  return catalog.sections.filter((s) => s.gradeId === gradeId && s.isActive);
}
