import {
  roleFromCode,
  roleToCode,
  statusFromCodes,
  statusPatch,
  type BlockedSlot,
  type BookingStatusCode,
  type Catalog,
  type DemoData,
  type ExecutionCode,
  type OccupancySlot,
  type Reservation,
  type Role,
  type RoleCode,
  type SchoolSettings,
  type Stage,
  type Status,
  type Teacher,
  emptyData,
} from '../data.ts';
import { logSupabaseDiagnostic, requireSupabase } from './supabase.ts';

export type ProfileRow = {
  id: string;
  full_name: string;
  role: RoleCode;
  is_active: boolean;
  created_at: string;
};
export type BookingRow = {
  id: string;
  teacher_id: string;
  booking_date: string;
  period_number: number;
  subject: string;
  education_stage: Stage;
  grade: string;
  section: string | null;
  lesson_topic: string | null;
  resources: string[] | null;
  student_count: number | null;
  notes: string | null;
  status: BookingStatusCode;
  execution_status: ExecutionCode;
  cancel_reason: string | null;
};
export type BlockedRow = {
  id: string;
  blocked_date: string;
  period_number: number | null;
  reason: string;
  kind: 'holiday' | 'closure';
};
type SchoolRow = {
  id: string;
  name_ar: string;
  education_department_ar: string;
  region_ar: string | null;
  logo_url: string | null;
  settings: Record<string, unknown> | null;
};
type OccupancyRow = {
  id: string;
  booking_date: string;
  period_number: number;
  status: BookingStatusCode;
  execution_status: ExecutionCode;
  teacher_id: string;
  teacher_name: string;
  subject: string;
  education_stage: Stage;
  grade: string;
  section: string | null;
};

export type BookingInput = {
  teacherId: string;
  gradeId: number;
  sectionId: string;
  subjectId: string;
  date: string;
  period: number;
  lessonTopic: string;
  resourceIds: string[];
  studentCount?: number;
  notes?: string;
};
export type ProfileUpdate = { name: string; role: Role; isActive: boolean };
export type SettingsUpdate = Pick<
  SchoolSettings,
  'school' | 'administration' | 'region' | 'centerAdmin' | 'principal' | 'semester' | 'bookingWindowDays' | 'footerCopyright' | 'footerCredit'
>;

function mapProfile(row: ProfileRow): Teacher {
  return {
    id: row.id,
    name: row.full_name,
    role: roleFromCode[row.role],
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export function mapBooking(row: BookingRow, teacherName: string): Reservation {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    teacherName,
    subject: row.subject,
    stage: row.education_stage,
    grade: row.grade,
    section: row.section ?? '',
    date: row.booking_date,
    period: row.period_number,
    lessonTopic: row.lesson_topic ?? '',
    resources: row.resources ?? [],
    studentCount: row.student_count ?? undefined,
    notes: row.notes ?? undefined,
    status: statusFromCodes(row.status, row.execution_status),
    cancelReason: row.cancel_reason ?? undefined,
  };
}

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

export function mapSchool(row: SchoolRow): SchoolSettings {
  const s = row.settings ?? {};
  const semester = Number(s.current_semester) === 2 ? 2 : 1;
  const windowDays = Number(s.booking_window_days);
  return {
    ...emptyData.settings,
    schoolId: row.id,
    school: row.name_ar,
    administration: row.education_department_ar,
    region: row.region_ar ?? '',
    logoUrl: row.logo_url,
    centerAdmin: text(s.center_administrator_name),
    principal: text(s.principal_name),
    semester,
    bookingWindowDays: Number.isInteger(windowDays) && windowDays > 0 ? windowDays : 30,
    footerCopyright: text(s.footer_copyright),
    footerCredit: typeof s.footer_credit === 'string' && s.footer_credit.trim() ? s.footer_credit : null,
    raw: s,
  };
}

export async function fetchOwnProfile(userId: string): Promise<Teacher | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('profiles')
    .select('id, full_name, role, is_active, created_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    logSupabaseDiagnostic('profiles.select.own', error);
    throw error;
  }
  if (!data) return null;
  return mapProfile(data as ProfileRow);
}

