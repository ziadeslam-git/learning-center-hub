import { useMemo, useState } from 'react';
import { ChartNoAxesCombined, Check, ClipboardList, Clock3 } from 'lucide-react';
import type { DemoData, Reservation } from './data';
import { addSchoolDays, countSchoolPeriods, dateFromISO, dateToISO, formatSchoolDate, schoolTodayISO, weekStartISO } from './lib/schoolCalendar';
import { generateReportDocx } from './lib/exportDocx';
import { Spinner } from './components/ui/LoadingSystem';

type Props = { data: DemoData };
type RangePreset = 'weekly' | 'monthly' | 'custom';

const todayISO = () => schoolTodayISO();

const formatDate = (value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) =>
  formatSchoolDate(value, options);

const sundayOf = (value: string) => {
  return weekStartISO(value);
};

const lastDayOfMonth = (value: string) => {
  const [year, month] = value.split('-').map(Number);
  return dateToISO(new Date(Date.UTC(year, month, 0)));
};

function schoolPeriods(data: DemoData, start: string, end: string) {
  return countSchoolPeriods(data.blocked, start, end, data.settings.periods);
}

function addDays(value: string, days: number) {
  return addSchoolDays(value, days);
}

function StatCard({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: typeof Check }) {
  return (
    <article className="stat-card" data-testid={`report-stat-${label}`}>
      <div className="stat-icon"><Icon size={19} /></div>
      <div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </article>
  );
}

