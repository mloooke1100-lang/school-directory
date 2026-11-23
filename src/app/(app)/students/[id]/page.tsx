import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { getStudentNow } from "@/server/student-location";
import { ForbiddenError } from "@/auth/rbac";
import { minutesToHHMM } from "@/domain/time";

const REASON: Record<string, string> = { WEEKEND: "عطلة نهاية الأسبوع", HOLIDAY: "إجازة رسمية", OUTSIDE_TERM: "خارج الفصل الدراسي" };

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  let r;
  try {
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
      <h1 className="text-2xl font-bold text-brand-900">{r.student.fullName}</h1>
      <dl className="grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm md:grid-cols-4">
        <div><dt className="text-gray-600">الرقم المدرسي</dt><dd dir="ltr" className="text-right">{r.student.schoolNumber ?? "—"}</dd></div>
        <div><dt className="text-gray-600">المرحلة</dt><dd>{r.enrollment?.stageName ?? "—"}</dd></div>
        <div><dt className="text-gray-600">الصف</dt><dd>{r.enrollment?.gradeName ?? "—"}</dd></div>
        <div><dt className="text-gray-600">الشعبة</dt><dd>{r.enrollment?.sectionName ?? "—"}</dd></div>
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
    </div>
  );
}
