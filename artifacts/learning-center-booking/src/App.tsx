import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Route, Switch, Link, useLocation } from 'wouter';
import { BookOpen, CalendarDays, ChartNoAxesCombined, ChevronLeft, ChevronRight, CircleHelp, ClipboardList, Clock3, DoorOpen, FileText, LayoutDashboard, Menu, Plus, Search, Settings, ShieldCheck, X, Check, AlertCircle, Printer, Eye, SlidersHorizontal } from 'lucide-react';
import { roles, resources, subjects, type DemoData, type Reservation, type Role, type Status } from './data';
import { AppProvider, useApp } from './context/AppContext';
import { arabicErrorMessage, type BookingInput } from './lib/dataService';
import { isBookableDate, slotState, addSchoolDays, countSchoolPeriods, formatSchoolDate, isPeriodBlocked, isSchoolDay, nextSchoolDayISO, schoolTodayISO, weekEndISO, weekStartISO } from './lib/schoolCalendar';
import { Spinner, PageProgressBar, FullPageLoading } from './components/ui/LoadingSystem';
import ReportsPage from './ReportsPage';

const pageTitles: Record<string,string> = {'/dashboard':'الرئيسية','/schedule':'جدول المركز','/reservations/new':'حجز جديد','/reservations':'الحجوزات','/reports':'التقارير','/settings':'الإعدادات'};
const todayISO = () => schoolTodayISO();
const fmt = (iso:string, options:Intl.DateTimeFormatOptions={day:'numeric',month:'long'}) => formatSchoolDate(iso, options);
const isAdmin = (r:Role) => r === 'أمين مركز مصادر التعلم';
const statusTone: Record<Status,string> = {'مؤكد':'confirmed','تم التنفيذ':'done','ملغي':'cancelled','لم يتم التنفيذ':'missed'};
const isValidEmail = (value:string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

function App(){
  return <AppProvider><AuthenticatedApp /></AppProvider>;
}
function AuthenticatedApp(){
  const { session, authLoading, profileLoading, profile, profileError, dataLoading, dataError, refreshData, signOut, bookingSlot, closeBooking, isSyncing } = useApp();
  const [path, nav] = useLocation();
  useEffect(() => { if (!authLoading && !session && path !== '/login' && path !== '/recover' && path !== '/reset-password') nav('/login'); }, [authLoading, session, path, nav]);
  if (authLoading || profileLoading) return <FullPageLoading message="جارٍ التحقق من بيانات الدخول…" submessage="مركز مصادر التعلم · مدرسة الإمام تركي بن عبدالله" />;
  if (path === '/reset-password') return <PasswordReset />;
  if (!session) return <Switch><Route path="/login"><Login /></Route><Route path="/recover"><PasswordRecovery /></Route><Route path="/reset-password"><PasswordReset /></Route><Route><Login /></Route></Switch>;
  if (profileError) return <AccountProblem message={profileError} onSignOut={()=>void signOut()} />;
  if (!profile) return <AccountProblem message="لم يتم إنشاء ملف صلاحيات لهذا الحساب. تواصل مع مسؤول مركز مصادر التعلم." onSignOut={()=>void signOut()} />;
  if (!profile.isActive) return <InactiveAccount />;
  if (dataLoading) return <FullPageLoading message="جارٍ تحميل بيانات المركز…" submessage="يتم تحضير الحجوزات والجدول المدرسي" />;
  if (dataError) return <AccountProblem message={dataError} onSignOut={()=>void signOut()} onRetry={()=>void refreshData()} />;
  return <Switch>
    <Route><Shell bookingSlot={bookingSlot} closeBooking={closeBooking} isSyncing={isSyncing}><Switch>
      <Route path="/" component={Dashboard}/><Route path="/dashboard" component={Dashboard}/>
      <Route path="/schedule" component={Schedule}/><Route path="/reservations/new"><Gate allowed={[roles[0],roles[1]]}><BookingForm onClose={()=>{closeBooking();nav('/reservations')}} preset={bookingSlot}/></Gate></Route>
      <Route path="/reservations" component={Reservations}/><Route path="/reports"><Gate allowed={[roles[1],roles[2]]}><ReportsView/></Gate></Route><Route path="/settings"><Gate allowed={[roles[1]]}><SettingsPage/></Gate></Route>
      <Route><NotFound/></Route>
  </Switch></Shell></Route>
  </Switch>;
}
function Gate({allowed,children}:{allowed:Role[];children:ReactNode}){const {role,toast}=useApp();const [,nav]=useLocation();useEffect(()=>{if(!allowed.includes(role)){toast('هذه الصفحة غير متاحة لهذا الحساب.');nav('/dashboard')}},[role]);return allowed.includes(role)?<>{children}</>:<div className="page-wrap"><div className="loading-inline">جارٍ العودة إلى الصفحة الرئيسية…</div></div>}
function ReportsView(){const {data}=useApp();return <ReportsPage data={data}/>}

function Shell({children,bookingSlot,closeBooking,isSyncing=false}:{children:ReactNode;bookingSlot:{date:string;period:number}|null;closeBooking:()=>void;isSyncing?:boolean}){
  const {role,data,userId,signOut}=useApp(); const [path]=useLocation(); const [mobileOpen,setMobileOpen]=useState(false);
  const user=data.teachers.find(t=>t.id===userId)||data.teachers[0];
  const links=[{href:'/dashboard',label:'الرئيسية',icon:LayoutDashboard,roles:roles},{href:'/schedule',label:'جدول المركز',icon:CalendarDays,roles:roles},{href:'/reservations/new',label:'حجز جديد',icon:Plus,roles:[roles[0],roles[1]]},{href:'/reservations',label:role===roles[0]?'حجوزاتي':'إدارة الحجوزات',icon:ClipboardList,roles:[roles[0],roles[1],roles[2]]},{href:'/reports',label:'التقارير',icon:ChartNoAxesCombined,roles:[roles[1],roles[2]]},{href:'/settings',label:'الإعدادات',icon:Settings,roles:[roles[1]]}].filter(x=>x.roles.includes(role));
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen?'sidebar-open':''}`}>
      <div className="brand"><div className="brand-mark"><BookOpen size={22}/></div><div><b>مركز مصادر التعلم</b><small>مدرسة الإمام تركي بن عبدالله</small></div><button type="button" className="close-mobile icon-button" onClick={()=>setMobileOpen(false)} aria-label="إغلاق القائمة"><X size={18}/></button></div>
      <div className="side-label">القائمة الرئيسية</div>
      <nav className="side-nav">{links.map(item=><Link key={item.href} href={item.href} className={`nav-link ${path===item.href?'nav-active':''}`} data-testid={`link-nav-${item.href.replace('/','').replace('/','-')}`} onClick={()=>setMobileOpen(false)}><item.icon size={19}/><span>{item.label}</span>{path===item.href&&<i/>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="user-card"><div className="avatar">{user?.name?.slice(0,1) || 'م'}</div><div className="user-meta"><b>{user?.name || 'الحساب'}</b><small>{role}</small></div><button onClick={()=>void signOut()} className="icon-button" aria-label="تسجيل الخروج" data-testid="button-sign-out"><DoorOpen size={17}/></button></div></div>
    </aside>
    {mobileOpen&&<button className="mobile-scrim" aria-label="إغلاق القائمة" onClick={()=>setMobileOpen(false)}/>}
    <main className="main-area">
      <PageProgressBar active={isSyncing} />
      <header className="topbar"><button className="icon-button mobile-menu" onClick={()=>setMobileOpen(true)} aria-label="فتح القائمة" data-testid="button-open-menu"><Menu size={20}/></button><div className="breadcrumbs"><span>مركز مصادر التعلم</span><ChevronLeft size={14}/><strong>{pageTitles[path]||'الرئيسية'}</strong></div><div className="top-actions"><span className="demo-pill"><span/> متصل بقاعدة البيانات</span><div className="top-date">{fmt(todayISO(),{weekday:'long',day:'numeric',month:'long'})}</div></div></header>
      <div className="page-wrap">{children}</div>
    </main>
    {bookingSlot&&path!=='/reservations/new'&&<BookingForm onClose={closeBooking} preset={bookingSlot}/>}
  </div>;
}

function PageHeading({eyebrow,title,description,action}:{eyebrow?:string;title:string;description?:string;action?:ReactNode}){
 return <div className="page-heading"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description&&<p>{description}</p>}</div>{action&&<div className="heading-action">{action}</div>}</div>;
}
interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  loading?: boolean;
  loadingText?: string;
  testId?: string;
  icon?: ReactNode;
}
function Button({children,onClick,variant='primary',type='button',disabled=false,loading=false,loadingText,testId,icon}:ButtonProps){
 const isDisabled = disabled || loading;
 return <button type={type} disabled={isDisabled} onClick={onClick} className={`btn btn-${variant}`} data-testid={testId} aria-busy={loading ? 'true' : 'false'}>{loading ? <><Spinner size="sm" color={variant==='primary'||variant==='danger'?'#FFFFFF':'#1C6254'}/><span>{loadingText||children}</span></> : <>{icon}{children}</>}</button>;
}
function Stat({label,value,detail,icon:Icon,tint='mint'}:{label:string;value:string|number;detail:string;icon:typeof CalendarDays;tint?:string}){
 return <div className="stat-card"><div className={`stat-icon ${tint}`}><Icon size={19}/></div><div className="stat-copy"><span>{label}</span><strong data-testid={`value-stat-${label}`}>{value}</strong><small>{detail}</small></div></div>;
}
function StatusBadge({status}:{status:Status}){return <span className={`status-badge ${statusTone[status]}`} data-testid={`status-${status}`}>{status}</span>}
function Empty({title,body,action}:{title:string;body:string;action?:ReactNode}){return <div className="empty-state"><div className="empty-icon"><CalendarDays size={22}/></div><b>{title}</b><p>{body}</p>{action}</div>}
function Dialog({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[onClose]);
 return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className={`dialog ${wide?'dialog-wide':''}`} role="dialog" aria-modal="true" aria-label={title}><header className="dialog-head"><h2>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="إغلاق" data-testid="button-close-dialog"><X size={19}/></button></header><div className="dialog-body">{children}</div></section></div>;
}
function Login(){
 const { signIn, profileError, toast } = useApp(); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false); const [,nav]=useLocation();
 const submit=async(e:FormEvent)=>{e.preventDefault();if(!isValidEmail(email)){toast('أدخل بريدًا إلكترونيًا صحيحًا.','error');return}if(!password){toast('أدخل كلمة المرور.','error');return}setBusy(true);try{await signIn(email,password);nav('/dashboard')}catch(error){toast(arabicErrorMessage(error),'error')}finally{setBusy(false)}};
 return <AuthLayout><div className="login-form-wrap"><div className="eyebrow">الدخول الآمن</div><h2>مرحباً بك</h2><p>سجّل الدخول للوصول إلى بيانات مركزك.</p>{profileError&&<div className="auth-alert" role="alert">{profileError}</div>}<form onSubmit={submit} noValidate><label className="field-label" htmlFor="email">البريد الإلكتروني</label><input id="email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/><label className="field-label" htmlFor="password">كلمة المرور</label><input id="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/><Button type="submit" loading={busy} loadingText="جارٍ تسجيل الدخول…" testId="button-sign-in">تسجيل الدخول <ChevronLeft size={17}/></Button></form><button className="forgot-link" onClick={()=>nav('/recover')} data-testid="button-forgot-password">نسيت كلمة المرور؟</button><div className="login-foot">تُدار الحسابات والصلاحيات عبر Supabase.</div></div></AuthLayout>;
}
function AuthIdentity(){return <div className="login-identity"><div className="brand-mark large"><BookOpen size={28}/></div><span className="identity-rule"/><div className="login-kicker">وزارة التعليم · منطقة عسير</div><h1>مركز مصادر<br/>التعلم</h1><p>بيئة منظمة لحجز الحصص، وإدارة موارد التعلم، ومتابعة إشغال المركز المدرسي.</p><div className="identity-school"><span className="seal">ع</span><span><b>مدرسة الإمام تركي بن عبدالله بالربوعة</b><small>منطقة عسير · المملكة العربية السعودية</small></span></div></div>}
function AuthLayout({children}:{children:ReactNode}){return <div className="login-layout"><AuthIdentity/><div className="login-panel">{children}</div></div>}
function PasswordRecovery(){const {sendPasswordReset,toast}=useApp();const [email,setEmail]=useState('');const [sent,setSent]=useState(false);const [busy,setBusy]=useState(false);return <AuthLayout><div className="login-form-wrap"><div className="eyebrow">استعادة الوصول</div><h2>استعادة كلمة المرور</h2><p>أدخل بريد حسابك وسنرسل رابطاً آمناً لإعادة تعيين كلمة المرور.</p>{sent?<div className="auth-success" role="status"><b>تم إرسال رابط الاستعادة</b><span>إذا كان البريد مرتبطًا بحساب، ستصلك رسالة لإعادة تعيين كلمة المرور.</span></div>:<form noValidate onSubmit={async e=>{e.preventDefault();if(!isValidEmail(email)){toast('أدخل بريدًا إلكترونيًا صحيحًا.','error');return}setBusy(true);try{await sendPasswordReset(email);setSent(true);toast('تم إرسال رابط الاستعادة.','success')}catch(error){toast(arabicErrorMessage(error),'error')}finally{setBusy(false)}}}><label className="field-label" htmlFor="recovery-email">البريد الإلكتروني</label><input id="recovery-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required/><Button type="submit" loading={busy} loadingText="جارٍ الإرسال…">{busy?'جارٍ الإرسال…':'إرسال رابط الاستعادة'}</Button></form>}<Link href="/login" className="forgot-link">العودة لتسجيل الدخول</Link></div></AuthLayout>}
function PasswordReset(){const {updatePassword,toast}=useApp();const [password,setPassword]=useState('');const [confirmation,setConfirmation]=useState('');const [busy,setBusy]=useState(false);const [saved,setSaved]=useState(false);const submit=async(e:FormEvent)=>{e.preventDefault();if(password.length<8){toast('يجب ألا تقل كلمة المرور عن 8 أحرف.','error');return}if(password!==confirmation){toast('كلمتا المرور غير متطابقتين.','error');return}setBusy(true);try{await updatePassword(password);setSaved(true);toast('تم تحديث كلمة المرور.','success')}catch(error){toast(arabicErrorMessage(error),'error')}finally{setBusy(false)}};return <AuthLayout><div className="login-form-wrap"><div className="eyebrow">تأمين الحساب</div><h2>تعيين كلمة مرور جديدة</h2><p>اختر كلمة مرور لا تقل عن 8 أحرف.</p>{saved?<div className="auth-success" role="status"><b>تم تحديث كلمة المرور بنجاح</b><Link href="/dashboard">الانتقال إلى لوحة المركز</Link></div>:<form onSubmit={submit} noValidate><label className="field-label" htmlFor="new-password">كلمة المرور الجديدة</label><input id="new-password" type="password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" required/><label className="field-label" htmlFor="confirm-password">تأكيد كلمة المرور</label><input id="confirm-password" type="password" minLength={8} value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="new-password" required/><Button type="submit" loading={busy} loadingText="جارٍ الحفظ…">{busy?'جارٍ الحفظ…':'حفظ كلمة المرور'}</Button></form>}</div></AuthLayout>}
function InactiveAccount(){const {signOut}=useApp();return <div className="loading-screen" style={{padding:'2rem',textAlign:'center'}}><div style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:56,height:56,borderRadius:'50%',backgroundColor:'#FBEAE5',color:'#B93822',margin:'0 auto 1.25rem'}}><AlertCircle size={28}/></div><h2>الحساب بانتظار التفعيل</h2><p style={{maxWidth:400,margin:'0.5rem auto 1.5rem',color:'#4A5568'}}>تواصل مع مسؤول مركز مصادر التعلم لتفعيل حسابك بعد قبول الدعوة.</p><Button onClick={()=>void signOut()}>تسجيل الخروج</Button></div>}
function AccountProblem({message,onSignOut,onRetry}:{message:string;onSignOut:()=>void;onRetry?:()=>void}){
  const [retrying, setRetrying] = useState(false);
  const handleRetry = async () => {
    if (!onRetry) return;
    setRetrying(true);
    try { await onRetry(); } finally { setRetrying(false); }
  };
  return (
    <div className="login-layout">
      <AuthIdentity />
      <div className="login-panel">
        <div className="login-form-wrap" style={{ textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', backgroundColor: '#FBEAE5', color: '#B93822', margin: '0 auto 1.25rem' }}>
            <AlertCircle size={28} />
          </div>
          <div className="eyebrow" style={{ color: '#B93822' }}>تنبيه الحساب</div>
          <h2 style={{ fontSize: '1.4rem', marginBottom: '0.5rem' }}>تعذر فتح الحساب</h2>
          <p style={{ color: '#4A5568', lineHeight: 1.6, marginBottom: '1.5rem', fontSize: '0.95rem' }}>{message}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {onRetry && (
              <Button onClick={handleRetry} loading={retrying} loadingText="جارٍ إعادة المحاولة…" testId="button-retry-problem">
                إعادة المحاولة
              </Button>
            )}
            <Button variant="secondary" onClick={onSignOut} disabled={retrying} testId="button-signout-problem">
              تسجيل الخروج
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dashboard(){
 const {data,role,userId}=useApp(); const user=data.teachers.find(t=>t.id===userId)||data.teachers[0]; const today=todayISO();
 const visible=role===roles[0]?data.reservations.filter(r=>r.teacherId===userId):data.reservations;
 const upcoming=visible.filter(r=>r.status==='مؤكد'&&r.date>=today).sort((a,b)=>a.date.localeCompare(b.date));
 const done=visible.filter(r=>r.status==='تم التنفيذ');
 const thisWeek=visible.filter(r=>r.date>=weekStart(today)&&r.date<=weekEnd(today)&&r.status!=='ملغي');
 const completedAll=data.reservations.filter(r=>r.status==='تم التنفيذ').length;
 const reportWeekStart=weekStart(today), reportWeekEnd=weekEnd(today);
 const completedThisWeek=data.reservations.filter(r=>r.status==='تم التنفيذ'&&r.date>=reportWeekStart&&r.date<=reportWeekEnd).length;
 const weekCapacity=eligible(data,reportWeekStart,reportWeekEnd);
 const occupancy=weekCapacity?Math.round(completedThisWeek/weekCapacity*100):0;
 if(role===roles[0]) return <><PageHeading eyebrow="مساحة المعلم" title={`صباح الخير، ${user.name.split(' ')[0]}`} description="خطط لحصصك القادمة واستفد من موارد مركز التعلم." action={<Link href="/reservations/new" className="btn btn-primary" data-testid="link-book-now"><Plus size={18}/> حجز حصة جديدة</Link>}/><div className="stat-grid"><Stat label="حجوزات قادمة" value={upcoming.length} detail="حصص مؤكدة لم تنفذ بعد" icon={CalendarDays}/><Stat label="حصص منفذة" value={done.length} detail="إجمالي الحصص المنفذة" icon={Check} tint="gold"/><Stat label="هذا الأسبوع" value={thisWeek.length} detail="حجز نشط خلال الأسبوع" icon={Clock3} tint="soft"/></div><div className="content-grid"><section className="panel upcoming-panel"><PanelTitle title="حجوزاتي القادمة" note="المواعيد القادمة في المركز" action={<Link href="/reservations" className="text-link">عرض الكل <ChevronLeft size={15}/></Link>}/>{upcoming.length?<div className="reservation-list">{upcoming.slice(0,4).map(r=><ReservationRow key={r.id} r={r}/>)}</div>:<Empty title="لا توجد حجوزات قادمة" body="ابدأ بحجز حصة في مركز مصادر التعلم." action={<Link className="text-link" href="/reservations/new">إنشاء حجز</Link>}/>}</section><section className="panel preview-panel"><PanelTitle title="نظرة على الجدول" note="المواعيد المتاحة هذا الأسبوع" action={<Link href="/schedule" className="text-link">الجدول الكامل <ChevronLeft size={15}/></Link>}/><MiniSchedule/></section></div></>;
 const todayItems=data.reservations.filter(r=>r.date===today&&r.status!=='ملغي').sort((a,b)=>a.period-b.period);
 return <><PageHeading eyebrow={role===roles[2]?'لوحة متابعة القيادة':'إدارة مركز مصادر التعلم'} title={role===roles[2]?'نظرة عامة على المركز':'مرحباً بعودتك'} description={role===roles[2]?'مؤشرات إشغال المركز لمتابعة الاستخدام المدرسي.':'إدارة يومية للحجوزات والموارد التعليمية.'} action={role===roles[1]?<Link href="/reservations/new" className="btn btn-primary"><Plus size={18}/> حجز جديد</Link>:<Link href="/reports" className="btn btn-secondary"><FileText size={17}/> عرض التقارير</Link>}/><div className="stat-grid four"><Stat label="إجمالي الحجوزات" value={data.reservations.length} detail="تشمل جميع الحالات" icon={ClipboardList}/><Stat label="حجوزات اليوم" value={todayItems.length} detail={fmt(today,{weekday:'long',day:'numeric',month:'long'})} icon={CalendarDays} tint="gold"/><Stat label="حصص منفذة" value={completedAll} detail="تم توثيقها في المركز" icon={Check} tint="soft"/><Stat label="الإشغال الفعلي" value={`${occupancy}%`} detail="من الفترات المدرسية المؤهلة" icon={ChartNoAxesCombined}/></div><div className="content-grid admin-grid"><section className="panel"><PanelTitle title="جدول اليوم" note={`${todayItems.length} حجز في ${fmt(today,{weekday:'long'})}`} action={<Link className="text-link" href="/schedule">عرض الجدول <ChevronLeft size={15}/></Link>}/>{todayItems.length?<div className="today-list">{todayItems.map(r=><div className="today-row" key={r.id}><div className="period-tag">الحصة {r.period}</div><div className="today-info"><b>{r.subject} · {r.grade}</b><small>{r.teacherName} · {r.section}</small></div><StatusBadge status={r.status}/></div>)}</div>:<Empty title="لا توجد حجوزات اليوم" body="الجدول متاح للاطلاع على الفترات."/>}</section><section className="panel visualization"><PanelTitle title="ملخص الاستخدام" note="الحجوزات المؤكدة والمنفذة"/><WeeklyBars data={data}/><div className="stage-summary"><span><i className="dot mint-dot"/> متوسط <b>{data.reservations.filter(r=>r.stage==='متوسط'&&r.status!=='ملغي').length}</b></span><span><i className="dot gold-dot"/> ثانوي <b>{data.reservations.filter(r=>r.stage==='ثانوي'&&r.status!=='ملغي').length}</b></span></div></section></div><section className="panel quick-links"><h2>روابط سريعة</h2><div className="quick-grid"><Link href="/schedule"><CalendarDays/>جدول المركز<ChevronLeft/></Link><Link href="/reservations"><ClipboardList/>إدارة الحجوزات<ChevronLeft/></Link><Link href="/reports"><FileText/>التقارير والإحصاءات<ChevronLeft/></Link></div></section></>;
}
function PanelTitle({title,note,action}:{title:string;note?:string;action?:ReactNode}){return <div className="panel-title"><div><h2>{title}</h2>{note&&<p>{note}</p>}</div>{action}</div>}
function ReservationRow({r}:{r:Reservation}){return <div className="reservation-row"><div className="date-stamp"><b>{fmt(r.date,{day:'numeric'})}</b><small>{fmt(r.date,{month:'short'})}</small></div><div className="reservation-info"><b>{r.subject} · {r.grade}</b><small>{r.lessonTopic} · الحصة {r.period}</small></div><StatusBadge status={r.status}/></div>}
function MiniSchedule(){const days=weekDays(todayISO()); const {data}=useApp();return <div className="mini-schedule"><div className="mini-head"><span>الحصة</span>{days.map(d=><span key={d.date}>{d.name.slice(0,3)}</span>)}</div>{[1,2,3,4,5,6,7].map(p=><div className="mini-row" key={p}><span>{p}</span>{days.map(d=>{const r=data.reservations.find(x=>x.date===d.date&&x.period===p&&x.status!=='ملغي');const blocked=isPeriodBlocked(data.blocked,d.date,p);const unavailable=blocked||!isSchoolDay(d.date)||d.date<=todayISO();const className=r?'mini-booked':blocked?'mini-blocked':unavailable?'mini-unavailable':'mini-open';const title=r?`${r.subject} — ${r.teacherName}`:blocked?'مغلقة':unavailable?'غير متاحة':'متاحة';return <span key={d.date} className={className} title={title}>{r?'•':blocked?'×':''}</span>})}</div>)}</div>}
function weekStart(iso:string){return weekStartISO(iso)}
function weekEnd(iso:string){return weekEndISO(iso)}
function scheduleAnchor(){const today=todayISO();const end=weekEndISO(today);return end<today?addSchoolDays(weekStartISO(today),7):today}
function weekDays(anchor:string){const start=weekStart(anchor);const names=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس'];return names.map((name,i)=>({name,date:addSchoolDays(start,i)}))}
function eligible(data:DemoData,start:string,end:string){return countSchoolPeriods(data.blocked,start,end,data.settings.periods)}
function WeeklyBars({data}:{data:DemoData}){const days=weekDays(todayISO());return <div className="bars">{days.map(d=>{const n=data.reservations.filter(r=>r.date===d.date&&r.status!=='ملغي').length;return <div className="bar-col" key={d.date}><span>{n}</span><div className="bar-track"><i style={{height:`${Math.max(n?12:3,Math.min(100,n*15))}%`}}/></div><small>{d.name.slice(0,3)}</small></div>})}</div>}

function Schedule(){
 const {data,role,openBooking,toast}=useApp();const [anchor,setAnchor]=useState(scheduleAnchor);const [activeDay,setActiveDay]=useState(scheduleAnchor);const days=weekDays(anchor);const [detail,setDetail]=useState<Reservation|null>(null);
 useEffect(()=>{if(!days.some(d=>d.date===activeDay))setActiveDay(days[0].date)},[anchor]);
 const move=(amount:number)=>setAnchor(addSchoolDays(anchor,amount*7));
 const choose=(date:string,period:number)=>{const r=data.reservations.find(x=>x.date===date&&x.period===period&&x.status!=='ملغي');const b=data.blocked.find(x=>x.date===date&&(x.period===null||x.period===period));if(r){setDetail(r);return}if(b){toast(`هذه الفترة غير متاحة: ${b.reason}`);return}if(date<todayISO()){toast('انتهى موعد هذه الفترة.','info');return}if(role===roles[0]||isAdmin(role))openBooking(date,period);else toast('هذا الحساب مخصص للاطلاع فقط.');};
 const active=days.find(d=>d.date===activeDay)||days[0];
 return <><PageHeading eyebrow="الحصص الأسبوعية" title="جدول مركز مصادر التعلم" description="استعرض فترات المركز واحجز موعداً مناسباً." action={(role===roles[0]||isAdmin(role))?<Link href="/reservations/new" className="btn btn-primary"><Plus size={17}/> حجز حصة</Link>:undefined}/><section className="panel schedule-panel"><div className="schedule-toolbar"><div className="week-nav"><button className="icon-button" onClick={()=>move(-1)} aria-label="الأسبوع السابق" data-testid="button-week-previous"><ChevronRight size={19}/></button><button className="btn btn-secondary" onClick={()=>setAnchor(scheduleAnchor())} data-testid="button-current-week">هذا الأسبوع</button><button className="icon-button" onClick={()=>move(1)} aria-label="الأسبوع التالي" data-testid="button-week-next"><ChevronLeft size={19}/></button><strong data-testid="text-week-range">{fmt(days[0].date)} — {fmt(days[4].date,{day:'numeric',month:'long',year:'numeric'})}</strong></div><div className="legend"><span><i className="legend-dot available"/>متاحة</span><span><i className="legend-dot reserved"/>محجوزة</span><span><i className="legend-dot blocked"/>مغلقة</span></div></div><div className="mobile-day-tabs">{days.map(d=><button key={d.date} onClick={()=>setActiveDay(d.date)} className={activeDay===d.date?'selected':''} data-testid={`button-day-${d.date}`}>{d.name}<small>{fmt(d.date,{day:'numeric',month:'short'})}</small></button>)}</div><div className="schedule-scroll"><div className="schedule-grid"><div className="schedule-head"><div className="period-heading">الفترة</div>{days.map(d=><div key={d.date} className={`day-heading ${d.date===todayISO()?'today':''}`}><b>{d.name}</b><small>{fmt(d.date,{day:'numeric',month:'short'})}</small></div>)}</div>{Array.from({length:7},(_,i)=>i+1).map(period=><div className="schedule-row" key={period}><div className="period-cell"><b>{period}</b><small>الحصة</small></div>{days.map(d=>{const r=data.reservations.find(x=>x.date===d.date&&x.period===period&&x.status!=='ملغي');const block=data.blocked.find(x=>x.date===d.date&&(x.period===null||x.period===period));const state=slotState(d.date,todayISO(),Boolean(r),Boolean(block));const past=state==='past';return <button key={d.date} onClick={()=>choose(d.date,period)} disabled={state==='past'} className={`slot slot-${state} ${d.date===activeDay?'mobile-current':''}`} data-testid={`slot-${d.date}-${period}`} aria-label={`${d.name} ${fmt(d.date)}، الحصة ${period}، ${r?'محجوزة':block?'مغلقة':past?'منتهية':'متاحة'}`}>{r?<><strong>{r.subject}</strong><small>{r.teacherName}</small><em>{r.grade} · {r.section}</em></>:block?<><strong>مغلقة</strong><small>{block.reason}</small></>:past?<span>{d.date===todayISO()?'غير متاحة':'انتهت'}</span>:<><span className="slot-plus"><Plus size={15}/></span><span>متاحة</span></>}</button>})}</div>)}</div></div></section>{detail&&<ReservationDetail reservation={detail} onClose={()=>setDetail(null)}/>}</>;
}
function ReservationDetail({reservation:r,onClose}:{reservation:Reservation;onClose:()=>void}){return <Dialog title="تفاصيل الحجز" onClose={onClose}><div className="detail-head"><div className="detail-date"><CalendarDays size={18}/>{fmt(r.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div><StatusBadge status={r.status}/></div><div className="detail-grid">{[['المعلم',r.teacherName],['المادة',r.subject],['الصف',`${r.grade} · ${r.section}`],['الفترة',`الحصة ${r.period}`],['موضوع الدرس',r.lessonTopic],['عدد الطلاب',r.studentCount?`${r.studentCount} طالباً`:'غير محدد']].map(([k,v])=><div key={k}><small>{k}</small><b>{v}</b></div>)}</div>{r.resources.length>0&&<div className="detail-resources"><small>الموارد المطلوبة</small><div>{r.resources.map(x=><span key={x}>{x}</span>)}</div></div>}{r.notes&&<p className="detail-notes">{r.notes}</p>}</Dialog>}

function BookingForm({onClose,preset}:{onClose:()=>void;preset:{date:string;period:number}|null}){
 const {data,userId,role,toast,createBooking}=useApp();const [path,nav]=useLocation();const admin=isAdmin(role);const activeBookingTeachers=data.teachers.filter(t=>t.role===roles[0]&&t.isActive);const [bookingTeacherId,setBookingTeacherId]=useState(()=>activeBookingTeachers[0]?.id||userId);const user=data.teachers.find(t=>t.id===(admin?bookingTeacherId:userId))||data.teachers.find(t=>t.id===userId)||data.teachers[0];const [subject,setSubject]=useState(subjects[0]);const [stage,setStage]=useState<'متوسط'|'ثانوي'>('متوسط');const [grade,setGrade]=useState(data.settings.grades['متوسط'][0]);const [date,setDate]=useState(preset?.date||nextSchoolDayISO(todayISO()));const [period,setPeriod]=useState(String(preset?.period||1));const [section,setSection]=useState('أ');const [topic,setTopic]=useState('');const [selected,setSelected]=useState<string[]>([]);const [count,setCount]=useState('');const [notes,setNotes]=useState('');const [saving,setSaving]=useState(false);
 useEffect(()=>{if(preset){setDate(preset.date);setPeriod(String(preset.period))}},[preset]);
 useEffect(()=>{setGrade(data.settings.grades[stage][0])},[stage]);
 const handleClose=()=>{onClose();if(path==='/reservations/new'){nav('/reservations')}};
 const submit=(e:FormEvent)=>{e.preventDefault();if(!topic.trim()){toast('يرجى إدخال موضوع الدرس.','error');return}if(admin&&!activeBookingTeachers.some(t=>t.id===bookingTeacherId)){toast('اختر معلمًا نشطًا لإسناد الحجز.','error');return}if(!date||!isBookableDate(date,todayISO())){toast('اختر يومًا دراسيًا مستقبليًا من الأحد إلى الخميس.','error');return}if(count&&(Number(count)<1||!Number.isInteger(Number(count)))){toast('عدد الطلاب يجب أن يكون رقماً موجباً.','error');return}
   const p=Number(period);const conflict=data.reservations.some(r=>r.date===date&&r.period===p&&r.status!=='ملغي')||isPeriodBlocked(data.blocked,date,p);
   if(conflict){toast('عذرًا، هذه الحصة محجوزة بالفعل. يرجى اختيار موعد آخر.','error');return}
   setSaving(true);void createBooking({teacherId:admin?bookingTeacherId:userId,subject,stage,grade,section,date,period:p,lessonTopic:topic.trim(),resources:selected,studentCount:count?Number(count):undefined,notes:notes.trim()||undefined}).then(()=>{setSaving(false);toast('تم تأكيد حجزك بنجاح.','success');handleClose();nav('/reservations')}).catch(error=>{setSaving(false);toast(arabicErrorMessage(error),'error')});
 };
 return <Dialog title={preset?'حجز موعد من الجدول':'حجز حصة جديدة'} onClose={handleClose} wide><form onSubmit={submit}><p className="form-intro">أكمل بيانات الحصة، وسيتم تأكيد الحجز تلقائياً عند توفر الفترة.</p><div className="form-grid"><Field label="المعلم">{admin?<select value={bookingTeacherId} onChange={e=>setBookingTeacherId(e.target.value)} data-testid="select-booking-teacher">{activeBookingTeachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>:<input value={user?.name||''} readOnly className="readonly"/>}</Field><Field label="المادة"><select value={subject} onChange={e=>setSubject(e.target.value)} data-testid="select-subject">{subjects.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="المرحلة"><select value={stage} onChange={e=>{const next=e.target.value as 'متوسط'|'ثانوي';setStage(next);setGrade(data.settings.grades[next][0])}} data-testid="select-stage"><option>متوسط</option><option>ثانوي</option></select></Field><Field label="الصف"><select value={grade} onChange={e=>setGrade(e.target.value)} data-testid="select-grade">{data.settings.grades[stage].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="الشعبة"><select value={section} onChange={e=>setSection(e.target.value)} data-testid="select-section">{['أ','ب','ج','د'].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="تاريخ الحصة"><input type="date" min={nextSchoolDayISO(todayISO())} value={date} onChange={e=>setDate(e.target.value)} required data-testid="input-booking-date"/></Field><Field label="الفترة"><select value={period} onChange={e=>setPeriod(e.target.value)} data-testid="select-period">{Array.from({length:7},(_,i)=><option key={i+1} value={i+1}>الحصة {i+1}</option>)}</select></Field><Field label="عدد الطلاب (اختياري)"><input type="number" min="1" value={count} onChange={e=>setCount(e.target.value)} placeholder="مثال: ٢٨" data-testid="input-student-count"/></Field><Field label="موضوع الدرس" wide><input value={topic} onChange={e=>setTopic(e.target.value)} required placeholder="اكتب موضوع الحصة أو هدفها" data-testid="input-lesson-topic"/></Field><Field label="موارد التعلم المطلوبة" wide><div className="resource-options">{resources.map(x=><label key={x} className={`resource-option ${selected.includes(x)?'checked':''}`}><input type="checkbox" checked={selected.includes(x)} onChange={e=>setSelected(e.target.checked?[...selected,x]:selected.filter(y=>y!==x))} data-testid={`checkbox-resource-${resources.indexOf(x)}`}/><span>{selected.includes(x)&&<Check size={13}/>}</span>{x}</label>)}</div></Field><Field label="ملاحظات إضافية (اختياري)" wide><textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="أي تجهيزات أو ملاحظات تساعد أمين المركز" data-testid="input-booking-notes"/></Field></div><div className="form-actions"><Button type="submit" loading={saving} loadingText="جارٍ تأكيد الحجز…" testId="button-submit-booking">تأكيد الحجز {!saving&&<ChevronLeft size={16}/>}</Button><Button type="button" variant="secondary" disabled={saving} onClick={handleClose}>إلغاء</Button></div></form></Dialog>;
}
function Field({label,children,wide=false}:{label:string;children:ReactNode;wide?:boolean}){return <label className={`field ${wide?'field-wide':''}`}><span className="field-label">{label}</span>{children}</label>}

function Reservations(){
 const {data,role,userId,toast,updateBookingStatus}=useApp();const admin=isAdmin(role);const [query,setQuery]=useState('');const [status,setStatus]=useState('الكل');const [stage,setStage]=useState('الكل');const [subject,setSubject]=useState('الكل');const [teacherFilter,setTeacherFilter]=useState('الكل');const [from,setFrom]=useState('');const [to,setTo]=useState('');const [detail,setDetail]=useState<Reservation|null>(null);const [pending,setPending]=useState<{r:Reservation;action:'cancel'|'done'|'missed'}|null>(null);
 const [actionBusy,setActionBusy]=useState(false);
 const list=useMemo(()=>data.reservations.filter(r=>(admin||role===roles[2]||r.teacherId===userId)&&(!query||`${r.teacherName} ${r.subject} ${r.lessonTopic} ${r.grade}`.includes(query))&&(status==='الكل'||r.status===status)&&(stage==='الكل'||r.stage===stage)&&(subject==='الكل'||r.subject===subject)&&(teacherFilter==='الكل'||r.teacherId===teacherFilter)&&(!from||r.date>=from)&&(!to||r.date<=to)).sort((a,b)=>b.date.localeCompare(a.date)),[data,admin,role,userId,query,status,stage,subject,teacherFilter,from,to]);
 const updateStatus=async(r:Reservation,next:Status)=>{setActionBusy(true);try{await updateBookingStatus(r.id,next);toast(next==='ملغي'?'تم إلغاء الحجز مع الاحتفاظ به في السجل.':'تم تحديث حالة الحجز.','success');setPending(null)}catch(error){toast(arabicErrorMessage(error),'error')}finally{setActionBusy(false)}};
 const cancelAllowed=(r:Reservation)=>r.status==='مؤكد'&&(admin||(r.date>todayISO()&&role===roles[0]&&r.teacherId===userId));
 return <><PageHeading eyebrow={admin?'إدارة المركز':'السجل الشخصي'} title={admin?'إدارة الحجوزات':role===roles[2]?'سجل الحجوزات':'حجوزاتي'} description={admin?'مراجعة الحجوزات وتحديث حالتها مع الاحتفاظ بسجلها.':'تابع حجوزاتك القادمة وسجل الحصص السابقة.'} action={role===roles[0]?<Link href="/reservations/new" className="btn btn-primary"><Plus size={17}/> حجز جديد</Link>:undefined}/><section className="panel filter-panel"><div className="filter-top"><div className="search-wrap"><Search size={17}/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={admin?'ابحث باسم المعلم أو المادة أو الدرس':'ابحث في حجوزاتك'} data-testid="input-reservation-search"/></div><div className="filter-select"><SlidersHorizontal size={16}/><select value={status} onChange={e=>setStatus(e.target.value)} data-testid="filter-status">{['الكل','مؤكد','تم التنفيذ','ملغي','لم يتم التنفيذ'].map(x=><option key={x}>{x}</option>)}</select></div>{admin&&<><select className="filter-select" value={stage} onChange={e=>setStage(e.target.value)} data-testid="filter-stage"><option>الكل</option><option>متوسط</option><option>ثانوي</option></select><select className="filter-select" value={subject} onChange={e=>setSubject(e.target.value)} data-testid="filter-subject"><option>الكل</option>{subjects.map(x=><option key={x}>{x}</option>)}</select><select className="filter-select" value={teacherFilter} onChange={e=>setTeacherFilter(e.target.value)} data-testid="filter-teacher"><option value="الكل">كل المعلمين</option>{data.teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></>}</div>{admin&&<div className="date-filters"><span>الفترة</span><input aria-label="من تاريخ" type="date" value={from} onChange={e=>setFrom(e.target.value)} data-testid="filter-date-from"/><span>إلى</span><input aria-label="إلى تاريخ" type="date" value={to} onChange={e=>setTo(e.target.value)} data-testid="filter-date-to"/><span className="filter-count">{list.length} نتيجة</span></div>}<div className="table-wrap"><table><thead><tr>{admin&&<th>المعلم</th>}<th>المادة والصف</th><th>موضوع الدرس</th><th>التاريخ</th><th>الفترة</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{list.map(r=><tr key={r.id} data-testid={`row-reservation-${r.id}`}>{admin&&<td className="teacher-cell">{r.teacherName}<small>{r.stage}</small></td>}<td><b>{r.subject}</b><small>{r.grade} · {r.section}</small></td><td>{r.lessonTopic}</td><td>{fmt(r.date,{day:'numeric',month:'short',year:'numeric'})}</td><td>الحصة {r.period}</td><td><StatusBadge status={r.status}/></td><td><div className="row-actions"><button className="icon-button" onClick={()=>setDetail(r)} aria-label="عرض التفاصيل" data-testid={`button-details-${r.id}`}><Eye size={17}/></button>{admin&&r.status==='مؤكد'&&r.date<=todayISO()&&<><button className="action-chip done-action" onClick={()=>setPending({r,action:'done'})} data-testid={`button-complete-${r.id}`}>تم التنفيذ</button><button className="action-chip missed-action" onClick={()=>setPending({r,action:'missed'})} data-testid={`button-missed-${r.id}`}>لم ينفذ</button></>}{cancelAllowed(r)&&<button className="action-chip cancel-action" onClick={()=>setPending({r,action:'cancel'})} data-testid={`button-cancel-${r.id}`}>إلغاء</button>}</div></td></tr>)}</tbody></table>{list.length===0&&<Empty title="لا توجد حجوزات مطابقة" body="غيّر معايير البحث أو التصفية لعرض نتائج أخرى."/>}</div></section>{detail&&<ReservationDetail reservation={detail} onClose={()=>setDetail(null)}/ >}{pending&&<Dialog title={pending.action==='cancel'?'تأكيد إلغاء الحجز':'تأكيد تحديث الحالة'} onClose={()=>setPending(null)}><p className="confirm-question">{pending.action==='cancel'?'سيتم إلغاء هذا الحجز، وسيبقى محفوظاً في السجل.':'هل ترغب في تحديث حالة هذه الحصة؟'}</p><div className="confirm-card"><div><small>الموعد</small><b>{fmt(pending.r.date,{weekday:'long',day:'numeric',month:'long'})} · الحصة {pending.r.period}</b></div><div><small>المادة</small><b>{pending.r.subject} · {pending.r.teacherName}</b></div></div><div className="form-actions"><Button variant={pending.action==='cancel'?'danger':'primary'} loading={actionBusy} loadingText="جارٍ التحديث…" onClick={()=>updateStatus(pending.r,pending.action==='cancel'?'ملغي':pending.action==='done'?'تم التنفيذ':'لم يتم التنفيذ')}>{pending.action==='cancel'?'تأكيد الإلغاء':pending.action==='done'?'تأكيد التنفيذ':'تأكيد عدم التنفيذ'}</Button><Button type="button" variant="secondary" disabled={actionBusy} onClick={()=>setPending(null)}>تراجع</Button></div></Dialog>}</>;
}

function SettingsPage(){
 const {data,userId,toast,saveSchoolSettings,addBlockedSlot,deleteBlockedSlot,updateProfile,inviteUser}=useApp();
 const [blockedDate,setBlockedDate]=useState('');const [blockedPeriod,setBlockedPeriod]=useState('1');const [reason,setReason]=useState('');
 const [fullName,setFullName]=useState('');const [email,setEmail]=useState('');const [accountRole,setAccountRole]=useState<Role>(roles[0]);
 const [showAddAccount,setShowAddAccount]=useState(false);
 const [showPreview,setShowPreview]=useState(false);const [previewPage,setPreviewPage]=useState('dashboard');
 
 const [savingSchool,setSavingSchool]=useState(false);
 const [addingBlock,setAddingBlock]=useState(false);
 const [inviting,setInviting]=useState(false);
 const [updatingRoleId,setUpdatingRoleId]=useState<string|null>(null);
 const [unblockingId,setUnblockingId]=useState<string|null>(null);

 const [school,setSchool]=useState(data.settings.school);
 const [administration,setAdministration]=useState(data.settings.administration);
 const [centerAdmin,setCenterAdmin]=useState(data.settings.centerAdmin);
 const [principal,setPrincipal]=useState(data.settings.principal);

 useEffect(()=>{
   setSchool(data.settings.school);
   setAdministration(data.settings.administration);
   setCenterAdmin(data.settings.centerAdmin);
   setPrincipal(data.settings.principal);
 },[data.settings.school,data.settings.administration,data.settings.centerAdmin,data.settings.principal]);

 const saveSchool=async(e:FormEvent<HTMLFormElement>)=>{
   e.preventDefault();
   const s=school.trim(),a=administration.trim(),c=centerAdmin.trim(),p=principal.trim();
   if(!s||!a||!c||!p){toast('أكمل جميع بيانات المدرسة قبل الحفظ.','error');return}
   setSavingSchool(true);
   try{
     await saveSchoolSettings({school:s,administration:a,region:data.settings.region,centerAdmin:c,principal:p});
     toast('تم حفظ إعدادات المدرسة.','success');
   }catch(error){
     toast(arabicErrorMessage(error),'error');
   }finally{
     setSavingSchool(false);
   }
 };

 const addBlock=async(e:FormEvent)=>{
   e.preventDefault();
   if(!blockedDate||!reason.trim()){toast('أدخل التاريخ وسبب الإغلاق.','error');return}
   if(blockedDate<=todayISO()||!isSchoolDay(blockedDate)){toast('اختر يومًا دراسيًا مستقبليًا من الأحد إلى الخميس.','error');return}
   const p=blockedPeriod==='all'?null:Number(blockedPeriod);
   const hasConflict=data.reservations.some(r=>r.date===blockedDate&&(p===null||r.period===p)&&r.status!=='ملغي');
   if(hasConflict){toast('لا يمكن إغلاق فترة تحتوي على حجوزات نشطة.','error');return}
   setAddingBlock(true);
   try{
     await addBlockedSlot(blockedDate,p,reason.trim());
     setBlockedDate('');
     setReason('');
     toast('تم إغلاق الفترة.','success');
   }catch(error){
     toast(arabicErrorMessage(error),'error');
   }finally{
     setAddingBlock(false);
   }
 };

 const invite=async(e:FormEvent)=>{
   e.preventDefault();
   if(!fullName.trim()){toast('أدخل الاسم الكامل.','error');return}
   if(!isValidEmail(email)){toast('أدخل بريدًا إلكترونيًا صحيحًا.','error');return}
   setInviting(true);
   try{
     await inviteUser(email.trim(),fullName.trim(),accountRole);
     setEmail('');
     setFullName('');
     setShowAddAccount(false);
     toast('أُرسل رابط الدعوة. سيظل الحساب غير مفعّل حتى تفعيله من القائمة.','success');
   }catch(error){
     toast(arabicErrorMessage(error,'تعذر إرسال الدعوة. تحقق من إعداد Edge Function والبريد الإلكتروني.'),'error');
   }finally{
     setInviting(false);
   }
 };

 const updateAccount=async(id:string,name:string,currentRole:Role,isActive:boolean,nextRole=currentRole)=>{
   if(id===userId){toast('لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.','error');return}
   setUpdatingRoleId(id);
   try{
     await updateProfile(id,{name,role:nextRole,isActive});
     toast('تم تحديث صلاحيات الحساب.','success');
   }catch(error){
     toast(arabicErrorMessage(error),'error');
   }finally{
     setUpdatingRoleId(null);
   }
 };

 const removeBlock=async(id:string)=>{
   setUnblockingId(id);
   try{
     await deleteBlockedSlot(id);
     toast('تمت إعادة فتح الفترة.','success');
   }catch(error){
     toast(arabicErrorMessage(error),'error');
   }finally{
     setUnblockingId(null);
   }
 };

 return <><PageHeading eyebrow="إدارة المنصة" title="الإعدادات" description="إعداد المدرسة، وحسابات المستخدمين، والفترات غير المتاحة."/><div className="settings-layout"><div className="settings-main"><section className="panel settings-panel"><PanelTitle title="بيانات المدرسة" note="تظهر هذه البيانات في التقارير الرسمية"/><form onSubmit={saveSchool}><div className="form-grid"><Field label="اسم المدرسة" wide><input name="school" value={school} onChange={e=>setSchool(e.target.value)} required data-testid="input-school-name"/></Field><Field label="الإدارة التعليمية" wide><input name="administration" value={administration} onChange={e=>setAdministration(e.target.value)} required data-testid="input-administration"/></Field><Field label="أمين مركز مصادر التعلم"><input name="centerAdmin" value={centerAdmin} onChange={e=>setCenterAdmin(e.target.value)} required data-testid="input-center-admin"/></Field><Field label="قائد المدرسة"><input name="principal" value={principal} onChange={e=>setPrincipal(e.target.value)} required data-testid="input-principal"/></Field></div><div className="form-actions"><Button type="submit" loading={savingSchool} loadingText="جارٍ الحفظ…" testId="button-save-settings">حفظ الإعدادات</Button><Button type="button" variant="secondary" onClick={()=>setShowPreview(true)} testId="button-preview-report"><Eye size={16}/> معاينة التقرير</Button></div></form></section><section className="panel settings-panel"><PanelTitle title="إدارة الحسابات" note="ترسل الدعوة بريدًا آمنًا، ويبدأ الحساب غير مفعّل" action={<Button onClick={()=>setShowAddAccount(true)} testId="button-open-add-account"><Plus size={16}/> إضافة حساب جديد</Button>}/><form onSubmit={invite} className="teacher-add"><Field label="الاسم الكامل"><input value={fullName} onChange={e=>setFullName(e.target.value)} required maxLength={160} data-testid="input-new-account-name"/></Field><Field label="البريد الإلكتروني"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required data-testid="input-new-account-email"/></Field><Field label="الدور"><select value={accountRole} onChange={e=>setAccountRole(e.target.value as Role)} data-testid="select-new-account-role"><option value={roles[0]}>{roles[0]}</option><option value={roles[2]}>{roles[2]}</option></select></Field><Button type="submit" loading={inviting} loadingText="جارٍ الإرسال…" testId="button-invite-account"><Plus size={16}/> إرسال دعوة</Button></form><div className="teacher-list">{data.teachers.map(account=><div key={account.id}><div className="avatar small-avatar">{account.name[0]}</div><span><b>{account.name}</b><small>{account.role}</small></span><select aria-label={`دور ${account.name}`} value={account.role} disabled={account.id===userId||updatingRoleId===account.id} onChange={e=>void updateAccount(account.id,account.name,account.role,account.isActive,e.target.value as Role)} data-testid={`select-account-role-${account.id}`}>{roles.map(item=><option key={item} value={item}>{item}</option>)}</select><button className="action-chip" disabled={account.id===userId||updatingRoleId===account.id} onClick={()=>void updateAccount(account.id,account.name,account.role,!account.isActive)} data-testid={`button-account-active-${account.id}`}>{updatingRoleId===account.id?'…':account.isActive?'تعطيل':'تفعيل'}</button></div>)}</div></section></div><div className="settings-side"><section className="panel settings-panel"><PanelTitle title="الفترات غير المتاحة" note="إغلاق فترة دراسية أو يوم كامل"/><form onSubmit={addBlock} className="block-form"><Field label="التاريخ"><input type="date" value={blockedDate} onChange={e=>setBlockedDate(e.target.value)} min={nextSchoolDayISO(todayISO())} required data-testid="input-block-date"/></Field><Field label="الفترة"><select value={blockedPeriod} onChange={e=>setBlockedPeriod(e.target.value)} data-testid="select-block-period"><option value="all">اليوم كاملًا</option>{Array.from({length:7},(_,i)=><option key={i+1} value={i+1}>الحصة {i+1}</option>)}</select></Field><Field label="سبب الإغلاق"><input value={reason} onChange={e=>setReason(e.target.value)} required maxLength={300} placeholder="مثال: صيانة أجهزة المركز" data-testid="input-block-reason"/></Field><Button type="submit" loading={addingBlock} loadingText="جارٍ الإغلاق…" testId="button-add-block">إغلاق الفترة</Button></form><div className="blocked-list">{data.blocked.length?data.blocked.map(block=><div key={block.id}><span><b>{fmt(block.date,{day:'numeric',month:'short'})} · {block.period===null?'اليوم كاملًا':`الحصة ${block.period}`}</b><small>{block.reason}</small></span><button className="text-link" disabled={unblockingId===block.id} onClick={()=>void removeBlock(block.id)} data-testid={`button-unblock-${block.id}`}>{unblockingId===block.id?'جارٍ الفتح…':'إعادة فتح'}</button></div>):<p>لا توجد فترات مغلقة.</p>}</div></section></div></div>{showAddAccount&&<Dialog title="إضافة حساب جديد" onClose={()=>setShowAddAccount(false)}><form onSubmit={invite}><p className="form-intro">ترسل الدعوة برابط آمن إلى البريد الإلكتروني، وسيكون الحساب غير مفعّل حتى يفعّله أمين المركز.</p><div className="form-grid"><Field label="الاسم الكامل" wide><input value={fullName} onChange={e=>setFullName(e.target.value)} required maxLength={160} data-testid="dialog-input-new-account-name"/></Field><Field label="البريد الإلكتروني" wide><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required data-testid="dialog-input-new-account-email"/></Field><Field label="الدور" wide><select value={accountRole} onChange={e=>setAccountRole(e.target.value as Role)} data-testid="dialog-select-new-account-role"><option value={roles[0]}>{roles[0]}</option><option value={roles[2]}>{roles[2]}</option></select></Field></div><div className="form-actions"><Button type="submit" loading={inviting} loadingText="جارٍ الإرسال…" testId="dialog-button-invite-account"><Plus size={16}/> إرسال دعوة</Button><Button type="button" variant="secondary" disabled={inviting} onClick={()=>setShowAddAccount(false)}>إلغاء</Button></div></form></Dialog>}{showPreview&&<Dialog title="معاينة التقرير الرسمي" onClose={()=>setShowPreview(false)} wide><div className="preview-switch"><label htmlFor="preview-page">المعاينة</label><select id="preview-page" value={previewPage} onChange={e=>setPreviewPage(e.target.value)}><option value="dashboard">لوحة المتابعة</option><option value="schedule">الجدول الأسبوعي</option><option value="reports">التقرير الرسمي</option></select></div>{previewPage==='reports'?<div className="preview-report"><b>{data.settings.administration}</b><h3>تقرير إشغال مركز مصادر التعلم</h3><p>{data.settings.school}</p></div>:previewPage==='schedule'?<MiniSchedule/>:<div className="preview-report"><b>معاينة لوحة المتابعة</b><Link href="/dashboard" onClick={()=>setShowPreview(false)} className="text-link">الانتقال إلى اللوحة</Link></div>}</Dialog>}</>;
}

function NotFound(){return <div className="not-found"><div className="empty-icon"><BookOpen/></div><h1>الصفحة غير موجودة</h1><p>قد يكون الرابط غير صحيح أو لم تعد الصفحة متاحة.</p><Link href="/dashboard" className="btn btn-primary">العودة للرئيسية</Link></div>}
export default App;