export async function loadAppData(role: Role, userId: string): Promise<DemoData> {
  const client = requireSupabase();
  const profilesQuery = client
    .from('profiles')
    .select('id, full_name, role, is_active, created_at')
    .order('full_name');
  const scopedProfilesQuery = role === 'المعلم' ? profilesQuery.eq('id', userId) : profilesQuery;

  const results = await Promise.all([
    scopedProfilesQuery,
    client.from('bookings').select('*').order('booking_date', { ascending: false }),
    client.from('blocked_slots').select('id, blocked_date, period_number, reason, kind').order('blocked_date'),
    client.from('schools').select('id, name_ar, education_department_ar, region_ar, logo_url, settings').maybeSingle(),
    client.from('occupancy_schedule').select('*'),
    client.from('grades').select('id, name_ar, sort_order, stages(name_ar)').order('sort_order'),
    client.from('sections').select('id, grade_id, name_ar, is_active').order('name_ar'),
    client.from('subjects').select('id, name_ar, is_active').order('name_ar'),
    client.from('grade_subjects').select('grade_id, subject_id, semester, weekly_periods'),
    client.from('learning_resources').select('id, name_ar, sort_order, is_active').order('sort_order'),
    client.from('periods').select('period_no, start_time, end_time').order('period_no'),
  ]);
  const [profilesResult, bookingsResult, blockedResult, schoolResult, occupancyResult,
    gradesResult, sectionsResult, subjectsResult, planResult, resourcesResult, periodsResult] = results;

  const firstError = results.map((result) => result.error).find(Boolean);
  if (firstError) {
    logSupabaseDiagnostic('appData.select', firstError);
    throw firstError;
  }
  if (!schoolResult.data) {
    throw new Error('SCHOOL_SETTINGS_NOT_CONFIGURED');
  }

  const teachers = ((profilesResult.data ?? []) as ProfileRow[]).map(mapProfile);
  const occupancy = ((occupancyResult.data ?? []) as OccupancyRow[]).map(
    (slot): OccupancySlot => ({
      id: slot.id,
      date: slot.booking_date,
      period: slot.period_number,
      status: statusFromCodes(slot.status, slot.execution_status),
      teacherId: slot.teacher_id,
      teacherName: slot.teacher_name,
      subject: slot.subject,
      stage: slot.education_stage,
      grade: slot.grade,
      section: slot.section ?? '',
    }),
  );
  // Names come from the grid view, which covers teachers a teacher cannot read.
  const names = new Map<string, string>([
    ...occupancy.map((slot) => [slot.teacherId, slot.teacherName] as const),
    ...teachers.map((t) => [t.id, t.name] as const),
  ]);

  const catalog: Catalog = {
    grades: ((gradesResult.data ?? []) as unknown as { id: number; name_ar: string; sort_order: number; stages: { name_ar: Stage } | null }[]).map((g) => ({
      id: g.id,
      name: g.name_ar,
      stage: g.stages?.name_ar ?? 'متوسط',
      order: g.sort_order,
    })),
    sections: ((sectionsResult.data ?? []) as { id: string; grade_id: number; name_ar: string; is_active: boolean }[]).map((s) => ({
      id: s.id,
      gradeId: s.grade_id,
      name: s.name_ar,
      isActive: s.is_active,
    })),
    subjects: ((subjectsResult.data ?? []) as { id: string; name_ar: string; is_active: boolean }[]).map((s) => ({
      id: s.id,
      name: s.name_ar,
      isActive: s.is_active,
    })),
    plan: ((planResult.data ?? []) as { grade_id: number; subject_id: string; semester: 1 | 2; weekly_periods: number | null }[]).map((p) => ({
      gradeId: p.grade_id,
      subjectId: p.subject_id,
      semester: p.semester,
      weeklyPeriods: p.weekly_periods,
    })),
    resources: ((resourcesResult.data ?? []) as { id: string; name_ar: string; sort_order: number; is_active: boolean }[]).map((r) => ({
      id: r.id,
      name: r.name_ar,
      order: r.sort_order,
      isActive: r.is_active,
    })),
    periods: ((periodsResult.data ?? []) as { period_no: number; start_time: string | null; end_time: string | null }[]).map((p) => ({
      no: p.period_no,
      start: p.start_time,
      end: p.end_time,
    })),
  };

  return {
    teachers,
    reservations: ((bookingsResult.data ?? []) as BookingRow[]).map((booking) =>
      mapBooking(booking, names.get(booking.teacher_id) ?? 'معلم'),
    ),
    occupancy,
    blocked: ((blockedResult.data ?? []) as BlockedRow[]).map(
      (slot): BlockedSlot => ({
        id: slot.id,
        date: slot.blocked_date,
        period: slot.period_number,
        reason: slot.reason,
        kind: slot.kind,
      }),
    ),
    settings: mapSchool(schoolResult.data as SchoolRow),
    catalog,
  };
}

