# منصة حجز مركز مصادر التعلم

تطبيق عربي باتجاه RTL لإدارة حجوزات مركز مصادر التعلم في مدرسة الإمام تركي بن عبدالله بالربوعة. يستخدم React وVite وSupabase Authentication وPostgres، مع أدوار للمعلم وأمين المركز وقائد المدرسة. التوقيت المعتمد لقواعد المواعيد والتقارير هو `Asia/Riyadh`، وأيام العمل من الأحد إلى الخميس بواقع سبع حصص يوميًا.

## المتطلبات

- Node.js 22 أو أحدث.
- pnpm 10.
- مشروع Supabase لتسجيل الدخول والبيانات. لا يحتاج تثبيت الواجهة إلى اتصال فعّال بـ Supabase، لكن ميزات الدخول والبيانات تتطلب إعداد المشروع.

## التشغيل على Windows

من جذر المستودع في PowerShell:

```powershell
pnpm install
Copy-Item .env.example .env.local
```

عدّل `.env.local` وأدخل رابط مشروع Supabase ومفتاحه العام (publishable/anon فقط):

```dotenv
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

ثم شغّل التطبيق:

```powershell
pnpm --filter @workspace/learning-center-booking dev
```

افتح `http://localhost:5173`. المنفذ الافتراضي 5173؛ ويمكن تمرير `PORT` اختياريًا. لا يحتاج أمر build إلى `PORT`.

## التحقق والبناء

```powershell
pnpm --filter @workspace/learning-center-booking run typecheck
pnpm --filter @workspace/learning-center-booking test
pnpm --filter @workspace/learning-center-booking run build
```

يُنتج البناء الملفات في `artifacts/learning-center-booking/dist/public`. اختبارات التقويم تستخدم Node.js 22.12 مع خيار type stripping التجريبي.

## إعداد Supabase

1. أنشئ مشروع Supabase جديدًا، وأضف نطاقات التطوير والإنتاج إلى إعدادات Auth > URL Configuration. أضف `http://localhost:5173/reset-password` ورابط إعادة التعيين على نطاق Vercel إلى Redirect URLs.
2. من SQL Editor في مشروع جديد، راجع ثم شغّل يدويًا `supabase/migrations/001_initial_schema.sql`. ينشئ الترحيل الجداول والسياسات والمشغلات ومعلومات المدرسة الابتدائية. لا يشغّل التطبيق SQL تلقائيًا.
3. عطّل التسجيل العام في إعدادات Auth. يُنشئ مسؤول المركز حسابات المعلمين وقائد المدرسة من صفحة الإعدادات بعد نشر Edge Function أدناه.
4. أعد إعداد مزود البريد الإلكتروني/SMTP في Supabase لإرسال دعوات المستخدمين وروابط إعادة تعيين كلمات المرور إلى عناوينهم.

### إنشاء أول حساب مسؤول للمركز

أنشئ المستخدم الأول من Supabase Dashboard > Authentication، مع `full_name` ضمن بيانات المستخدم الوصفية عند توفر هذا الحقل. ينشئ المشغل ملفًا غير مفعّل بدور معلم مبدئيًا. بعد ذلك نفّذ هذا التحديث لمرة واحدة في SQL Editor مع استبدال البريد بعنوان حساب المسؤول الذي أنشأته:

```sql
update public.profiles as p
set role = 'admin', is_active = true
from auth.users as u
where p.id = u.id
  and lower(u.email) = lower('admin@example.edu');
```

تحقق من أن التحديث أصاب صفًا واحدًا، ثم سجّل الدخول بالحساب. لا تضع كلمة المرور أو مفتاح `service_role` في المستودع أو في متغيرات `VITE_*`.

### دعوة المعلمين وقائد المدرسة

من جذر المستودع، بعد تثبيت Supabase CLI وتسجيل الدخول وربط المشروع:

```powershell
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy admin-invite-user
supabase secrets set APP_URL=https://YOUR-VERCEL-DOMAIN
```

تستخدم الوظيفة متغيرات Supabase المحقونة `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` داخل بيئة Edge Function فقط. تتحقق من جلسة المستدعي ودوره النشط قبل إرسال دعوة للمعلم أو قائد المدرسة. الحساب المدعو غير مفعّل حتى يفعّله المسؤول من صفحة الإعدادات. لا تُنشئ الواجهة تسجيلًا عامًا ولا تسمح بدعوة مسؤول آخر من هذا المسار.

## النشر على Vercel

ملف `vercel.json` يضبط التثبيت والبناء ومجلد الإخراج وإعادة توجيه مسارات SPA. أنشئ مشروع Vercel من المستودع مع **Root Directory** على الجذر، وأضف متغيري البيئة التاليين لبيئات Preview/Production:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

اترك إعدادات build/install/output الافتراضية للملف `vercel.json`، وأضف رابط النطاق المنشور إلى Supabase Auth URL Configuration وإلى إعداد `APP_URL` في Edge Function. لا يتم النشر من هذا المستودع تلقائيًا.

## الأدوار والبيانات

- المعلم يرى حجوزاته وتوافر الفترات فقط، ويستطيع إنشاء الحجز وإلغاء الحجز المؤكد المستقبلي الخاص به.
- أمين المركز يدير الإعدادات والحسابات والإغلاقات والحجوزات.
- قائد المدرسة يقرأ لوحة المتابعة والتقارير دون إدارة البيانات.
- يمنع الترحيل الحجز المكرر وإغلاق فترة مستخدمة، ويطبق صلاحيات RLS والتحقق الزمني بتوقيت الرياض.
- احتساب الإشغال هو عدد الحصص المنفذة مقسومًا على الفترات المدرسية بعد خصم الإغلاقات، بما فيها إغلاق اليوم الكامل.
- PDF يُفتح من خلال نافذة الطباعة في المتصفح (اختر “Save as PDF”). تنزيل Word ينتج ملف `.doc` بصيغة HTML متوافقة مع Word؛ ليس ملف DOCX أصليًا.

## ملاحظات التسليم

إعداد Supabase وتشغيل الترحيل ونشر Edge Function وإنشاء المسؤول الأول خطوات يدوية تتطلب وصول مالك المشروع. لم تُنفذ على مشروع Supabase أو Vercel أثناء إعداد هذا المستودع. اطّلع على قسم التحقق في تقرير الإكمال لمعرفة ما جرى اختباره محليًا وما يتطلب بيانات دخول فعلية.
# learning-center-hub
