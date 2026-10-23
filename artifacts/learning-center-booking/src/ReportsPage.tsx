import { useMemo, useState } from 'react';
import { ChartNoAxesCombined, Check, ClipboardList, Clock3 } from 'lucide-react';
import type { DemoData, Reservation } from './data';

type Props = { data: DemoData };
type RangePreset = 'weekly' | 'monthly' | 'custom';

const dateISO = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const todayISO = () => dateISO(new Date());

const formatDate = (value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) =>
  new Intl.DateTimeFormat('ar-SA-u-ca-gregory', options).format(new Date(`${value}T12:00:00`));

const sundayOf = (value: string) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - date.getDay());
  return dateISO(date);
};

const lastDayOfMonth = (value: string) => {
  const [year, month] = value.split('-').map(Number);
  return dateISO(new Date(year, month, 0));
};

function schoolPeriods(data: DemoData, start: string, end: string) {
  let periods = 0;
  for (const date = new Date(`${start}T12:00:00`); date <= new Date(`${end}T12:00:00`); date.setDate(date.getDate() + 1)) {
    if (date.getDay() <= 4) periods += 7;
  }
  const blocked = data.blocked.filter((slot) => {
    const day = new Date(`${slot.date}T12:00:00`).getDay();
    return slot.date >= start && slot.date <= end && day <= 4;
  }).length;
  return Math.max(0, periods - blocked);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateISO(date);
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
  const bySubject = countBy(activeReservations, (reservation) => reservation.subject);
  const byGrade = countBy(activeReservations, (reservation) => reservation.grade);
  const byStage = countBy(activeReservations, (reservation) => reservation.stage);
  const bestSubject = bySubject[0]?.name || '—';
  const bestGrade = byGrade[0]?.name || '—';

  const trend = useMemo(() => {
    const start = new Date(`${range.start}T12:00:00`);
    const end = new Date(`${range.end}T12:00:00`);
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
          <div className="panel-title"><div><h2>تنزيل التقرير</h2><p>سيُتاح التصدير في المرحلة الثالثة</p></div></div>
          <p className="phase-note">أزرار PDF وWord غير متاحة في هذا الإصدار التجريبي.</p>
          <button className="btn btn-disabled" disabled data-testid="button-export-pdf">تصدير PDF · المرحلة الثالثة</button>
          <button className="btn btn-disabled" disabled data-testid="button-export-word">تصدير Word · المرحلة الثالثة</button>
          <p className="demo-advisory">تستند الإحصاءات إلى بيانات العرض المحفوظة محليًا فقط.</p>
        </aside>
      </div>
    </>
  );
}
