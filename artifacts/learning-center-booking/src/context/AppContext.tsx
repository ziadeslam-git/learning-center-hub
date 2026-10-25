import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  emptyData,
  type DemoData,
  type Role,
  type Teacher,
  type Status,
} from '../data';
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
} from '../lib/dataService';
import { isSupabaseConfigured, requireSupabase, supabase } from '../lib/supabase';

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
  profileError: string | null;
  dataError: string | null;
  bookingSlot: { date: string; period: number } | null;
  toast: (message: string, kind?: ToastKind) => void;
  openBooking: (date: string, period: number) => void;
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
  const [data, setData] = useState<DemoData>(emptyData);
  const [dataLoading, setDataLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [bookingSlot, setBookingSlot] = useState<{ date: string; period: number } | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: ToastKind } | null>(null);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    setNotice({ text: message, kind });
    window.setTimeout(() => setNotice((current) => current?.text === message ? null : current), 3800);
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

    void (async () => {
      try {
        const ownProfile = await fetchOwnProfile(session.user.id);
        if (!mounted) return;
        setProfile(ownProfile);
        setProfileLoading(false);
        if (!ownProfile?.isActive) return;

        setDataLoading(true);
        const loadedData = await loadAppData(ownProfile.role, session.user.id);
        if (mounted) {
          setData(loadedData);
          setDataError(null);
        }
      } catch (error) {
        if (mounted) {
          const message = (error as { message?: string })?.message;
          setProfileError(
            message === 'SUPABASE_CONFIGURATION_MISSING'
              ? arabicErrorMessage(error)
              : 'تعذر تحميل بيانات الحساب. تأكد من تطبيق ملف قاعدة البيانات وسياسات الوصول في Supabase.',
          );
        }
      } finally {
        if (mounted) {
          setProfileLoading(false);
          setDataLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [session?.user.id]);

  const refreshData = useCallback(async () => {
    if (!session?.user.id || !profile?.isActive) return;
    setDataLoading(true);
    try {
      const nextData = await loadAppData(profile.role, session.user.id);
      setData(nextData);
      setDataError(null);
    } catch {
      setDataError('تعذر تحديث البيانات من Supabase. تحقق من الاتصال ثم أعد المحاولة.');
    } finally {
      setDataLoading(false);
    }
  }, [profile?.isActive, profile?.role, session?.user.id]);

  useEffect(() => {
    if (!profile?.isActive || !session?.user.id || !supabase) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void refreshData();
    };
    const channel = supabase
      .channel(`learning-center-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blocked_slots' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'school_settings' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, refresh)
      .subscribe();
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      void requireSupabase().removeChannel(channel);
    };
  }, [profile?.isActive, refreshData, session?.user.id]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await requireSupabase().auth.signOut();
    if (error) throw error;
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const currentPath = window.location.pathname;
    const appPrefix = currentPath.replace(/recover\/?$/, '');
    const redirectTo = `${window.location.origin}${appPrefix}reset-password`;
    const { error } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await requireSupabase().auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const withRefresh = useCallback(async (operation: () => Promise<void>) => {
    await operation();
    await refreshData();
  }, [refreshData]);

  const contextValue = useMemo<AppContextValue>(() => ({
    data,
    role: profile?.role ?? 'المعلم',
    userId: session?.user.id ?? '',
    profile,
    session,
    authLoading,
    profileLoading,
    dataLoading,
    profileError,
    dataError,
    bookingSlot,
    toast,
    openBooking: (date, period) => setBookingSlot({ date, period }),
    signIn,
    signOut,
    sendPasswordReset,
    updatePassword,
    refreshData,
    createBooking: (input) => withRefresh(() => createBookingRequest(input)),
    updateBookingStatus: (id, status) => withRefresh(() => updateBookingStatusRequest(id, status)),
    saveSchoolSettings: (settings) => withRefresh(() => saveSchoolSettingsRequest(settings)),
    addBlockedSlot: (date, period, reason) => withRefresh(() => addBlockedSlotRequest(date, period, reason)),
    deleteBlockedSlot: (id) => withRefresh(() => deleteBlockedSlotRequest(id)),
    updateProfile: (id, update) => withRefresh(() => updateProfileRequest(id, update)),
  }), [
    data, profile, session, authLoading, profileLoading, dataLoading, profileError, dataError, bookingSlot,
    toast, signIn, signOut, sendPasswordReset, updatePassword, refreshData, withRefresh,
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

