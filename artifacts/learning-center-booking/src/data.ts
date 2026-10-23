export type Role = 'المعلم' | 'أمين مركز مصادر التعلم' | 'قائد المدرسة';
export type Status = 'مؤكد' | 'تم التنفيذ' | 'ملغي' | 'لم يتم التنفيذ';
export type Teacher = { id: string; name: string; subject: string; stage: 'متوسط' | 'ثانوي' };
export type Reservation = {
  id: string; teacherId: string; teacherName: string; subject: string; stage: 'متوسط' | 'ثانوي';
  grade: string; section: string; date: string; period: number; lessonTopic: string;
  resources: string[]; studentCount?: number; notes?: string; status: Status;
};
export type BlockedSlot = { date: string; period: number; reason: string };
export type SchoolSettings = {
  school: string; administration: string; centerAdmin: string; principal: string;
  days: string[]; periods: number; grades: { متوسط: string[]; ثانوي: string[] };
};
export type DemoData = { teachers: Teacher[]; reservations: Reservation[]; blocked: BlockedSlot[]; settings: SchoolSettings };

const iso = (offset: number) => {
  const d = new Date();
  const direction = Math.sign(offset);
  let remaining = Math.abs(offset);
  while (remaining > 0) {
    d.setDate(d.getDate() + direction);
    if (d.getDay() <= 4) remaining -= 1;
  }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
export const initialData: DemoData = {
  teachers: [
    {id:'t1',name:'أحمد القحطاني',subject:'الرياضيات',stage:'متوسط'},
    {id:'t2',name:'سارة الشهري',subject:'العلوم',stage:'متوسط'},
    {id:'t3',name:'خالد عسيري',subject:'اللغة العربية',stage:'ثانوي'},
    {id:'t4',name:'نورة الغامدي',subject:'اللغة الإنجليزية',stage:'ثانوي'},
    {id:'t5',name:'محمد الحربي',subject:'الدراسات الاجتماعية',stage:'متوسط'},
    {id:'t6',name:'ريم العمري',subject:'الأحياء',stage:'ثانوي'},
    {id:'t7',name:'عبدالله الشهري',subject:'الحاسب الآلي',stage:'متوسط'},
    {id:'t8',name:'هند القرني',subject:'الفيزياء',stage:'ثانوي'},
    {id:'t9',name:'فيصل الأسمري',subject:'الكيمياء',stage:'ثانوي'},
  ],
  reservations: [
    {id:'r1',teacherId:'t1',teacherName:'أحمد القحطاني',subject:'الرياضيات',stage:'متوسط',grade:'الأول المتوسط',section:'أ',date:iso(1),period:2,lessonTopic:'التمثيل البياني للدوال',resources:['أجهزة الحاسب الآلي','السبورة الذكية'],studentCount:28,status:'مؤكد'},
    {id:'r2',teacherId:'t2',teacherName:'سارة الشهري',subject:'العلوم',stage:'متوسط',grade:'الثاني المتوسط',section:'ب',date:iso(1),period:4,lessonTopic:'أجهزة جسم الإنسان',resources:['جهاز العرض','مصادر التعلم الرقمية'],studentCount:25,status:'مؤكد'},
    {id:'r3',teacherId:'t3',teacherName:'خالد عسيري',subject:'اللغة العربية',stage:'ثانوي',grade:'الأول الثانوي',section:'أ',date:iso(-3),period:1,lessonTopic:'القراءة النقدية',resources:['المنصات التعليمية'],status:'تم التنفيذ'},
    {id:'r4',teacherId:'t4',teacherName:'نورة الغامدي',subject:'اللغة الإنجليزية',stage:'ثانوي',grade:'الثاني الثانوي',section:'ج',date:iso(-2),period:3,lessonTopic:'Writing an opinion paragraph',resources:['الاتصال بالإنترنت','أجهزة الحاسب الآلي'],studentCount:22,status:'تم التنفيذ'},
    {id:'r5',teacherId:'t5',teacherName:'محمد الحربي',subject:'الدراسات الاجتماعية',stage:'متوسط',grade:'الثالث المتوسط',section:'أ',date:iso(2),period:5,lessonTopic:'الموارد الطبيعية في المملكة',resources:['جهاز العرض'],status:'مؤكد'},
    {id:'r6',teacherId:'t6',teacherName:'ريم العمري',subject:'الأحياء',stage:'ثانوي',grade:'الثالث الثانوي',section:'ب',date:iso(-1),period:2,lessonTopic:'الوراثة والصفات',resources:['برامج المحاكاة'],status:'لم يتم التنفيذ'},
    {id:'r7',teacherId:'t7',teacherName:'عبدالله الشهري',subject:'الحاسب الآلي',stage:'متوسط',grade:'الأول المتوسط',section:'ج',date:iso(-4),period:6,lessonTopic:'مقدمة في الأمن الرقمي',resources:['أجهزة الحاسب الآلي'],status:'تم التنفيذ'},
    {id:'r8',teacherId:'t8',teacherName:'هند القرني',subject:'الفيزياء',stage:'ثانوي',grade:'الثاني الثانوي',section:'أ',date:iso(4),period:3,lessonTopic:'قوانين الحركة',resources:['برامج المحاكاة','جهاز العرض'],status:'مؤكد'},
    {id:'r9',teacherId:'t9',teacherName:'فيصل الأسمري',subject:'الكيمياء',stage:'ثانوي',grade:'الأول الثانوي',section:'ب',date:iso(-7),period:4,lessonTopic:'الروابط الكيميائية',resources:['السبورة الذكية'],status:'ملغي'},
    {id:'r10',teacherId:'t1',teacherName:'أحمد القحطاني',subject:'الرياضيات',stage:'متوسط',grade:'الثاني المتوسط',section:'أ',date:iso(5),period:1,lessonTopic:'المعادلات الخطية',resources:['مصادر التعلم الرقمية'],status:'مؤكد'},
    {id:'r11',teacherId:'t2',teacherName:'سارة الشهري',subject:'العلوم',stage:'متوسط',grade:'الثالث المتوسط',section:'ج',date:iso(-8),period:5,lessonTopic:'التفاعلات الكيميائية',resources:['جهاز العرض'],status:'تم التنفيذ'},
  ],
  blocked: [{date:iso(3),period:7,reason:'صيانة أجهزة المركز'}],
  settings: {
    school:'مدرسة الإمام تركي بن عبدالله بالربوعة',
    administration:'الإدارة العامة للتعليم بمنطقة عسير',
    centerAdmin:'أمين مركز مصادر التعلم',principal:'قائد المدرسة',
    days:['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس'],periods:7,
    grades:{متوسط:['الأول المتوسط','الثاني المتوسط','الثالث المتوسط'],ثانوي:['الأول الثانوي','الثاني الثانوي','الثالث الثانوي']}
  }
};

const STORAGE_KEY = 'learning-center-demo-v1';
export const repository = {
  load(): DemoData {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as DemoData;
        if (Array.isArray(parsed.reservations) && Array.isArray(parsed.teachers) && parsed.settings) return parsed;
      }
    } catch { /* Use a clean local demo if storage is unavailable or malformed. */ }
    return structuredClone(initialData);
  },
  save(data: DemoData) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* Session remains usable if storage is blocked. */ }
  }
};

export const subjects = ['الرياضيات','العلوم','اللغة العربية','اللغة الإنجليزية','الدراسات الاجتماعية','الحاسب الآلي','الأحياء','الفيزياء','الكيمياء'];
export const resources = ['أجهزة الحاسب الآلي','جهاز العرض','السبورة الذكية','الاتصال بالإنترنت','المنصات التعليمية','مصادر التعلم الرقمية','برامج المحاكاة','أخرى'];
