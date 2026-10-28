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

export function isBookableDate(date: string, today: string): boolean {
  // Mirrors the database rule: bookings must be on a future school day.
  return date > today && isSchoolDay(date);
}

export type SlotState = 'reserved' | 'blocked' | 'past' | 'available';

export function slotState(date: string, today: string, reserved: boolean, blocked: boolean): SlotState {
  if (reserved) return 'reserved';
  if (blocked) return 'blocked';
  return date <= today ? 'past' : 'available';
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
