# الدليل الرقمي المدرسي المتكامل

نظام إداري داخلي للروضة الثانية والابتدائية الرابعة والمتوسطة الثانية بالمهد.
إنشاء وتطوير الأستاذة وضحى زايد المطيري.

> نظام داخلي غير معتمد رسميًا، ولا يرتبط بنظام نور أو منصة مدرستي. بيانات التطوير وهمية.

## التشغيل المحلي
المتطلبات: Node 20+ وPostgreSQL 14+.
```bash
npm install
cp .env.example .env            # ضعي رابط قاعدة البيانات
# أنشئي قاعدة اختبار منفصلة واضبطي .env.test بنفس الصيغة (قاعدة اسمها school_test)
npm run db:migrate
npm run db:seed                 # بيانات وهمية + حسابات تطوير
npm run dev                     # http://localhost:3000
```
حسابات التطوير (وهمية): `principal`, `vp.academic`, `vp.students`, `directory`, `test.primary` — كلمة المرور `Dev-Only-2026` (للتطوير المحلي فقط).

## الاختبارات
`npm test` · `npm run test:persistence` · `npm run build && npx playwright test`

## التوثيق
`CLAUDE.md` (للجلسات القادمة) · `docs/PROGRESS.md` · `docs/OPEN_ISSUES.md` · `docs/TEST_RESULTS.md` · `docs/DATA_PROTECTION.md` · `docs/ERD.md`
