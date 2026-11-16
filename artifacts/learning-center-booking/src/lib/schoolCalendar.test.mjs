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

import { isBookableDate, isProfilePending, scheduleAnchorFor, schoolNowTime, slotState } from './schoolCalendar.ts';

// 2026-10-29 is a Thursday, 2026-10-30/31 are Friday/Saturday (Riyadh).
test('Thursday is bookable; Friday and Saturday are rejected', () => {
  assert.equal(isBookableDate('2026-10-29', '2026-10-28'), true);
  assert.equal(isBookableDate('2026-10-30', '2026-10-28'), false);
  assert.equal(isBookableDate('2026-10-31', '2026-10-28'), false);
  assert.equal(isBookableDate('2026-11-01', '2026-10-28'), true);
});

test('same day: bookable until the period starts (Thursday included)', () => {
  // No configured start time: today stays bookable.
  assert.equal(isBookableDate('2026-10-29', '2026-10-29'), true);
  assert.equal(isBookableDate('2026-10-29', '2026-10-29', { nowTime: '07:10:00', start: '07:30:00' }), true);
  assert.equal(isBookableDate('2026-10-29', '2026-10-29', { nowTime: '07:30:00', start: '07:30:00' }), false);
  assert.equal(isBookableDate('2026-10-28', '2026-10-29'), false);
});

test('booking window: up to N days ahead', () => {
  // 2026-11-26 (Thursday) is exactly 29 days after 2026-10-28.
  assert.equal(isBookableDate('2026-11-26', '2026-10-28', { windowDays: 29 }), true);
  assert.equal(isBookableDate('2026-11-26', '2026-10-28', { windowDays: 28 }), false);
  assert.equal(isBookableDate('2026-12-01', '2026-10-28', { windowDays: 30 }), false);
  assert.equal(slotState('2026-12-01', '2026-10-28', false, false, { windowDays: 30 }), 'closed');
});

test('grid slot states follow period start, reservations and blocks', () => {
  assert.equal(slotState('2026-10-28', '2026-10-28', false, false), 'available');
  assert.equal(slotState('2026-10-28', '2026-10-28', false, false, { nowTime: '09:00:00', start: '08:15:00' }), 'past');
  assert.equal(slotState('2026-10-27', '2026-10-28', false, false), 'past');
  assert.equal(slotState('2026-10-28', '2026-10-28', true, false), 'reserved');
  assert.equal(slotState('2026-10-28', '2026-10-28', false, true), 'blocked');
});

test('grid opens on next week after the last Thursday period starts', () => {
  assert.equal(scheduleAnchorFor('2026-10-29', '10:00:00', '12:30:00'), '2026-10-29');
  assert.equal(scheduleAnchorFor('2026-10-29', '12:31:00', '12:30:00'), '2026-11-01');
  assert.equal(scheduleAnchorFor('2026-10-29', '23:00:00', null), '2026-10-29');
  assert.equal(scheduleAnchorFor('2026-10-30', '08:00:00', null), '2026-11-01');
});

test('Riyadh clock is used for the current time', () => {
  assert.equal(schoolNowTime(new Date('2026-10-28T21:05:09.000Z')), '00:05:09');
});

test('profile counts as pending between session arrival and fetch completion', () => {
  assert.equal(isProfilePending('u1', null, false, false), true);
  assert.equal(isProfilePending('u1', 'u0', false, false), true);
  assert.equal(isProfilePending('u1', 'u1', false, false), false);
  assert.equal(isProfilePending('u1', 'u1', true, false), true);
  assert.equal(isProfilePending('u1', null, false, true), false);
  assert.equal(isProfilePending(null, null, false, false), false);
});
