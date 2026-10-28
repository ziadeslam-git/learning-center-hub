export type Role = 'المعلم' | 'أمين مركز مصادر التعلم' | 'قائد المدرسة';
export type RoleCode = 'teacher' | 'admin' | 'principal';
export type Status = 'مؤكد' | 'تم التنفيذ' | 'ملغي' | 'لم يتم التنفيذ';
export type StatusCode = 'confirmed' | 'completed' | 'cancelled' | 'not_completed';

export const roles: Role[] = ['المعلم', 'أمين مركز مصادر التعلم', 'قائد المدرسة'];
export const roleToCode: Record<Role, RoleCode> = {
  'المعلم': 'teacher',
  'أمين مركز مصادر التعلم': 'admin',
  'قائد المدرسة': 'principal',
};
export const roleFromCode: Record<RoleCode, Role> = {
  teacher: 'المعلم',
  admin: 'أمين مركز مصادر التعلم',
  principal: 'قائد المدرسة',
};
export const statusToCode: Record<Status, StatusCode> = {
  'مؤكد': 'confirmed',
  'تم التنفيذ': 'completed',
  'ملغي': 'cancelled',
  'لم يتم التنفيذ': 'not_completed',
};
export const statusFromCode: Record<StatusCode, Status> = {
  confirmed: 'مؤكد',
  completed: 'تم التنفيذ',
  cancelled: 'ملغي',
  not_completed: 'لم يتم التنفيذ',
};

export type Teacher = {
  id: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  subject?: string;
  stage?: 'متوسط' | 'ثانوي';
};
export type Reservation = {
  id: string;
  teacherId: string;
  teacherName: string;
  subject: string;
  stage: 'متوسط' | 'ثانوي';
  grade: string;
  section: string;
  date: string;
  period: number;
  lessonTopic: string;
  resources: string[];
  studentCount?: number;
  notes?: string;
  status: Status;
};
export type BlockedSlot = { id: string; date: string; period: number | null; reason: string };
export type OccupancySlot = { date: string; period: number; status: Status };
export type SchoolSettings = {
  school: string;
  administration: string;
  region: string;
  centerAdmin: string;
  principal: string;
  days: string[];
  periods: number;
  grades: { متوسط: string[]; ثانوي: string[] };
};
export type DemoData = {
  teachers: Teacher[];
  reservations: Reservation[];
  occupancy: OccupancySlot[];
  blocked: BlockedSlot[];
  settings: SchoolSettings;
};

export const emptyData: DemoData = {
  teachers: [],
  reservations: [],
  occupancy: [],
  blocked: [],
  settings: {
    school: '',
    administration: '',
    region: '',
    centerAdmin: '',
    principal: '',
    days: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'],
    periods: 7,
    grades: {
      متوسط: ['الأول المتوسط', 'الثاني المتوسط', 'الثالث المتوسط'],
      ثانوي: ['الأول الثانوي', 'الثاني الثانوي', 'الثالث الثانوي'],
    },
  },
};

export const subjects = [
  'الرياضيات',
  'العلوم',
  'اللغة العربية',
  'اللغة الإنجليزية',
  'الدراسات الاجتماعية',
  'الحاسب الآلي',
  'الأحياء',
  'الفيزياء',
  'الكيمياء',
];
export const resources = [
  'أجهزة الحاسب الآلي',
  'جهاز العرض',
  'السبورة الذكية',
  'الاتصال بالإنترنت',
  'المنصات التعليمية',
  'مصادر التعلم الرقمية',
  'برامج المحاكاة',
  'أخرى',
];
