import {
  roleFromCode,
  roleToCode,
  statusFromCode,
  statusToCode,
  type BlockedSlot,
  type DemoData,
  type Reservation,
  type Role,
  type RoleCode,
  type SchoolSettings,
  type Status,
  type StatusCode,
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
  education_stage: 'متوسط' | 'ثانوي';
  grade: string;
  section: string | null;
  lesson_topic: string;
  resources: string[] | null;
  student_count: number | null;
  notes: string | null;
  status: StatusCode;
};
export type BlockedRow = {
  id: string;
  blocked_date: string;
  period_number: number | null;
  reason: string;
};
type SettingsRow = {
  id: number;
  school_name: string;
  education_authority: string;
  region_name: string;
  center_administrator_name: string;
  principal_name: string;
  periods_per_day: number;
};
type OccupancyRow = {
  booking_date: string;
  period_number: number;
  status: StatusCode;
};

export type BookingInput = {
  teacherId: string;
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
};
export type ProfileUpdate = { name: string; role: Role; isActive: boolean };
export type SettingsUpdate = Pick<SchoolSettings, 'school' | 'administration' | 'region' | 'centerAdmin' | 'principal'>;

function mapProfile(row: ProfileRow): Teacher {
  return {
    id: row.id,
    name: row.full_name,
    role: roleFromCode[row.role],
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function mapBooking(row: BookingRow, profiles: Map<string, Teacher>): Reservation {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    teacherName: profiles.get(row.teacher_id)?.name ?? 'معلم',
    subject: row.subject,
    stage: row.education_stage,
    grade: row.grade,
    section: row.section ?? '',
    date: row.booking_date,
    period: row.period_number,
    lessonTopic: row.lesson_topic,
    resources: row.resources ?? [],
    studentCount: row.student_count ?? undefined,
    notes: row.notes ?? undefined,
    status: statusFromCode[row.status],
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

  const [profilesResult, bookingsResult, blockedResult, settingsResult, occupancyResult] = await Promise.all([
    scopedProfilesQuery,
    client.from('bookings').select('*').order('booking_date', { ascending: false }),
    client.from('blocked_slots').select('id, blocked_date, period_number, reason').order('blocked_date'),
    client.from('school_settings').select('*').eq('id', 1).maybeSingle(),
    client.from('occupancy_schedule').select('booking_date, period_number, status'),
  ]);

  const firstError = [
    profilesResult.error,
    bookingsResult.error,
    blockedResult.error,
    settingsResult.error,
    occupancyResult.error,
  ].find(Boolean);
  if (firstError) {
    logSupabaseDiagnostic('appData.select', firstError);
    throw firstError;
  }

  if (!settingsResult.data) {
    throw new Error('SCHOOL_SETTINGS_NOT_CONFIGURED');
  }

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const teachers = profiles.map(mapProfile);
  const profileById = new Map(teachers.map((profile) => [profile.id, profile]));
  const settings = settingsResult.data as SettingsRow;

  return {
    teachers,
    reservations: ((bookingsResult.data ?? []) as BookingRow[]).map((booking) => mapBooking(booking, profileById)),
    occupancy: ((occupancyResult.data ?? []) as OccupancyRow[]).map((slot) => ({
      date: slot.booking_date,
      period: slot.period_number,
      status: statusFromCode[slot.status],
    })),
    blocked: ((blockedResult.data ?? []) as BlockedRow[]).map(
      (slot): BlockedSlot => ({
        id: slot.id,
        date: slot.blocked_date,
        period: slot.period_number,
        reason: slot.reason,
      }),
    ),
    settings: {
      ...emptyData.settings,
      school: settings.school_name,
      administration: settings.education_authority,
      region: settings.region_name,
      centerAdmin: settings.center_administrator_name,
      principal: settings.principal_name,
      periods: settings.periods_per_day,
    },
  };
}

export async function createBooking(input: BookingInput): Promise<BookingRow> {
  const { data, error } = await requireSupabase()
    .from('bookings')
    .insert({
      teacher_id: input.teacherId,
      booking_date: input.date,
      period_number: input.period,
      subject: input.subject,
      education_stage: input.stage,
      grade: input.grade,
      section: input.section,
      lesson_topic: input.lessonTopic,
      resources: input.resources,
      student_count: input.studentCount ?? null,
      notes: input.notes ?? null,
      status: 'confirmed',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as BookingRow;
}

export async function updateBookingStatus(id: string, status: Status): Promise<void> {
  const { error, data } = await requireSupabase()
    .from('bookings')
    .update({ status: statusToCode[status] })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('BOOKING_NOT_UPDATED');
}

export async function saveSchoolSettings(settings: SettingsUpdate): Promise<void> {
  const { error, data } = await requireSupabase()
    .from('school_settings')
    .update({
      school_name: settings.school,
      education_authority: settings.administration,
      region_name: settings.region,
      center_administrator_name: settings.centerAdmin,
      principal_name: settings.principal,
    })
    .eq('id', 1)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('SCHOOL_SETTINGS_NOT_UPDATED');
}

export async function addBlockedSlot(date: string, period: number | null, reason: string): Promise<BlockedRow> {
  const { data, error } = await requireSupabase()
    .from('blocked_slots')
    .insert({
      blocked_date: date,
      period_number: period,
      reason,
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
    if (message.includes('cannot block') || message.includes('active bookings')) {
      return 'لا يمكن إغلاق فترة تحتوي على حجوزات نشطة.';
    }
    if (message.includes('conflicts with')) {
      return 'يوجد تعارض مع إغلاق مسجل مسبقًا لهذا اليوم.';
    }
    if (message.includes('last active administrator')) {
      return 'لا يمكن تعطيل أو تخفيض رتبة المسؤول النشط الأخير.';
    }
    if (message.includes('future date') || message.includes('scheduled for a future')) {
      return 'يجب اختيار تاريخ مستقبلي ليوم دراسي.';
    }
    return 'تعذر حفظ البيانات. تحقق من اليوم والفترة وحالة الحجز.';
  }
  return fallback;
}
