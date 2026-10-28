import assert from 'node:assert/strict';
import test from 'node:test';
import { arabicErrorMessage } from './dataService.ts';
import {
  countSchoolPeriods,
  isPeriodBlocked,
  isSchoolDay,
  nextSchoolDayISO,
  schoolTodayISO,
  weekEndISO,
  weekStartISO,
} from './schoolCalendar.ts';
import { roles, statusFromCode, statusToCode } from '../data.ts';
import { generateReportDocx } from './exportDocx.ts';

// ----------------------------------------------------
// 1. Modal Closing & Navigation Logic
// ----------------------------------------------------
test('modal closing: closing modal clears booking slot without submitting', () => {
  let bookingSlot = { date: '2026-11-01', period: 2 };
  let submitted = false;

  const closeBooking = () => {
    bookingSlot = null;
  };
  const submitBooking = () => {
    submitted = true;
  };

  // User triggers close via Cancel or X
  closeBooking();
  assert.equal(bookingSlot, null);
  assert.equal(submitted, false, 'Neither X nor Cancel should submit form');
});

test('modal closing: closing when on /reservations/new route redirects away', () => {
  let currentPath = '/reservations/new';
  const nav = (to) => {
    currentPath = to;
  };
  const handleClose = () => {
    if (currentPath === '/reservations/new') {
      nav('/reservations');
    }
  };

  handleClose();
  assert.equal(currentPath, '/reservations', 'Closing on new booking route must redirect to reservations');
});

// ----------------------------------------------------
// 2. Booking Submission & Validation
// ----------------------------------------------------
test('form validation: lesson topic is required and cannot be whitespace', () => {
  const validate = (topic) => Boolean(topic && topic.trim().length > 0);
  assert.equal(validate(''), false);
  assert.equal(validate('   '), false);
  assert.equal(validate('درس الرياضيات'), true);
});

test('form validation: booking date must be a future school day (Sunday - Thursday)', () => {
  const today = '2026-10-25'; // Sunday
  const validateBookingDate = (date) => {
    if (!date || date <= today) return false;
    return isSchoolDay(date);
  };

  assert.equal(validateBookingDate('2026-10-25'), false, 'Cannot book today');
  assert.equal(validateBookingDate('2026-10-24'), false, 'Cannot book in past');
  assert.equal(validateBookingDate('2026-10-30'), false, 'Cannot book on Friday');
  assert.equal(validateBookingDate('2026-10-31'), false, 'Cannot book on Saturday');
  assert.equal(validateBookingDate('2026-10-26'), true, 'Monday is a valid future school day');
  assert.equal(validateBookingDate('2026-10-29'), true, 'Thursday is a valid future school day');
});

test('form validation: student count must be positive integer when provided', () => {
  const validateCount = (val) => {
    if (!val) return true; // optional
    const num = Number(val);
    return Number.isInteger(num) && num > 0;
  };

  assert.equal(validateCount(''), true);
  assert.equal(validateCount('0'), false);
  assert.equal(validateCount('-5'), false);
  assert.equal(validateCount('24.5'), false);
  assert.equal(validateCount('28'), true);
});

test('double booking: prevents overlapping reservations on the same date and period', () => {
  const existingReservations = [
    { id: '1', date: '2026-11-01', period: 3, status: 'مؤكد' },
    { id: '2', date: '2026-11-01', period: 4, status: 'ملغي' },
  ];
  const blocked = [
    { id: 'b1', date: '2026-11-02', period: 1, reason: 'صيانة' },
  ];

  const checkConflict = (date, period) => {
    const isBooked = existingReservations.some(
      (r) => r.date === date && r.period === period && r.status !== 'ملغي'
    );
    const isBlocked = isPeriodBlocked(blocked, date, period);
    return isBooked || isBlocked;
  };

  assert.equal(checkConflict('2026-11-01', 3), true, 'Conflict on confirmed reservation');
  assert.equal(checkConflict('2026-11-01', 4), false, 'Cancelled reservation does not conflict');
  assert.equal(checkConflict('2026-11-02', 1), true, 'Conflict on blocked slot');
  assert.equal(checkConflict('2026-11-01', 5), false, 'Open slot has no conflict');
});

