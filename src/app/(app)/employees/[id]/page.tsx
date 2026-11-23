import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { DIRECTORY_GROUPS, getEmployeeRecord, groupOfCategory } from "@/server/services/employees";
import { ForbiddenError } from "@/auth/rbac";
import { CATEGORY_AR, EMPLOYMENT_STATUS_AR, POSITION_AR } from "@/domain/labels";
import { DAY_NAMES_AR } from "@/domain/time";
import { BackLink, btnSecondary, Card, DataBadge, Denied, SavedNotice, Table } from "@/components/ui";
import { ServiceDateView } from "@/components/service-date";

const KIND_AR: Record<string, string> = { LESSON: "حصة", STANDBY: "انتظار", ACTIVITY: "نشاط" };

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const ctx = await requireUser();
  const { id } = await params;
  const { saved } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  let rec;
  try {
    rec = await getEmployeeRecord(getDb(), ctx, id);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  if (!rec) notFound();
  const e = rec.employee;
  const g = groupOfCategory(e.category);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <BackLink href={`/staff/${g}`} label={DIRECTORY_GROUPS[g].title} />
      <SavedNotice show={saved === "1"} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-brand-900">{e.fullName}</h1>
        {rec.canWrite && <Link href={`/employees/${id}/edit`} className={`${btnSecondary} no-print`}>تعديل</Link>}
      </div>
      <Card>
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div><dt className="text-gray-600">المعرّف الداخلي</dt><dd dir="ltr" className="text-right font-mono text-xs">{e.id.slice(0, 8)}</dd></div>
          <div><dt className="text-gray-600">الفئة</dt><dd>{CATEGORY_AR[e.category]}</dd></div>
          <div><dt className="text-gray-600">المسمى الوظيفي</dt><dd>{e.jobTitle}</dd></div>
          <div><dt className="text-gray-600">التخصص</dt><dd>{e.specialization ?? "—"}</dd></div>
          <div><dt className="text-gray-600">الحالة الوظيفية</dt><dd>{EMPLOYMENT_STATUS_AR[e.status]}</dd></div>
          <div><dt className="text-gray-600">حالة البيانات</dt><dd><DataBadge status={e.dataStatus} /></dd></div>
          <div><dt className="text-gray-600">الموقع المرتبط بالعمل</dt><dd>{e.workLocation ?? "—"}</dd></div>
          <div><dt className="text-gray-600">المراحل</dt><dd>{[...new Set(rec.assignments.filter((a) => a.isActive && a.stageName).map((a) => a.stageName))].join("، ") || "—"}</dd></div>
          <div className="col-span-2 md:col-span-4"><dt className="text-gray-600">المهام والمسؤوليات</dt><dd className="whitespace-pre-line">{e.duties ?? "—"}</dd></div>
        </dl>
      </Card>
      {rec.sensitive && (
        <Card title="تواريخ المباشرة">
          <dl className="grid gap-4 text-sm md:grid-cols-2">
            <div><dt className="mb-1 text-gray-600">تاريخ المباشرة بوزارة التعليم</dt><dd><ServiceDateView v={rec.ministry} />{rec.ministry?.originalText && <span className="text-xs text-gray-600">النص الأصلي: <span dir="ltr">{rec.ministry.originalText}</span></span>}</dd></div>
            <div><dt className="mb-1 text-gray-600">تاريخ المباشرة بالمدرسة</dt><dd><ServiceDateView v={rec.school} />{rec.school?.originalText && <span className="text-xs text-gray-600">النص الأصلي: <span dir="ltr">{rec.school.originalText}</span></span>}</dd></div>
          </dl>
          {e.notes && <p className="mt-3 border-t border-gray-100 pt-3 text-sm"><span className="text-gray-600">ملاحظات إدارية: </span>{e.notes}</p>}
        </Card>
      )}
      <Card title="المهام والتكليفات">
        {rec.assignments.length === 0 ? <p className="text-sm text-gray-600">لا توجد تكليفات مسجلة.</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {rec.assignments.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{a.position === "OTHER" ? a.titleAr : POSITION_AR[a.position]}{a.stageName && ` — ${a.stageName}`}{a.duties && ` · ${a.duties}`}</span>
                <span className={a.isActive ? "text-green-800" : "text-gray-500"}>{a.isActive ? "سارٍ" : `منتهٍ ${a.endDate ?? ""}`}</span>
              </li>
            ))}
          </ul>
        )}
        {rec.homerooms.length > 0 && <p className="mt-2 text-sm">رائدة فصل: {rec.homerooms.map((h) => `${h.gradeName} / ${h.sectionName}`).join("، ")}</p>}
        {rec.subjects.length > 0 && <p className="mt-2 text-sm">المواد: {rec.subjects.map((x) => `${x.subject} (${x.stageName})`).join("، ")}</p>}
      </Card>
      {rec.timetable && (
        <section aria-labelledby="tt">
          <h2 id="tt" className="mb-2 font-semibold">الجدول الأسبوعي المعتمد (للعرض)</h2>
          {rec.timetable.length === 0 ? <p className="text-sm text-gray-600">لا توجد حصص في الجداول المعتمدة.</p> : (
            <Table head={["اليوم", "الحصة", "النوع", "الصف / الشعبة", "المادة", "القاعة"]}>
              {rec.timetable.map((t, i) => (
                <tr key={i}>
                  <td className="p-3">{DAY_NAMES_AR[t.dayOfWeek]}</td>
                  <td className="p-3">{t.periodNumber}</td>
                  <td className="p-3">{KIND_AR[t.kind]}</td>
                  <td className="p-3">{t.gradeName ? `${t.gradeName} / ${t.sectionName}` : "—"}</td>
                  <td className="p-3">{t.subject ?? "—"}</td>
                  <td className="p-3">{t.room ?? "—"}</td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      )}
      {rec.account !== null && (
        <Card title="حساب الدخول">
          <p className="text-sm">
            اسم المستخدم: <span dir="ltr">{rec.account.username}</span> · {rec.account.isActive ? "مفعّل" : "معطّل"} · الأدوار: {rec.account.roles.join("، ") || "—"}
          </p>
        </Card>
      )}
    </div>
  );
}
