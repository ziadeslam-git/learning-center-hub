import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  emptyData,
  roleToCode,
  statusFromCode,
  type DemoData,
  type Role,
  type Teacher,
  type Status,
  type Reservation,
} from '../data.ts';
import {
  addBlockedSlot as addBlockedSlotRequest,
  arabicErrorMessage,
  createBooking as createBookingRequest,
  deleteBlockedSlot as deleteBlockedSlotRequest,
  fetchOwnProfile,
  loadAppData,
  saveSchoolSettings as saveSchoolSettingsRequest,
  updateBookingStatus as updateBookingStatusRequest,
  updateProfile as updateProfileRequest,
  type BookingInput,
  type ProfileUpdate,
  type SettingsUpdate,
} from '../lib/dataService.ts';
import { isProfilePending } from '../lib/schoolCalendar.ts';
import { isSupabaseConfigured, logSupabaseDiagnostic, requireSupabase, supabase } from '../lib/supabase.ts';

type ToastKind = 'success' | 'error' | 'info';
type AppContextValue = {
  data: DemoData;
  role: Role;
  userId: string;
  profile: Teacher | null;
  session: Session | null;
  authLoading: boolean;
  profileLoading: boolean;
  dataLoading: boolean;
  isSyncing: boolean;
  profileError: string | null;
  dataError: string | null;
  bookingSlot: { date: string; period: number } | null;
  toast: (message: string, kind?: ToastKind) => void;
  openBooking: (date: string, period: number) => void;
  closeBooking: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  refreshData: () => Promise<void>;
  createBooking: (input: BookingInput) => Promise<void>;
  updateBookingStatus: (id: string, status: Status) => Promise<void>;
  saveSchoolSettings: (settings: SettingsUpdate) => Promise<void>;
  addBlockedSlot: (date: string, period: number | null, reason: string) => Promise<void>;
  deleteBlockedSlot: (id: string) => Promise<void>;
  updateProfile: (id: string, update: ProfileUpdate) => Promise<void>;
  inviteUser: (email: string, fullName: string, role: Role) => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('App context unavailable');
  return context;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<Teacher | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  // User id whose profile fetch has finished. Covers the render between the
  // session arriving and the fetch effect starting, which otherwise looks like
  // "no profile" and flashes the account-problem screen.
  const [profileSettledFor, setProfileSettledFor] = useState<string | null>(null);
  const [data, setData] = useState<DemoData>(emptyData);
  const [dataLoading, setDataLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [bookingSlot, setBookingSlot] = useState<{ date: string; period: number } | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: ToastKind } | null>(null);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    setNotice({ text: message, kind });
    window.setTimeout(() => setNotice((current) => (current?.text === message ? null : current)), 3800);
  }, []);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    document.title = 'مركز مصادر التعلم | نظام حجز الحصص';
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthLoading(false);
      setProfileError('إعدادات الاتصال بـ Supabase غير مكتملة. تحقق من متغيري VITE_SUPABASE_URL وVITE_SUPABASE_PUBLISHABLE_KEY.');
      return;
    }

    let mounted = true;
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession);
    });

    void supabase.auth.getSession().then(({ data: sessionData, error }) => {
      if (!mounted) return;
      if (error) {
        setProfileError('تعذر التحقق من جلسة الدخول. أعد تحميل الصفحة وحاول مرة أخرى.');
      } else {
        setSession(sessionData.session);
      }
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!session?.user.id) {
      setProfile(null);
      setData(emptyData);
      setProfileError(null);
      setDataError(null);
      setProfileLoading(false);
      setDataLoading(false);
      return;
    }

    setProfile(null);
    setData(emptyData);
    setProfileError(null);
    setDataError(null);
    setProfileLoading(true);
    setDataLoading(true);

    void (async () => {
      try {
        const ownProfile = await fetchOwnProfile(session.user.id);
        if (!mounted) return;
        setProfile(ownProfile);
        if (!ownProfile?.isActive) {
          setProfileLoading(false);
          return;
        }

        const loadedData = await loadAppData(ownProfile.role, session.user.id);
        if (mounted) {
          setData(loadedData);
          setDataError(null);
          setProfileLoading(false);
        }
      } catch (error) {
        logSupabaseDiagnostic('profiles.select.own', error);
        if (mounted) {
          setProfileError(arabicErrorMessage(error, 'تعذر تحميل ملف الحساب من قاعدة البيانات. تحقق من صلاحيات الحساب وسياسات الوصول.'));
        }
      } finally {
        if (mounted) {
          setProfileLoading(false);
          setDataLoading(false);
          setProfileSettledFor(session.user.id);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [session?.user.id]);

  const refreshData = useCallback(async () => {
    if (!session?.user.id) return;
    try {
      const ownProfile = await fetchOwnProfile(session.user.id);
      setProfile(ownProfile);
      if (!ownProfile?.isActive) {
        setData(emptyData);
        setDataError(null);
        return;
      }
      setProfileError(null);
      const nextData = await loadAppData(ownProfile.role, session.user.id);
      setData(nextData);
      setDataError(null);
    } catch (error) {
      logSupabaseDiagnostic('appData.refresh', error);
      const message = arabicErrorMessage(error, 'تعذر تحديث البيانات من قاعدة البيانات. أعد المحاولة.');
      setDataError(message);
      throw new Error(message);
    }
  }, [session?.user.id]);

  const syncDataInBackground = useCallback(async () => {
    if (!session?.user.id) return;
    setIsSyncing(true);
    try {
      const ownProfile = await fetchOwnProfile(session.user.id);
      setProfile(ownProfile);
      if (!ownProfile?.isActive) return;
      const nextData = await loadAppData(ownProfile.role, session.user.id);
      setData(nextData);
    } catch (error) {
      logSupabaseDiagnostic('appData.backgroundSync', error);
    } finally {
      setIsSyncing(false);
    }
  }, [session?.user.id]);

  useEffect(() => {
    if (!profile?.isActive || !session?.user.id || !supabase) return;
    let refreshTimer: number | undefined;
    const refresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void syncDataInBackground(), 1500);
    };
    const channel = supabase
      .channel(`learning-center-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blocked_slots' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'school_settings' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, refresh)
      .subscribe();

    return () => {
      window.clearTimeout(refreshTimer);
      void requireSupabase().removeChannel(channel);
    };
  }, [profile?.isActive, syncDataInBackground, session?.user.id]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await requireSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      logSupabaseDiagnostic('auth.signInWithPassword', error);
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await requireSupabase().auth.signOut();
    if (error) throw error;
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const basePath = import.meta.env.BASE_URL.endsWith('/')
      ? import.meta.env.BASE_URL
      : `${import.meta.env.BASE_URL}/`;
    const redirectTo = new URL(`${basePath}reset-password`, window.location.origin).toString();
    const { error } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await requireSupabase().auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const inviteUser = useCallback(async (email: string, fullName: string, role: Role) => {
    const { data: response, error } = await requireSupabase().functions.invoke('admin-invite-user', {
      body: { email, fullName, role: roleToCode[role] },
    });
    if (error) {
      const context = error.context as Response | undefined;
      if (context && typeof context.json === 'function') {
        const body = await context.clone().json().catch(() => null) as { error?: string } | null;
        if (body?.error) throw new Error(body.error);
      }
      throw error;
    }
    if (response?.error) throw new Error(String(response.error));
    await syncDataInBackground();
  }, [syncDataInBackground]);

  const createBooking = useCallback(async (input: BookingInput) => {
    const row = await createBookingRequest(input);
    const teacher = data.teachers.find((t) => t.id === input.teacherId) || profile;
    const newReservation: Reservation = {
      id: row.id,
      teacherId: row.teacher_id,
      teacherName: teacher?.name ?? 'معلم',
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
    setData((prev) => ({
      ...prev,
      reservations: [newReservation, ...prev.reservations],
      occupancy: [{ date: row.booking_date, period: row.period_number, status: 'مؤكد' }, ...prev.occupancy],
    }));
  }, [data.teachers, profile]);

  const updateBookingStatus = useCallback(async (id: string, status: Status) => {
    await updateBookingStatusRequest(id, status);
    setData((prev) => {
      let targetDate = '';
      let targetPeriod = 0;
      const reservations = prev.reservations.map((r) => {
        if (r.id === id) {
          targetDate = r.date;
          targetPeriod = r.period;
          return { ...r, status };
        }
        return r;
      });
      const occupancy = prev.occupancy.map((o) => {
        if (o.date === targetDate && o.period === targetPeriod) {
          return { ...o, status };
        }
        return o;
      });
      return { ...prev, reservations, occupancy };
    });
  }, []);

  const saveSchoolSettings = useCallback(async (settings: SettingsUpdate) => {
    await saveSchoolSettingsRequest(settings);
    setData((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        school: settings.school,
        administration: settings.administration,
        region: settings.region,
        centerAdmin: settings.centerAdmin,
        principal: settings.principal,
      },
    }));
  }, []);

  const addBlockedSlot = useCallback(async (date: string, period: number | null, reason: string) => {
    const row = await addBlockedSlotRequest(date, period, reason);
    setData((prev) => ({
      ...prev,
      blocked: [...prev.blocked, { id: row.id, date: row.blocked_date, period: row.period_number, reason: row.reason }],
    }));
  }, []);

  const deleteBlockedSlot = useCallback(async (id: string) => {
    await deleteBlockedSlotRequest(id);
    setData((prev) => ({
      ...prev,
      blocked: prev.blocked.filter((b) => b.id !== id),
    }));
  }, []);

  const updateProfile = useCallback(async (id: string, update: ProfileUpdate) => {
    await updateProfileRequest(id, update);
    setData((prev) => ({
      ...prev,
      teachers: prev.teachers.map((t) => (t.id === id ? { ...t, name: update.name, role: update.role, isActive: update.isActive } : t)),
    }));
  }, []);

  const contextValue = useMemo<AppContextValue>(() => ({
    data,
    role: profile?.role ?? 'المعلم',
    userId: session?.user.id ?? '',
    profile,
    session,
    authLoading,
    profileLoading: isProfilePending(session?.user.id ?? null, profileSettledFor, profileLoading, Boolean(profileError)),
    dataLoading,
    isSyncing,
    profileError,
    dataError,
    bookingSlot,
    toast,
    openBooking: (date, period) => setBookingSlot({ date, period }),
    closeBooking: () => setBookingSlot(null),
    signIn,
    signOut,
    sendPasswordReset,
    updatePassword,
    refreshData,
    createBooking,
    updateBookingStatus,
    saveSchoolSettings,
    addBlockedSlot,
    deleteBlockedSlot,
    updateProfile,
    inviteUser,
  }), [
    data, profile, session, authLoading, profileLoading, profileSettledFor, dataLoading, isSyncing, profileError, dataError, bookingSlot,
    toast, signIn, signOut, sendPasswordReset, updatePassword, refreshData, createBooking, updateBookingStatus,
    saveSchoolSettings, addBlockedSlot, deleteBlockedSlot, updateProfile, inviteUser,
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
      {notice && (
        <div className={`toast toast-${notice.kind}`} role="status" data-testid="toast-message">
          <span>{notice.kind === 'error' ? '!' : '✓'}</span>
          {notice.text}
          <button aria-label="إغلاق الإشعار" onClick={() => setNotice(null)} data-testid="button-dismiss-toast">×</button>
        </div>
      )}
    </AppContext.Provider>
  );
}