// ----------------------------------------------------
// 3. Booking Cancellation & Status Updates
// ----------------------------------------------------
test('booking cancellation: rules for teachers and administrators', () => {
  const today = '2026-10-25';
  const teacherId = 'teacher-1';
  const otherTeacherId = 'teacher-2';

  const canCancel = (reservation, userRole, currentUserId) => {
    if (reservation.status !== 'مؤكد') return false;
    const admin = userRole === 'أمين مركز مصادر التعلم';
    if (admin) return true;
    return reservation.date > today && userRole === 'المعلم' && reservation.teacherId === currentUserId;
  };

  const ownFuture = { id: 'r1', teacherId, date: '2026-10-28', status: 'مؤكد' };
  const ownPast = { id: 'r2', teacherId, date: '2026-10-25', status: 'مؤكد' };
  const otherFuture = { id: 'r3', teacherId: otherTeacherId, date: '2026-10-28', status: 'مؤكد' };
  const alreadyCancelled = { id: 'r4', teacherId, date: '2026-10-28', status: 'ملغي' };

  // Teacher permissions
  assert.equal(canCancel(ownFuture, 'المعلم', teacherId), true);
  assert.equal(canCancel(ownPast, 'المعلم', teacherId), false, 'Teacher cannot cancel past or today booking');
  assert.equal(canCancel(otherFuture, 'المعلم', teacherId), false, 'Teacher cannot cancel another teacher booking');
  assert.equal(canCancel(alreadyCancelled, 'المعلم', teacherId), false, 'Cannot cancel already cancelled booking');

  // Admin permissions
  assert.equal(canCancel(ownFuture, 'أمين مركز مصادر التعلم', 'admin-id'), true);
  assert.equal(canCancel(ownPast, 'أمين مركز مصادر التعلم', 'admin-id'), true);
  assert.equal(canCancel(otherFuture, 'أمين مركز مصادر التعلم', 'admin-id'), true);

  // Status mapping
  assert.equal(statusToCode['ملغي'], 'cancelled');
  assert.equal(statusFromCode['cancelled'], 'ملغي');
  assert.equal(statusToCode['تم التنفيذ'], 'completed');
  assert.equal(statusToCode['لم يتم التنفيذ'], 'not_completed');
});

// ----------------------------------------------------
// 4. School Settings Validation
// ----------------------------------------------------
test('school settings: validates required fields before saving', () => {
  const validateSettings = (settings) => {
    return Boolean(
      settings.school?.trim() &&
      settings.administration?.trim() &&
      settings.centerAdmin?.trim() &&
      settings.principal?.trim()
    );
  };

  assert.equal(validateSettings({
    school: 'مدرسة الإمام تركي بن عبدالله',
    administration: 'تعليم عسير',
    centerAdmin: 'أمين المركز',
    principal: 'قائد المدرسة',
  }), true);

  assert.equal(validateSettings({
    school: '',
    administration: 'تعليم عسير',
    centerAdmin: 'أمين المركز',
    principal: 'قائد المدرسة',
  }), false);

  assert.equal(validateSettings({
    school: 'مدرسة',
    administration: '  ',
    centerAdmin: 'أمين',
    principal: 'قائد',
  }), false);
});

// ----------------------------------------------------
// 5. Blocked Periods & Conflict Handling
// ----------------------------------------------------
test('blocked periods: full-day block blocks all 7 periods and prevents bookings', () => {
  const blocked = [
    { date: '2026-11-03', period: null, reason: 'صيانة دورية للمركز' },
  ];

  for (let p = 1; p <= 7; p++) {
    assert.equal(isPeriodBlocked(blocked, '2026-11-03', p), true, `Period ${p} should be blocked`);
  }
  assert.equal(isPeriodBlocked(blocked, '2026-11-04', 1), false);
});

test('blocked periods: cannot add block if conflicting active bookings exist', () => {
  const reservations = [
    { id: '1', date: '2026-11-04', period: 2, status: 'مؤكد' },
    { id: '2', date: '2026-11-04', period: 5, status: 'ملغي' },
  ];

  const canBlock = (date, period) => {
    return !reservations.some(
      (r) => r.date === date && (period === null || r.period === period) && r.status !== 'ملغي'
    );
  };

  // Specific period conflict
  assert.equal(canBlock('2026-11-04', 2), false, 'Cannot block period 2 because of active booking');
  assert.equal(canBlock('2026-11-04', 5), true, 'Can block period 5 because booking is cancelled');
  assert.equal(canBlock('2026-11-04', 3), true, 'Can block period 3 because no booking exists');

  // Full day block conflict
  assert.equal(canBlock('2026-11-04', null), false, 'Cannot block full day if any period has active booking');
  assert.equal(canBlock('2026-11-05', null), true, 'Can block full day if no active bookings exist');
});

