export type BlockedPeriod = { date: string; period: number | null };

const dateParts = (value: string) => value.split('-').map(Number);

export function schoolTodayISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function dateFromISO(value: string): Date {
  const [year, month, day] = dateParts(value);
  return new Date(Date.UTC(year, month - 1, day));
}

export function dateToISO(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function addSchoolDays(value: string, amount: number): string {
  const date = dateFromISO(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateToISO(date);
}

export function weekdayForISO(value: string): number {
  return dateFromISO(value).getUTCDay();
}

export function weekStartISO(value: string): string {
  return addSchoolDays(value, -weekdayForISO(value));
}

export function weekEndISO(value: string): string {
  return addSchoolDays(weekStartISO(value), 4);
}

export function isSchoolDay(value: string): boolean {
  return weekdayForISO(value) <= 4;
}

export function nextSchoolDayISO(value: string): string {
  let next = addSchoolDays(value, 1);
  while (!isSchoolDay(next)) next = addSchoolDays(next, 1);
  return next;
}

export function isPeriodBlocked(blocked: BlockedPeriod[], date: string, period: number): boolean {
  return blocked.some((slot) => slot.date === date && (slot.period === null || slot.period === period));
}

export function countSchoolPeriods(blocked: BlockedPeriod[], start: string, end: string, periodsPerDay = 7): number {
  let capacity = 0;
  for (let date = start; date <= end; date = addSchoolDays(date, 1)) {
    if (isSchoolDay(date)) capacity += periodsPerDay;
  }

  const blockedCount = blocked.reduce((count, slot) => {
    if (slot.date < start || slot.date > end || !isSchoolDay(slot.date)) return count;
    return count + (slot.period === null ? periodsPerDay : 1);
  }, 0);

  return Math.max(0, capacity - blockedCount);
}

export function formatSchoolDate(value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }): string {
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { ...options, timeZone: 'UTC' }).format(dateFromISO(value));
}

// Current Riyadh wall-clock time as "HH:MM:SS".
export function schoolNowTime(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '00';
  return `${part('hour')}:${part('minute')}:${part('second')}`;
}

export type SlotTiming = { nowTime?: string; start?: string | null; windowDays?: number };

// Mirrors the database: a period is closed once its start time has passed.
// Without a configured start time, today's period counts as not yet started.
export function hasPeriodStarted(date: string, today: string, nowTime = '00:00:00', start: string | null = null): boolean {
  if (date < today) return true;
  if (date > today) return false;
  return start !== null && start.slice(0, 8) <= nowTime;
}

export function isBeyondWindow(date: string, today: string, windowDays?: number): boolean {
  return windowDays !== undefined && date > addSchoolDays(today, windowDays);
}

export function isBookableDate(date: string, today: string, timing: SlotTiming = {}): boolean {
  return isSchoolDay(date)
    && !hasPeriodStarted(date, today, timing.nowTime, timing.start ?? null)
    && !isBeyondWindow(date, today, timing.windowDays);
}

export type SlotState = 'reserved' | 'blocked' | 'past' | 'closed' | 'available';

export function slotState(date: string, today: string, reserved: boolean, blocked: boolean, timing: SlotTiming = {}): SlotState {
  if (reserved) return 'reserved';
  if (blocked) return 'blocked';
  if (hasPeriodStarted(date, today, timing.nowTime, timing.start ?? null)) return 'past';
  return isBeyondWindow(date, today, timing.windowDays) ? 'closed' : 'available';
}

// Week the grid opens on: next week once nothing in this week can be booked
// (weekend, or Thursday after its last period started).
export function scheduleAnchorFor(today: string, nowTime: string, lastPeriodStart: string | null): string {
  const end = weekEndISO(today);
  const thursdayOver = today === end && lastPeriodStart !== null && lastPeriodStart.slice(0, 8) <= nowTime;
  return end < today || thursdayOver ? addSchoolDays(weekStartISO(today), 7) : today;
}

// True while a signed-in user's profile has not finished loading. The render
// between the session arriving and the fetch starting must count as loading,
// otherwise a missing profile is reported before it was ever requested.
export function isProfilePending(
  userId: string | null,
  settledFor: string | null,
  profileLoading: boolean,
  hasError: boolean,
): boolean {
  return profileLoading || (userId !== null && !hasError && settledFor !== userId);
}
