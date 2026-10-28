import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { DemoData, Reservation } from '../data.ts';
import { formatSchoolDate } from './schoolCalendar.ts';

const PRIMARY_COLOR = '1C6254';
const TEXT_DARK = '123B35';
const BORDER_COLOR = 'D8E2DE';
const BG_HEADER = 'EDF3F0';
const BG_SUMMARY = 'F4F7F5';
const FONT_FAMILY = 'Arial';

function arText(
  text: string,
  options: {
    bold?: boolean;
    size?: number;
    color?: string;
    italic?: boolean;
  } = {},
): TextRun {
  return new TextRun({
    text,
    font: FONT_FAMILY,
    size: options.size ?? 20, // 20 half-points = 10pt
    bold: options.bold ?? false,
    color: options.color ?? TEXT_DARK,
    italics: options.italic ?? false,
    rightToLeft: true,
  });
}

function arPara(
  runs: TextRun | TextRun[],
  options: {
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    spaceBefore?: number;
    spaceAfter?: number;
  } = {},
): Paragraph {
  const children = Array.isArray(runs) ? runs : [runs];
  return new Paragraph({
    children,
    bidirectional: true,
    alignment: options.alignment ?? AlignmentType.RIGHT,
    spacing: {
      before: options.spaceBefore ?? 60,
      after: options.spaceAfter ?? 60,
    },
  });
}