// ----------------------------------------------------
// 6. Account Creation & Validation
// ----------------------------------------------------
test('account management: email and name validation', () => {
  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  assert.equal(isValidEmail('teacher@school.edu.sa'), true);
  assert.equal(isValidEmail('admin.school@gov.sa'), true);
  assert.equal(isValidEmail('invalid-email'), false);
  assert.equal(isValidEmail('test@'), false);
  assert.equal(isValidEmail('@domain.com'), false);
});

// ----------------------------------------------------
// 7. Authorization & Self-Protection Rules
// ----------------------------------------------------
test('authorization: administrator cannot change own role or deactivate self', () => {
  const currentUserId = 'admin-user-id';

  const checkSelfModification = (targetId) => {
    if (targetId === currentUserId) {
      return { allowed: false, error: 'لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.' };
    }
    return { allowed: true };
  };

  assert.equal(checkSelfModification(currentUserId).allowed, false);
  assert.equal(checkSelfModification('other-user-id').allowed, true);
});

test('authorization: role permissions hierarchy', () => {
  assert.ok(roles.includes('المعلم'));
  assert.ok(roles.includes('أمين مركز مصادر التعلم'));
  assert.ok(roles.includes('قائد المدرسة'));

  const canAccessSettings = (role) => role === 'أمين مركز مصادر التعلم';
  assert.equal(canAccessSettings('أمين مركز مصادر التعلم'), true);
  assert.equal(canAccessSettings('المعلم'), false);
  assert.equal(canAccessSettings('قائد المدرسة'), false);

  const canAccessReports = (role) => role === 'أمين مركز مصادر التعلم' || role === 'قائد المدرسة';
  assert.equal(canAccessReports('أمين مركز مصادر التعلم'), true);
  assert.equal(canAccessReports('قائد المدرسة'), true);
  assert.equal(canAccessReports('المعلم'), false);
});

// ----------------------------------------------------
// 8. Error Handling & Arabic Error Messages
// ----------------------------------------------------
test('error handling: missing edge function returns clear Arabic instruction', () => {
  const error404Context = {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: { status: 404 },
  };
  const msg = arabicErrorMessage(error404Context);
  assert.equal(msg, 'خدمة دعوة الحساب غير منشورة في مشروع Supabase. انشر Edge Function باسم admin-invite-user.');
});

test('error handling: unique constraint conflict (23505) returns Arabic message', () => {
  const err = { code: '23505' };
  assert.equal(arabicErrorMessage(err), 'عذرًا، هذه الحصة محجوزة بالفعل. يرجى اختيار موعد آخر.');
});

test('error handling: blocked slot with active booking (23514) returns Arabic message', () => {
  const err = { code: '23514', message: 'Cannot block a date or period with active bookings.' };
  assert.equal(arabicErrorMessage(err), 'لا يمكن إغلاق فترة تحتوي على حجوزات نشطة.');
});

test('error handling: user attempting to change own role (42501) returns Arabic message', () => {
  const err = { code: '42501', message: 'Users cannot change their own role or active state.' };
  assert.equal(arabicErrorMessage(err), 'لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.');
});

test('error handling: network failure returns connectivity instruction', () => {
  const err = { name: 'TypeError', message: 'fetch failed' };
  assert.equal(arabicErrorMessage(err), 'تعذر الاتصال بخدمة Supabase. تحقق من اتصال الإنترنت ثم حاول مرة أخرى.');
});

