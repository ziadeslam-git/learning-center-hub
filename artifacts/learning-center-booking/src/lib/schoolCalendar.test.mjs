import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countSchoolPeriods,
  isPeriodBlocked,
  isSchoolDay,
  nextSchoolDayISO,
  schoolTodayISO,
  weekEndISO,
  weekStartISO,
} from './schoolCalendar.ts';

test('school calendar uses the Riyadh date across the UTC midnight boundary', () => {
  assert.equal(schoolTodayISO(new Date('2026-10-25T20:59:00.000Z')), '2026-10-25');
  assert.equal(schoolTodayISO(new Date('2026-10-25T21:00:00.000Z')), '2026-10-26');
});

test('school week runs Sunday through Thursday and excludes Friday and Saturday', () => {
  assert.equal(weekStartISO('2026-10-28'), '2026-10-25');
  assert.equal(weekEndISO('2026-10-28'), '2026-10-29');
  assert.equal(isSchoolDay('2026-10-29'), true);
  assert.equal(isSchoolDay('2026-10-30'), false);
  assert.equal(isSchoolDay('2026-10-31'), false);
  assert.equal(nextSchoolDayISO('2026-10-29'), '2026-11-01');
});

test('capacity subtracts period blocks and all seven periods for a whole-day block', () => {
  const blocked = [
    { date: '2026-10-25', period: 3 },
    { date: '2026-10-26', period: null },
    { date: '2026-10-30', period: 1 },
  ];
  assert.equal(countSchoolPeriods(blocked, '2026-10-25', '2026-10-31'), 27);
  assert.equal(isPeriodBlocked(blocked, '2026-10-26', 7), true);
  assert.equal(isPeriodBlocked(blocked, '2026-10-25', 2), false);
});

import { isBookableDate, isProfilePending, slotState } from './schoolCalendar.ts';

test('today and weekends are not bookable, next school day is', () => {
  assert.equal(isBookableDate('2026-10-28', '2026-10-28'), false);
  assert.equal(isBookableDate('2026-10-30', '2026-10-28'), false);
  assert.equal(isBookableDate('2026-10-31', '2026-10-28'), false);
  assert.equal(isBookableDate('2026-10-29', '2026-10-28'), true);
  assert.equal(isBookableDate('2026-11-01', '2026-10-28'), true);
});

test('schedule slot for today is not shown as available, but reservations still show', () => {
  assert.equal(slotState('2026-10-28', '2026-10-28', false, false), 'past');
  assert.equal(slotState('2026-10-27', '2026-10-28', false, false), 'past');
  assert.equal(slotState('2026-10-29', '2026-10-28', false, false), 'available');
  assert.equal(slotState('2026-10-28', '2026-10-28', true, false), 'reserved');
  assert.equal(slotState('2026-10-28', '2026-10-28', false, true), 'blocked');
});

test('profile counts as pending between session arrival and fetch completion', () => {
  assert.equal(isProfilePending('u1', null, false, false), true);
  assert.equal(isProfilePending('u1', 'u0', false, false), true);
  assert.equal(isProfilePending('u1', 'u1', false, false), false);
  assert.equal(isProfilePending('u1', 'u1', true, false), true);
  assert.equal(isProfilePending('u1', null, false, true), false);
  assert.equal(isProfilePending(null, null, false, false), false);
});