export async function generateReportDocx(
  data: DemoData,
  range: { start: string; end: string },
): Promise<Blob> {
  const reservations = data.reservations.filter(
    (r) => r.date >= range.start && r.date <= range.end,
  );
  const completed = reservations.filter((r) => r.status === 'تم التنفيذ');
  const cancelled = reservations.filter((r) => r.status === 'ملغي');
  const missed = reservations.filter((r) => r.status === 'لم يتم التنفيذ');
  const totalBookings = reservations.length;
  const completedCount = completed.length;

  const teacherActivity = data.teachers
    .filter(
      (t) =>
        t.role === 'المعلم' ||
        reservations.some((r) => r.teacherId === t.id),
    )
    .map((teacher) => {
      const teacherRes = reservations.filter((r) => r.teacherId === teacher.id);
      return {
        ...teacher,
        total: teacherRes.length,
        completed: teacherRes.filter((r) => r.status === 'تم التنفيذ').length,
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ar'));

  const cellBorder = {
    style: BorderStyle.SINGLE,
    size: 1,
    color: BORDER_COLOR,
  };
  const tableBorders = {
    top: cellBorder,
    bottom: cellBorder,
    left: cellBorder,
    right: cellBorder,
    insideHorizontal: cellBorder,
    insideVertical: cellBorder,
  };

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906, // A4 width
              height: 16838, // A4 height
            },
            margin: {
              top: 720,
              right: 800,
              bottom: 720,
              left: 800,
            },
          },
        },
        children: [
          // Header Table (Seal / Details / Code)
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.SINGLE, size: 12, color: PRIMARY_COLOR },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 30, type: WidthType.PERCENTAGE },
                    children: [
                      arPara(arText('المملكة العربية السعودية', { bold: true, size: 20 })),
                      arPara(arText('وزارة التعليم', { bold: true, size: 22, color: PRIMARY_COLOR })),
                      arPara(arText('الإدارة العامة للتعليم بمنطقة عسير', { size: 18 })),
                      arPara(arText(data.settings.school || 'مدرسة الإمام تركي بن عبدالله', { bold: true, size: 19 })),
                    ],
                  }),
                  new TableCell({
                    width: { size: 40, type: WidthType.PERCENTAGE },
                    children: [
                      arPara(arText('وزارة التعليم', { bold: true, size: 24, color: PRIMARY_COLOR }), {
                        alignment: AlignmentType.CENTER,
                      }),
                      arPara(arText('مركز مصادر التعلم', { bold: true, size: 26, color: TEXT_DARK }), {
                        alignment: AlignmentType.CENTER,
                      }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 30, type: WidthType.PERCENTAGE },
                    children: [
                      arPara(arText('تقرير إشغال وإحصاءات', { bold: true, size: 20, color: PRIMARY_COLOR }), {
                        alignment: AlignmentType.LEFT,
                      }),
                      arPara(
                        arText(
                          `تاريخ التصدير: ${formatSchoolDate(range.end, { day: 'numeric', month: 'short', year: 'numeric' })}`,
                          { size: 16, color: '657970' },
                        ),
                        { alignment: AlignmentType.LEFT },
                      ),
                    ],
                  }),
                ],
              }),
            ],
          }),

          // Title & Date Range
          arPara(
            arText('تقرير إشغال مركز مصادر التعلم', {
              bold: true,
              size: 28,
              color: PRIMARY_COLOR,
            }),
            { alignment: AlignmentType.CENTER, spaceBefore: 200, spaceAfter: 60 },
          ),
          arPara(
            arText(
              `الفترة من: ${formatSchoolDate(range.start, { day: 'numeric', month: 'long', year: 'numeric' })} إلى: ${formatSchoolDate(range.end, { day: 'numeric', month: 'long', year: 'numeric' })}`,
              { size: 20, color: '596C63' },
            ),
            { alignment: AlignmentType.CENTER, spaceAfter: 160 },
          ),

          // Summary Card
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: cellBorder,
              bottom: cellBorder,
              left: cellBorder,
              right: { style: BorderStyle.SINGLE, size: 18, color: PRIMARY_COLOR },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    shading: { fill: BG_SUMMARY },
                    children: [
                      arPara(arText('ملخص إشغال المركز خلال الفترة:', { bold: true, size: 20, color: PRIMARY_COLOR })),
                      arPara([
                        arText(`بلغ إجمالي الحجوزات `),
                        arText(`${totalBookings} حجزًا`, { bold: true }),
                        arText(`، نُفّذ منها `),
                        arText(`${completedCount} حصة`, { bold: true, color: PRIMARY_COLOR }),
                        arText(`، والحجوزات الملغاة `),
                        arText(`${cancelled.length}`, { bold: true }),
                        arText(`، والحصص غير المنفذة `),
                        arText(`${missed.length}`, { bold: true }),
                        arText(`.`),
                      ]),
                    ],
                  }),
                ],
              }),
            ],
          }),

          // Section 1: Teacher Activity Heading
          arPara(arText('أولاً: نشاط المعلمين في المركز', { bold: true, size: 22, color: PRIMARY_COLOR }), {
            spaceBefore: 240,
            spaceAfter: 100,
          }),

          // Teacher Activity Table
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: tableBorders,
            rows: [
              new TableRow({
                height: { value: 360, rule: HeightRule.ATLEAST },
                tableHeader: true,
                children: [
                  new TableCell({
                    shading: { fill: BG_HEADER },
                    children: [arPara(arText('المعلم', { bold: true, color: PRIMARY_COLOR }), { alignment: AlignmentType.RIGHT })],
                  }),
                  new TableCell({
                    shading: { fill: BG_HEADER },
                    children: [arPara(arText('حجوزات الفترة', { bold: true, color: PRIMARY_COLOR }), { alignment: AlignmentType.CENTER })],
                  }),
                  new TableCell({
                    shading: { fill: BG_HEADER },
                    children: [arPara(arText('الحصص المنفذة', { bold: true, color: PRIMARY_COLOR }), { alignment: AlignmentType.CENTER })],
                  }),
                  new TableCell({
                    shading: { fill: BG_HEADER },
                    children: [arPara(arText('حالة الحساب', { bold: true, color: PRIMARY_COLOR }), { alignment: AlignmentType.CENTER })],
                  }),
                ],
              }),
              ...teacherActivity.map((teacher, index) =>
                new TableRow({
                  children: [
                    new TableCell({
                      shading: index % 2 === 1 ? { fill: 'FAFCFB' } : undefined,
                      children: [arPara(arText(teacher.name, { bold: true }))],
                    }),
                    new TableCell({
                      shading: index % 2 === 1 ? { fill: 'FAFCFB' } : undefined,
                      children: [arPara(arText(String(teacher.total)), { alignment: AlignmentType.CENTER })],
                    }),
                    new TableCell({
                      shading: index % 2 === 1 ? { fill: 'FAFCFB' } : undefined,
                      children: [arPara(arText(String(teacher.completed)), { alignment: AlignmentType.CENTER })],
                    }),
                    new TableCell({
                      shading: index % 2 === 1 ? { fill: 'FAFCFB' } : undefined,
                      children: [arPara(arText(teacher.isActive ? 'نشط' : 'غير مفعّل'), { alignment: AlignmentType.CENTER })],
                    }),
                  ],
                }),
              ),
            ],
          }),

          // Section 2: Bookings Detail Heading
          arPara(arText('ثانياً: تفاصيل الحجوزات الموثقة', { bold: true, size: 22, color: PRIMARY_COLOR }), {
            spaceBefore: 240,
            spaceAfter: 100,
          }),

          // Booking Details Table
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: tableBorders,
            rows: [
              new TableRow({
                height: { value: 360, rule: HeightRule.ATLEAST },
                tableHeader: true,
                children: [
                  new TableCell({
                    shading: { fill: BG_HEADER },
                    children: [arPara(arText('التاريخ', { bold: true, color: PRIMARY_COLOR }), { alignment: AlignmentType.RIGHT })],
                  }),
                  new TableCell({
                    shading: { fill: BG_HEADER },
                    children: [arPara(arText('المعلم', { bold: true, color: PRIMARY_COLOR }), { alignment: AlignmentType.RIGHT })],
                  }),
                  new TableCell({
                    shading: { fill: BG_HEADER },
                    children: [arPara(arText('المادة والصف', { bold: true, color: PRIMARY_COLOR }), { alignment: AlignmentType.RIGHT })],
                  }),
                  new TableCell({
                    shading: { fill: BG_HEADER },
                    children: [arPara(arText('الفترة', { bold: true, color: PRIMARY_COLOR }), { alignment: AlignmentType.CENTER })],
                  }),
                  new TableCell({
                    shading: { fill: BG_HEADER },
                    children: [arPara(arText('الحالة', { bold: true, color: PRIMARY_COLOR }), { alignment: AlignmentType.CENTER })],
                  }),
                ],
              }),
              ...(reservations.length > 0
                ? reservations.map((r: Reservation, index) =>
                    new TableRow({
                      children: [
                        new TableCell({
                          shading: index % 2 === 1 ? { fill: 'FAFCFB' } : undefined,
                          children: [arPara(arText(formatSchoolDate(r.date, { day: 'numeric', month: 'short' })))],
                        }),
                        new TableCell({
                          shading: index % 2 === 1 ? { fill: 'FAFCFB' } : undefined,
                          children: [arPara(arText(r.teacherName, { bold: true }))],
                        }),
                        new TableCell({
                          shading: index % 2 === 1 ? { fill: 'FAFCFB' } : undefined,
                          children: [arPara(arText(`${r.subject} · ${r.grade}`))],
                        }),
                        new TableCell({
                          shading: index % 2 === 1 ? { fill: 'FAFCFB' } : undefined,
                          children: [arPara(arText(`الحصة ${r.period}`), { alignment: AlignmentType.CENTER })],
                        }),
                        new TableCell({
                          shading: index % 2 === 1 ? { fill: 'FAFCFB' } : undefined,
                          children: [arPara(arText(r.status, { bold: true }), { alignment: AlignmentType.CENTER })],
                        }),
                      ],
                    }),
                  )
                : [
                    new TableRow({
                      children: [
                        new TableCell({
                          columnSpan: 5,
                          children: [arPara(arText('لا توجد حجوزات مسجلة في هذه الفترة.'), { alignment: AlignmentType.CENTER })],
                        }),
                      ],
                    }),
                  ]),
            ],
          }),

          // Signatures Section
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.DASHED, size: 6, color: BORDER_COLOR },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    children: [
                      arPara(arText('أمين مركز مصادر التعلم', { bold: true, color: PRIMARY_COLOR }), { spaceBefore: 200 }),
                      arPara(arText(data.settings.centerAdmin || 'أمين المركز', { bold: true, size: 22 })),
                      arPara(arText('التوقيع: ____________________', { color: '71807B' }), { spaceBefore: 120 }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    children: [
                      arPara(arText('اعتماد قائد المدرسة', { bold: true, color: PRIMARY_COLOR }), {
                        alignment: AlignmentType.LEFT,
                        spaceBefore: 200,
                      }),
                      arPara(arText(data.settings.principal || 'قائد المدرسة', { bold: true, size: 22 }), {
                        alignment: AlignmentType.LEFT,
                      }),
                      arPara(arText('التوقيع: ____________________', { color: '71807B' }), {
                        alignment: AlignmentType.LEFT,
                        spaceBefore: 120,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });

  return await Packer.toBlob(doc);
}