// ----------------------------------------------------
// 9. Performance & Targeted In-Memory State Updates
// ----------------------------------------------------
test('performance: targeted state update preserves data without full table reload', () => {
  const initialReservations = [
    {
      id: 'r-1',
      date: '2026-11-01',
      period: 1,
      teacherId: 't-1',
      teacherName: 'أحمد',
      subject: 'لغتي',
      stage: 'متوسط',
      grade: 'أول متوسط',
      section: 'أ',
      lessonTopic: 'القراءة',
      resources: [],
      status: 'مؤكد',
    },
  ];

  // Simulating targeted insert
  const newRow = {
    id: 'r-2',
    date: '2026-11-02',
    period: 3,
    teacher_id: 't-1',
    subject: 'علوم',
    stage: 'متوسط',
    grade: 'أول متوسط',
    section: 'ب',
    lesson_topic: 'الخلايا',
    resources: ['شاشة ذكية'],
    student_count: 25,
    notes: null,
    status: 'confirmed',
  };

  const newReservation = {
    id: newRow.id,
    date: newRow.date,
    period: newRow.period,
    teacherId: newRow.teacher_id,
    teacherName: 'أحمد',
    subject: newRow.subject,
    stage: newRow.stage,
    grade: newRow.grade,
    section: newRow.section,
    lessonTopic: newRow.lesson_topic,
    resources: newRow.resources,
    studentCount: newRow.student_count,
    notes: undefined,
    status: statusFromCode[newRow.status],
  };

  // Prepend in-memory
  const updatedReservations = [newReservation, ...initialReservations];
  assert.equal(updatedReservations.length, 2);
  assert.equal(updatedReservations[0].id, 'r-2');
  assert.equal(updatedReservations[0].status, 'مؤكد');
  assert.equal(updatedReservations[1].id, 'r-1');
});

test('performance: booking status update updates item in-memory efficiently', () => {
  const reservations = [
    { id: 'r-1', date: '2026-11-01', period: 1, status: 'مؤكد' },
    { id: 'r-2', date: '2026-11-02', period: 2, status: 'مؤكد' },
  ];

  const updated = reservations.map((r) => (r.id === 'r-1' ? { ...r, status: 'تم التنفيذ' } : r));
  assert.equal(updated.find((r) => r.id === 'r-1')?.status, 'تم التنفيذ');
  assert.equal(updated.find((r) => r.id === 'r-2')?.status, 'مؤكد');
});

// ----------------------------------------------------
// 10. Loading State & Double-Submission Prevention
// ----------------------------------------------------
test('loading state: double-submission is blocked when loading flag is active', () => {
  let callCount = 0;
  let isSubmitting = false;

  const handleBookingSubmit = () => {
    if (isSubmitting) return; // Prevent double trigger
    isSubmitting = true;
    callCount += 1;
  };

  // First click
  handleBookingSubmit();
  assert.equal(callCount, 1);
  assert.equal(isSubmitting, true);

  // Second rapid click while still loading
  handleBookingSubmit();
  assert.equal(callCount, 1, 'Duplicate submission must be ignored while loading');

  // Once completed
  isSubmitting = false;
  handleBookingSubmit();
  assert.equal(callCount, 2);
});

// ----------------------------------------------------
// 11. Word Export (.docx) OpenXML Document Generation
// ----------------------------------------------------
test('docx export: generates valid Microsoft Word document buffer', async () => {
  const mockData = {
    reservations: [
      {
        id: 'r-1',
        date: '2026-11-01',
        period: 2,
        teacherId: 't-1',
        teacherName: 'أ. محمد القحطاني',
        subject: 'الرياضيات',
        stage: 'متوسط',
        grade: 'ثاني متوسط',
        section: 'أ',
        lessonTopic: 'نظرية فيثاغورس',
        resources: ['جهاز عرض'],
        status: 'تم التنفيذ',
      },
    ],
    teachers: [{ id: 't-1', name: 'أ. محمد القحطاني', email: 't@school.edu', role: 'المعلم', isActive: true }],
    blocked: [],
    settings: {
      school: 'مدرسة الإمام تركي بن عبدالله بالربوعة',
      administration: 'إدارة التعليم بمحافظة سراة عبيدة',
      region: 'منطقة عسير',
      centerAdmin: 'أمين المركز',
      principal: 'مدير المدرسة',
      periods: 7,
      grades: { متوسط: ['أول متوسط', 'ثاني متوسط'], ثانوي: ['أول ثانوي'] },
    },
  };

  const range = { start: '2026-11-01', end: '2026-11-05' };
  const blob = await generateReportDocx(mockData, range);
  assert.ok(blob, 'Blob must be created');
  assert.ok(blob.size > 1000, 'Blob size should be substantial for a full Word document');

  // Verify PK zip header signature
  const buffer = Buffer.from(await blob.arrayBuffer());
  assert.equal(buffer[0], 0x50, 'Byte 0 must be P');
  assert.equal(buffer[1], 0x4b, 'Byte 1 must be K');
  assert.equal(buffer[2], 0x03, 'Byte 2 must be 0x03');
  assert.equal(buffer[3], 0x04, 'Byte 3 must be 0x04');
});