function countBy<T>(values: T[], getKey: (item: T) => string) {
  const counts = new Map<string, number>();
  values.forEach((item) => {
    const key = getKey(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export default function ReportsPage({ data }: Props) {
  const [preset, setPreset] = useState<RangePreset>('weekly');
  const [customFrom, setCustomFrom] = useState(sundayOf(todayISO()));
  const [customTo, setCustomTo] = useState(addDays(sundayOf(todayISO()), 4));
  const [month, setMonth] = useState(todayISO().slice(0, 7));

  const range = useMemo(() => {
    if (preset === 'monthly') return { start: `${month}-01`, end: lastDayOfMonth(`${month}-01`) };
    if (preset === 'custom') return { start: customFrom, end: customTo };
    const start = sundayOf(todayISO());
    return { start, end: addDays(start, 4) };
  }, [preset, customFrom, customTo, month]);

  const reservations = useMemo(
    () => data.reservations.filter((reservation) => reservation.date >= range.start && reservation.date <= range.end),
    [data.reservations, range.start, range.end],
  );
  const completed = reservations.filter((reservation) => reservation.status === 'تم التنفيذ');
  const cancelled = reservations.filter((reservation) => reservation.status === 'ملغي');
  const missed = reservations.filter((reservation) => reservation.status === 'لم يتم التنفيذ');
  const capacity = schoolPeriods(data, range.start, range.end);
  const occupancy = capacity ? Math.round((completed.length / capacity) * 100) : 0;
  const activeReservations = reservations.filter((reservation) => reservation.status !== 'ملغي');
  const teacherActivity = data.teachers
    .filter((teacher) => teacher.role === 'المعلم' || reservations.some((reservation) => reservation.teacherId === teacher.id))
    .map((teacher) => {
      const teacherReservations = reservations.filter((reservation) => reservation.teacherId === teacher.id);
      return {
        ...teacher,
        total: teacherReservations.length,
        completed: teacherReservations.filter((reservation) => reservation.status === 'تم التنفيذ').length,
      };
    })
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, 'ar'));
  const bySubject = countBy(activeReservations, (reservation) => reservation.subject);
  const byGrade = countBy(activeReservations, (reservation) => reservation.grade);
  const byStage = countBy(activeReservations, (reservation) => reservation.stage);
  const bestSubject = bySubject[0]?.name || '—';
  const bestGrade = byGrade[0]?.name || '—';

  const trend = useMemo(() => {
    const start = dateFromISO(range.start);
    const end = dateFromISO(range.end);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    const chunk = Math.max(1, Math.ceil(days / 8));
    const bins: { label: string; completed: number; eligible: number }[] = [];
    for (let offset = 0; offset < days; offset += chunk) {
      const binStart = addDays(range.start, offset);
      const binEnd = addDays(range.start, Math.min(days - 1, offset + chunk - 1));
      bins.push({
        label: chunk === 1
          ? formatDate(binStart, { day: 'numeric', month: 'short' })
          : `${formatDate(binStart, { day: 'numeric', month: 'short' })}–${formatDate(binEnd, { day: 'numeric', month: 'short' })}`,
        completed: completed.filter((reservation) => reservation.date >= binStart && reservation.date <= binEnd).length,
        eligible: schoolPeriods(data, binStart, binEnd),
      });
    }
    return bins;
  }, [range.start, range.end, completed, data]);

  const periodButtons: { value: RangePreset; label: string }[] = [
    { value: 'weekly', label: 'أسبوعي' },
    { value: 'monthly', label: 'شهري' },
    { value: 'custom', label: 'فترة مخصصة' },
  ];

  const [exportingWord, setExportingWord] = useState(false);

  const downloadWord = async () => {
    setExportingWord(true);
    try {
      const blob = await generateReportDocx(data, range);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `learning-center-report-${range.start}-${range.end}.docx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('Word export failed:', e);
    } finally {
      setExportingWord(false);
    }
  };

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">مؤشرات المركز</span><h1>التقارير والإحصاءات</h1><p>قراءة دقيقة لاستخدام المركز خلال فترة محددة.</p></div>
      </div>

      <section className="report-controls panel" aria-label="تحديد فترة التقرير">
        <div>
          <span className="field-label">الفترة الزمنية</span>
          <div className="segmented">
            {periodButtons.map((item) => (
              <button key={item.value} type="button" className={preset === item.value ? 'active' : ''} onClick={() => setPreset(item.value)} data-testid={`button-report-${item.value}`}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {preset === 'monthly' ? (
          <label className="field"><span className="field-label">الشهر</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} data-testid="input-report-month" /></label>
        ) : preset === 'custom' ? (
          <>
            <label className="field"><span className="field-label">من تاريخ</span><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} data-testid="input-report-from" /></label>
            <label className="field"><span className="field-label">إلى تاريخ</span><input type="date" min={customFrom} value={customTo} onChange={(event) => setCustomTo(event.target.value)} data-testid="input-report-to" /></label>
          </>
        ) : null}
        <div className="report-range" data-testid="text-report-range">{formatDate(range.start)} — {formatDate(range.end, { day: 'numeric', month: 'long', year: 'numeric' })}</div>
      </section>

      <div className="report-stats">
        <StatCard label="إجمالي الحجوزات" value={reservations.length} detail="ضمن الفترة المحددة" icon={ClipboardList} />
        <StatCard label="الحصص المنفذة" value={completed.length} detail="تم تنفيذها وتوثيقها" icon={Check} />
        <StatCard label="الفترات المؤهلة" value={capacity} detail="بعد استبعاد الفترات المغلقة" icon={Clock3} />
        <StatCard label="نسبة الإشغال الفعلي" value={`${occupancy}%`} detail="المنفذ ÷ الفترات المؤهلة" icon={ChartNoAxesCombined} />
      </div>

      <div className="report-extra-grid">
        <div className="report-extra-item"><span>الحجوزات الملغاة</span><strong>{cancelled.length}</strong></div>
        <div className="report-extra-item"><span>الحصص غير المنفذة</span><strong>{missed.length}</strong></div>
        <div className="report-extra-item"><span>أكثر المواد استخدامًا</span><strong>{bestSubject}</strong></div>
        <div className="report-extra-item"><span>أكثر الصفوف استفادة</span><strong>{bestGrade}</strong></div>
      </div>

      <div className="report-chart-grid">
        <section className="panel report-chart">
          <div className="panel-title"><div><h2>الإشغال عبر الفترة</h2><p>الحصص المنفذة مقارنة بالفترات المدرسية المتاحة</p></div></div>
          {trend.some((bin) => bin.eligible > 0) ? (
            <div className="trend-bars" role="img" aria-label="مخطط نسبة الإشغال عبر الفترة">
              {trend.map((bin) => {
                const rate = bin.eligible ? Math.round((bin.completed / bin.eligible) * 100) : 0;
                return <div className="trend-bin" key={bin.label} title={`${bin.label}: ${rate}%`}>
                  <span>{rate}%</span><div className="trend-track"><i style={{ height: `${Math.max(rate ? 7 : 3, Math.min(rate, 100))}%` }} /></div><small>{bin.label}</small>
                </div>;
              })}
            </div>
          ) : <p className="report-empty">لا توجد فترات مدرسية ضمن التاريخ المحدد.</p>}
        </section>
        <section className="panel report-chart">
          <div className="panel-title"><div><h2>الحجوزات حسب المادة</h2><p>توزيع الحجوزات غير الملغاة</p></div></div>
          {bySubject.length ? <div className="report-meters">{bySubject.map((item) => (
            <div className="subject-meter" key={item.name}><div><span>{item.name}</span><b>{item.count}</b></div><i><em style={{ width: `${Math.max(5, (item.count / bySubject[0].count) * 100)}%` }} /></i></div>
          ))}</div> : <p className="report-empty">لا توجد حجوزات في الفترة المحددة.</p>}
        </section>
        <section className="panel report-chart">
          <div className="panel-title"><div><h2>الحجوزات حسب المرحلة</h2><p>توزيع الاستفادة بين المراحل الدراسية</p></div></div>
          {byStage.length ? <div className="stage-bars">{(['متوسط', 'ثانوي'] as const).map((stage) => {
            const count = byStage.find((item) => item.name === stage)?.count || 0;
            const percent = activeReservations.length ? Math.round((count / activeReservations.length) * 100) : 0;
            return <div className="stage-bar" key={stage}><div><span>{stage}</span><b>{count} حجز · {percent}%</b></div><i><em style={{ width: `${percent}%` }} /></i></div>;
          })}</div> : <p className="report-empty">لا توجد حجوزات في الفترة المحددة.</p>}
        </section>
        <section className="panel report-chart">
          <div className="panel-title"><div><h2>نشاط المعلمين</h2><p>الحجوزات المسجلة لكل معلم خلال الفترة المختارة</p></div></div>
          {teacherActivity.length ? <div className="report-meters">{teacherActivity.map((teacher) => (
            <div className="subject-meter" key={teacher.id}>
              <div><span>{teacher.name} · {teacher.isActive ? 'نشط' : 'غير مفعّل'}</span><b>{teacher.total} حجز · {teacher.completed} منفذ</b></div>
              <i><em style={{ width: `${Math.max(5, (teacher.total / Math.max(1, teacherActivity[0].total)) * 100)}%` }} /></i>
            </div>
          ))}</div> : <p className="report-empty">لا توجد حسابات معلمين أو حجوزات لهم خلال الفترة.</p>}
        </section>
      </div>

      <div className="report-layout">
        <section className="report-paper" id="print-report">
          <div className="official-head">
            <div className="report-seal">وزارة<br />التعليم</div>
            <div><b>المملكة العربية السعودية</b><strong>وزارة التعليم</strong><span>الإدارة العامة للتعليم بمنطقة عسير</span><span>{data.settings.school}</span></div>
            <div className="report-code">مركز مصادر التعلم<br /><small>تقرير إحصائي</small></div>
          </div>
          <div className="report-title"><h2>تقرير إشغال مركز مصادر التعلم</h2><p>الفترة من {formatDate(range.start, { day: 'numeric', month: 'long', year: 'numeric' })} إلى {formatDate(range.end, { day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
          <div className="report-summary"><b>ملخص الفترة</b><p>بلغ عدد الحجوزات <strong>{reservations.length}</strong> حجزًا، نُفذ منها <strong>{completed.length}</strong> حصة من أصل <strong>{capacity}</strong> فترة مدرسية مؤهلة، بنسبة إشغال فعلية قدرها <strong>{occupancy}%</strong>.</p></div>
          <div className="report-summary report-summary-secondary"><span>الملغاة: <b>{cancelled.length}</b></span><span>غير المنفذة: <b>{missed.length}</b></span><span>الأكثر استخدامًا: <b>{bestSubject}</b></span><span>الصف الأكثر استفادة: <b>{bestGrade}</b></span></div>
          <div className="report-table">
            <b>نشاط المعلمين</b>
            <table><thead><tr><th>المعلم</th><th>حجوزات الفترة</th><th>الحصص المنفذة</th><th>حالة الحساب</th></tr></thead>
              <tbody>{teacherActivity.length ? teacherActivity.map((teacher) => (
                <tr key={teacher.id}><td>{teacher.name}</td><td>{teacher.total}</td><td>{teacher.completed}</td><td>{teacher.isActive ? 'نشط' : 'غير مفعّل'}</td></tr>
              )) : <tr><td colSpan={4}>لا توجد حسابات معلمين</td></tr>}</tbody>
            </table>
          </div>
          <div className="report-table">
            <b>تفاصيل الحجوزات</b>
            <table><thead><tr><th>التاريخ</th><th>المعلم</th><th>المادة</th><th>الصف</th><th>الفترة</th><th>الحالة</th></tr></thead>
              <tbody>{reservations.length ? reservations.map((reservation: Reservation) => (
                <tr key={reservation.id}><td>{formatDate(reservation.date, { day: 'numeric', month: 'short' })}</td><td>{reservation.teacherName}</td><td>{reservation.subject}</td><td>{reservation.grade}</td><td>{reservation.period}</td><td>{reservation.status}</td></tr>
              )) : <tr><td colSpan={6}>لا توجد حجوزات في الفترة المحددة</td></tr>}</tbody>
            </table>
          </div>
          <div className="signatures"><div><span>أمين مركز مصادر التعلم</span><b>{data.settings.centerAdmin}</b><i>التوقيع: __________________</i></div><div><span>اعتماد قائد المدرسة</span><b>{data.settings.principal}</b><i>التوقيع: __________________</i></div></div>
        </section>
        <aside className="panel report-side">
          <div className="panel-title"><div><h2>تنزيل التقرير</h2><p>تصدير بيانات الفترة الحالية</p></div></div>
          <button className="btn btn-primary" onClick={() => window.print()} data-testid="button-export-pdf">طباعة / حفظ PDF</button>
          <button
            className="btn btn-secondary"
            onClick={downloadWord}
            disabled={exportingWord}
            aria-busy={exportingWord}
            data-testid="button-export-word"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            {exportingWord && <Spinner size="sm" />}
            <span>{exportingWord ? 'جارٍ إنشاء ملف Word…' : 'تنزيل Word (DOCX)'}</span>
          </button>
        </aside>
      </div>
    </>
  );
}
