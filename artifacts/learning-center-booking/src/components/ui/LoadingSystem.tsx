import { type CSSProperties, type ReactNode } from 'react';

export type SpinnerSize = 'sm' | 'md' | 'lg' | 'xl';

const sizeMap: Record<SpinnerSize, { size: number; stroke: number }> = {
  sm: { size: 16, stroke: 2.2 },
  md: { size: 24, stroke: 2.8 },
  lg: { size: 36, stroke: 3.2 },
  xl: { size: 48, stroke: 3.8 },
};

export function Spinner({
  size = 'md',
  color = '#1C6254',
  trackColor = '#e3ece8',
  className = '',
  centered = false,
  label = 'جارٍ التحميل…',
}: {
  size?: SpinnerSize;
  color?: string;
  trackColor?: string;
  className?: string;
  centered?: boolean;
  label?: string;
}) {
  const { size: px, stroke } = sizeMap[size];
  const radius = (px - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * 0.35;

  const spinnerSvg = (
    <svg
      role="status"
      aria-live="polite"
      aria-label={label}
      className={`app-spinner ${className}`}
      width={px}
      height={px}
      viewBox={`0 0 ${px} ${px}`}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        animation: 'app-spin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite',
      }}
    >
      <circle
        cx={px / 2}
        cy={px / 2}
        r={radius}
        fill="none"
        stroke={trackColor}
        strokeWidth={stroke}
      />
      <circle
        cx={px / 2}
        cy={px / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
      />
    </svg>
  );

  if (centered) {
    return (
      <div className="spinner-centered" style={{ display: 'grid', placeItems: 'center', padding: '24px' }}>
        {spinnerSvg}
      </div>
    );
  }

  return spinnerSvg;
}

export function LinearProgress({
  active = true,
  className = '',
  style,
}: {
  active?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  if (!active) return null;

  return (
    <div
      role="progressbar"
      aria-busy="true"
      aria-label="جارٍ معالجة البيانات…"
      className={`linear-progress-track ${className}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '3px',
        overflow: 'hidden',
        backgroundColor: '#e7eeea',
        ...style,
      }}
    >
      <div
        className="linear-progress-bar"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          backgroundColor: '#1C6254',
          borderRadius: '2px',
          animation: 'app-progress-indeterminate 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        }}
      />
    </div>
  );
}

export function PageProgressBar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
      }}
    >
      <LinearProgress />
    </div>
  );
}

export function Skeleton({
  width,
  height,
  borderRadius = '6px',
  className = '',
  style,
}: {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className={`app-skeleton ${className}`}
      style={{
        width: width ?? '100%',
        height: height ?? '18px',
        borderRadius,
        backgroundColor: '#edf3f0',
        backgroundImage: 'linear-gradient(90deg, #edf3f0 0%, #f7faf8 50%, #edf3f0 100%)',
        backgroundSize: '200% 100%',
        animation: 'app-shimmer 1.5s ease-in-out infinite',
        ...style,
      }}
    />
  );
}

export function SkeletonStatGrid({ count = 3 }: { count?: number }) {
  return (
    <div className={`stat-grid ${count === 4 ? 'four' : ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="stat-card" key={i}>
          <div className="stat-icon" style={{ backgroundColor: '#edf3f0' }}>
            <Skeleton width="18px" height="18px" borderRadius="4px" />
          </div>
          <div className="stat-copy" style={{ flex: 1, gap: '6px' }}>
            <Skeleton width="45%" height="11px" />
            <Skeleton width="30%" height="26px" />
            <Skeleton width="75%" height="10px" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap" aria-hidden="true">
      <table>
        <thead>
          <tr>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i}>
                <Skeleton width="70%" height="12px" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <Skeleton width={c === 0 ? '55%' : c === 1 ? '75%' : '60%'} height="13px" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonScheduleGrid() {
  return (
    <div className="schedule-grid" aria-hidden="true">
      <div className="schedule-head">
        <div className="period-heading">الفترة</div>
        {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'].map((name) => (
          <div key={name} className="day-heading">
            <b>{name}</b>
            <Skeleton width="60%" height="10px" style={{ margin: '4px auto 0' }} />
          </div>
        ))}
      </div>
      {Array.from({ length: 7 }, (_, p) => (
        <div className="schedule-row" key={p}>
          <div className="period-cell">
            <b>{p + 1}</b>
            <small>الحصة</small>
          </div>
          {Array.from({ length: 5 }, (_, d) => (
            <div key={d} className="slot slot-available" style={{ cursor: 'default' }}>
              <Skeleton width="70%" height="12px" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function FullPageLoading({
  message = 'جارٍ تحميل بيانات المركز…',
  submessage,
}: {
  message?: string;
  submessage?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="loading-screen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        minHeight: '60dvh',
      }}
    >
      <Spinner size="xl" />
      <span style={{ fontSize: '15px', fontWeight: 600, color: '#1C6254' }}>{message}</span>
      {submessage && (
        <span style={{ fontSize: '12px', color: '#6A7873', marginTop: '-4px' }}>{submessage}</span>
      )}
    </div>
  );
}
