import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { getSchool } from "@/server/school";

export default async function AboutPage() {
  await requireUser();
  const school = await getSchool(getDb());
  return (
    <article className="mx-auto max-w-3xl space-y-4 rounded-xl border border-gray-200 bg-white p-6">
      <h1 className="text-2xl font-bold text-brand-900">عن النظام</h1>
      <p><strong>{school?.systemName}</strong> — {school?.tagline}</p>
      <p>{school?.nameAr}، {school?.educationOffice}.</p>
      <p>دليل مدرسي رقمي مشترك للإدارة يجمع بيانات الطالبات والموظفات والفصول والجداول وشؤون الطالبات.</p>
      <ul className="list-inside list-disc space-y-1 text-sm text-gray-800">
        <li>نظام داخلي مستقل، لا يرتبط بنظام نور أو منصة مدرستي، وسجلاته ليست تسجيلًا رسميًا فيهما.</li>
        {!school?.officialApproved && <li>النظام غير معتمد رسميًا حتى الآن.</li>}
        <li>«الموقع المتوقع» للطالبة مبني على الجدول وليس تتبعًا فعليًا.</li>
      </ul>
      <p className="border-t border-gray-100 pt-4 font-medium text-brand-800">{school?.creditLine}</p>
    </article>
  );
}