export async function createBooking(input: BookingInput): Promise<BookingRow> {
  // subject/grade/section text are snapshots filled by the database trigger.
  const { data, error } = await requireSupabase()
    .from('bookings')
    .insert({
      teacher_id: input.teacherId,
      booking_date: input.date,
      period_number: input.period,
      subject_id: input.subjectId,
      grade_id: input.gradeId,
      section_id: input.sectionId,
      resource_ids: input.resourceIds,
      lesson_topic: input.lessonTopic.trim() || null,
      student_count: input.studentCount ?? null,
      notes: input.notes ?? null,
      status: 'confirmed',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as BookingRow;
}

export async function updateBookingStatus(id: string, status: Status, cancelReason?: string): Promise<BookingRow> {
  const { error, data } = await requireSupabase()
    .from('bookings')
    .update(statusPatch(status, cancelReason))
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('BOOKING_NOT_UPDATED');
  return data as BookingRow;
}

export async function saveSchoolSettings(schoolId: string, raw: Record<string, unknown>, settings: SettingsUpdate): Promise<Record<string, unknown>> {
  const nextSettings = {
    ...raw,
    center_administrator_name: settings.centerAdmin,
    principal_name: settings.principal,
    current_semester: settings.semester,
    booking_window_days: settings.bookingWindowDays,
    footer_copyright: settings.footerCopyright,
    footer_credit: settings.footerCredit,
  };
  const { error, data } = await requireSupabase()
    .from('schools')
    .update({
      name_ar: settings.school,
      education_department_ar: settings.administration,
      region_ar: settings.region || null,
      settings: nextSettings,
    })
    .eq('id', schoolId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('SCHOOL_SETTINGS_NOT_UPDATED');
  return nextSettings;
}

export async function addBlockedSlot(date: string, period: number | null, reason: string, kind: 'holiday' | 'closure' = 'closure'): Promise<BlockedRow> {
  const { data, error } = await requireSupabase()
    .from('blocked_slots')
    .insert({
      blocked_date: date,
      period_number: period,
      reason,
      kind,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as BlockedRow;
}

export async function deleteBlockedSlot(id: string): Promise<void> {
  const { error, data } = await requireSupabase()
    .from('blocked_slots')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('BLOCKED_SLOT_NOT_DELETED');
}

export async function updateProfile(id: string, update: ProfileUpdate): Promise<void> {
  const { error, data } = await requireSupabase()
    .from('profiles')
    .update({
      full_name: update.name.trim(),
      role: roleToCode[update.role],
      is_active: update.isActive,
    })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('PROFILE_NOT_UPDATED');
}

export function arabicErrorMessage(error: unknown, fallback = 'تعذر إتمام العملية. يرجى المحاولة مرة أخرى.') {
  const candidate = error as {
    code?: string;
    message?: string;
    status?: number;
    statusCode?: number;
    name?: string;
    context?: { status?: number; statusCode?: number };
  };
  const code = candidate?.code?.toLowerCase();
  const message = candidate?.message?.toLowerCase() ?? '';
  const status = candidate?.status ?? candidate?.statusCode ?? candidate?.context?.status ?? candidate?.context?.statusCode;
  if (candidate?.message === 'FUNCTION_CONFIGURATION_MISSING') {
    return 'إعدادات دعوة الحساب ناقصة على الخادم. أضف APP_URL وSUPABASE_SERVICE_ROLE_KEY إلى Edge Function ثم أعد نشرها.';
  }
  if (candidate?.message === 'USER_ALREADY_EXISTS' || message.includes('already been registered') || message.includes('user already registered')) {
    return 'هذا البريد مرتبط بحساب موجود بالفعل.';
  }
  if (candidate?.message === 'USER_HAS_BOOKINGS') {
    return 'لا يمكن حذف هذا الحساب لأن له حجوزات مسجلة، والحذف النهائي سيُتلف سجل الحجوزات. استخدم «تعطيل» بدلًا من الحذف.';
  }
  if (candidate?.message === 'CANNOT_DELETE_SELF') {
    return 'لا يمكنك حذف حسابك بنفسك.';
  }
  if (candidate?.message === 'USER_NOT_FOUND') {
    return 'الحساب غير موجود، ربما حُذف بالفعل.';
  }
  if (candidate?.message === 'DELETE_FAILED') {
    return 'تعذر حذف الحساب. حاول مرة أخرى أو راجع سجل الدالة admin-delete-user.';
  }
  if (candidate?.message === 'EMAIL_RATE_LIMIT') {
    return 'تم تجاوز الحد المسموح لإرسال البريد الإلكتروني حاليًا. انتظر ساعة ثم أعد المحاولة، أو فعّل SMTP مخصصًا في Supabase.';
  }
  if (candidate?.message === 'ADMIN_REQUIRED' || candidate?.message === 'INVALID_SESSION') {
    return 'انتهت صلاحية الجلسة أو لا يملك الحساب صلاحية إدارة المستخدمين. سجّل الدخول مجددًا بحساب أمين المركز.';
  }
  if (
    candidate?.message === 'FUNCTION_NOT_FOUND' ||
    (status === 404 && (message.includes('function') || candidate?.name === 'FunctionsHttpError'))
  ) {
    return 'خدمة دعوة الحساب غير منشورة في مشروع Supabase. انشر Edge Function باسم admin-invite-user.';
  }
  if (candidate?.message === 'SUPABASE_CONFIGURATION_MISSING') {
    return 'إعدادات الاتصال بـ Supabase غير مكتملة. تحقق من متغيري VITE_SUPABASE_URL وVITE_SUPABASE_PUBLISHABLE_KEY.';
  }
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  }
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'لم يتم تأكيد البريد الإلكتروني بعد. افتح رسالة التأكيد ثم حاول تسجيل الدخول.';
  }
  if (code === 'profile_missing' || candidate?.message === 'PROFILE_NOT_FOUND') {
    return 'تم التحقق من كلمة المرور، لكن لا يوجد ملف صلاحيات لهذا الحساب. تواصل مع مسؤول المركز.';
  }
  if (code === 'account_inactive' || candidate?.message === 'ACCOUNT_INACTIVE') {
    return 'تم تسجيل الدخول، لكن الحساب غير مفعّل بعد. تواصل مع مسؤول المركز.';
  }
  if (candidate?.name === 'TypeError' || /fetch failed|failed to fetch|networkerror|network request failed/.test(message)) {
    return 'تعذر الاتصال بخدمة Supabase. تحقق من اتصال الإنترنت ثم حاول مرة أخرى.';
  }
  if (status === 401 && (message.includes('email not confirmed') || code === 'email_not_confirmed')) {
    return 'لم يتم تأكيد البريد الإلكتروني بعد. افتح رسالة التأكيد ثم حاول تسجيل الدخول.';
  }
  if (status === 401 && (message.includes('invalid login') || code === 'invalid_credentials')) {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  }
  if (status === 401 || status === 403 || code === '42501' || code?.startsWith('pgrst')) {
    if (message.includes('cannot change their own role') || message.includes('users cannot change')) {
      return 'لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.';
    }
    if (message.includes('cancel only before the period starts')) {
      return 'لا يمكن إلغاء الحجز بعد بداية الحصة. تواصل مع أمين المركز.';
    }
    if (message.includes('only the coordinator can record execution')) {
      return 'تسجيل التنفيذ متاح لأمين المركز فقط.';
    }
    return 'رفضت قاعدة البيانات الطلب. تحقق من صلاحيات الحساب وسياسات الوصول في Supabase.';
  }
  if (status && status >= 500) {
    return 'حدث عطل مؤقت في خدمة قاعدة البيانات. حاول مرة أخرى بعد قليل.';
  }
  if (candidate?.message === 'SCHOOL_SETTINGS_NOT_CONFIGURED') {
    return 'لم يتم العثور على إعدادات المدرسة. تأكد من تشغيل ملف قاعدة البيانات الأولي في Supabase.';
  }
  if (candidate?.code === '23505') {
    return 'عذرًا، هذه الحصة محجوزة بالفعل. يرجى اختيار موعد آخر.';
  }
  if (candidate?.code === '42501') {
    if (message.includes('cannot change their own role') || message.includes('users cannot change')) {
      return 'لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.';
    }
    return 'ليست لديك صلاحية لتنفيذ هذا الإجراء، أو أن الحساب غير مفعّل.';
  }
  if (candidate?.code === '23514' || candidate?.code === 'P0001') {
    if (message.includes('cannot block') || message.includes('active booking')) {
      return 'لا يمكن إغلاق فترة تحتوي على حجوزات نشطة.';
    }
    if (message.includes('conflicts with')) {
      return 'يوجد تعارض مع إغلاق مسجل مسبقًا لهذا اليوم.';
    }
    if (message.includes('last active coordinator') || message.includes('last active administrator')) {
      return 'لا يمكن تعطيل أو تغيير دور أمين المركز النشط الأخير.';
    }
    if (message.includes('already started')) {
      return 'بدأت هذه الحصة بالفعل. اختر حصة لاحقة.';
    }
    if (message.includes('booking window')) {
      return 'التاريخ خارج فترة الحجز المسموحة. اختر تاريخًا أقرب.';
    }
    if (message.includes('sunday through thursday')) {
      return 'الحجز متاح من الأحد إلى الخميس فقط.';
    }
    if (message.includes('in the past')) {
      return 'لا يمكن الحجز في تاريخ سابق.';
    }
    if (message.includes('study plan')) {
      return 'المادة غير موجودة في خطة هذا الصف للفصل الدراسي الحالي.';
    }
    if (message.includes('section does not belong')) {
      return 'الشعبة المختارة لا تتبع هذا الصف.';
    }
    if (message.includes('subject, grade and section are required')) {
      return 'اختر المادة والصف والشعبة.';
    }
    if (message.includes('reason is required')) {
      return 'اكتب سبب الإلغاء.';
    }
    if (message.includes('is blocked')) {
      return 'هذه الفترة مغلقة أو إجازة.';
    }
    if (message.includes('execution can be recorded only after')) {
      return 'لا يمكن تسجيل التنفيذ قبل بداية الحصة.';
    }
    if (message.includes('recorded execution cannot be cancelled')) {
      return 'لا يمكن إلغاء حجز سُجّل تنفيذه.';
    }
    if (message.includes('current or future school day') || message.includes('future school day')) {
      return 'اختر اليوم الحالي أو يومًا دراسيًا قادمًا.';
    }
    return 'تعذر حفظ البيانات. تحقق من اليوم والفترة وحالة الحجز.';
  }
  return fallback;
}
