import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { getStudentNow } from "@/server/student-location";
import { ForbiddenError } from "@/auth/rbac";
import { minutesToHHMM } from "@/domain/time";
import Link from "next/link";
import { getStudentRecord } from "@/server/services/students";
import { DATA_STATUS_AR, ENROLLMENT_STATUS_AR, YEAR_STATUS_AR } from "@/domain/labels";
import { btnSecondary, SavedNotice, Table } from "@/components/ui";
import { SectionSchedule } from "@/components/section-schedule";
import { StudentAffairs } from "@/components/student-affairs";

const REASON: Record<string, string> = { WEEKEND: "عطلة نهاية الأسبوع", HOLIDAY: "إجازة رسمية", OUTSIDE_TERM: "خارج الفصل الدراسي" };

export default async function StudentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const ctx = await requireUser();
  const { id } = await params;
  const { saved } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  let r, rec;
  try {
    rec = await getStudentRecord(getDb(), ctx, id);
    if (!rec) notFound();
    r = await getStudentNow(getDb(), ctx, id);
  } catch (e) {
    if (e instanceof ForbiddenError) return <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{e.message}</p>;
    notFound();
  }
  const p = r.period;
  let periodText = "";
  switch (p.status) {
    case "NOT_CONFIGURED": periodText = "أوقات الحصص غير مكتملة لهذه المرحلة"; break;
    case "NO_ENROLLMENT": periodText = "لا يوجد قيد نشط في السنة الحالية"; break;
    case "NON_SCHOOL_DAY": periodText = REASON[p.reason]; break;
    case "BEFORE_SCHOOL": periodText = `قبل بداية الدوام (يبدأ ${minutesToHHMM(p.next.startMinute)})`; break;
    case "BETWEEN": periodText = `بين الحصص — التالية ${p.next.label ?? p.next.number} الساعة ${minutesToHHMM(p.next.startMinute)}`; break;
    case "AFTER_SCHOOL": periodText = "انتهى الدوام"; break;
    case "IN_PERIOD": periodText = `${p.period.label ?? `الحصة ${p.period.number}`} (${minutesToHHMM(p.period.startMinute)}–${minutesToHHMM(p.period.endMinute)})`; break;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <SavedNotice show={saved === "1"} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-brand-900">{r.student.fullName}</h1>
        {rec.canWrite && <Link href={`/students/${id}/edit`} className={`${btnSecondary} no-print`}>تعديل البيانات والقيد</Link>}
      </div>
      <dl className="grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm md:grid-cols-4">
        <div><dt className="text-gray-600">الرقم المدرسي</dt><dd dir="ltr" className="text-right">{r.student.schoolNumber ?? "—"}</dd></div>
        <div><dt className="text-gray-600">المرحلة</dt><dd>{r.enrollment?.stageName ?? "—"}</dd></div>
        <div><dt className="text-gray-600">الصف</dt><dd>{r.enrollment?.gradeName ?? "—"}</dd></div>
        <div><dt className="text-gray-600">الشعبة</dt><dd>{r.enrollment ? <Link className="text-brand-700 hover:underline" href={`/sections/${r.enrollment.sectionId}`}>{r.enrollment.sectionName}</Link> : "—"}</dd></div>
        <div><dt className="text-gray-600">المعرّف الداخلي</dt><dd dir="ltr" className="text-right font-mono text-xs">{rec.student.id.slice(0, 8)}</dd></div>
        <div><dt className="text-gray-600">حالة البيانات</dt><dd>{DATA_STATUS_AR[rec.student.dataStatus]}</dd></div>
        <div className="col-span-2"><dt className="text-gray-600">آخر تحديث</dt><dd>{rec.student.updatedAt.toLocaleString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh" })}</dd></div>
        {rec.student.notes && <div className="col-span-2 md:col-span-4"><dt className="text-gray-600">ملاحظات إدارية</dt><dd className="whitespace-pre-line">{rec.student.notes}</dd></div>}
      </dl>
      <section className="rounded-xl border border-brand-200 bg-brand-50 p-4" aria-labelledby="now">
        <h2 id="now" className="font-semibold text-brand-900">الموقع المتوقع الآن حسب الجدول</h2>
        <p className="mt-1 text-sm">{periodText}</p>
        {r.lesson && (
          <div className="mt-3 text-sm">
            {r.lesson.cancelled ? <p className="font-medium text-red-800">الحصة ملغاة اليوم</p> : (
              <>
                <p>المادة: <strong>{r.lesson.subject ?? "—"}</strong></p>
                <p>المعلمة: <strong>{r.lesson.teacherName}</strong>{r.lesson.isSubstitute && <span className="mr-2 rounded bg-white px-2 py-0.5 text-xs">حصة انتظار — بدلًا من {r.lesson.originalTeacherName ?? "—"}</span>}</p>
                <p>القاعة: {r.lesson.room ?? "—"}</p>
              </>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-gray-700">هذا تحديد للموقع المتوقع بناءً على الجدول المعتمد، وليس تتبعًا فعليًا لموقع الطالبة.</p>
      </section>
      {r.enrollment && <SectionSchedule ctx={ctx} sectionId={r.enrollment.sectionId} stageId={r.enrollment.stageId} />}
      <StudentAffairs ctx={ctx} studentId={id} stageId={rec.enrollments.find((e) => e.yearStatus === "ACTIVE")?.stageId ?? null} />
      <section aria-labelledby="hist">
        <h2 id="hist" className="mb-2 font-semibold">سجل القيود عبر السنوات</h2>
        <Table head={["السنة", "المرحلة", "الصف / الشعبة", "تاريخ القيد", "حالة القيد"]}>
          {rec.enrollments.map((e) => (
            <tr key={e.id}>
              <td className="p-3">{e.yearName} <span className="text-xs text-gray-600">({YEAR_STATUS_AR[e.yearStatus]})</span></td>
              <td className="p-3">{e.stageName}</td>
              <td className="p-3">{e.gradeName} / {e.sectionName}</td>
              <td className="p-3" dir="ltr">{e.enrolledAt}</td>
              <td className="p-3">{ENROLLMENT_STATUS_AR[e.status]}</td>
            </tr>
          ))}
        </Table>
      </section>
    </div>
  );
}
