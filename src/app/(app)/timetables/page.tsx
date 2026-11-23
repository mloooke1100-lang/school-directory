import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/server/current-user";
import { listTimetables } from "@/server/services/timetables";
import { getActiveYear, getTermForDate } from "@/server/school";
import { can, stageScope } from "@/auth/rbac";
import { TIMETABLE_STATUS_AR } from "@/domain/labels";
import { riyadhNow } from "@/domain/time";
import { ActionForm } from "@/components/form";
import { btnSecondary, Card, Denied, inputCls, PageHeader, Table } from "@/components/ui";
import { createTimetableAction } from "./actions";

export default async function TimetablesPage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const ctx = await requireUser();
  if (stageScope(ctx, "timetable.read").kind === "none") return <Denied />;
  const db = getDb();
  const sp = await searchParams;
  const year = await getActiveYear(db);
  const terms = year ? await db.select().from(s.academicTerms).where(eq(s.academicTerms.yearId, year.id)).orderBy(asc(s.academicTerms.number)) : [];
  const current = await getTermForDate(db, riyadhNow().date);
  const term = terms.find((t) => t.id === sp.term) ?? current ?? terms[0];
  if (!term) return <p>لا يوجد فصل دراسي في السنة النشطة.</p>;
  const [list, stages] = await Promise.all([listTimetables(db, ctx, term.id), db.select().from(s.stages).orderBy(asc(s.stages.order))]);
  const draftable = stages.filter((st) => can(ctx, "timetable.write", st.id) && !list.some((t) => t.stageId === st.id && t.status === "DRAFT"));
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="الجداول الدراسية" subtitle="الجدول الأسبوعي المعتمد لكل مرحلة. حصص الانتظار والأنشطة سجلات منفصلة لا تعدّله." actions={<><Link href="/timetables/periods" className={btnSecondary}>أوقات الحصص</Link><Link href="/timetables/catalog" className={btnSecondary}>المواد والقاعات</Link></>} />
      <form className="no-print flex flex-wrap gap-2" aria-label="اختيار الفصل الدراسي">
        <select name="term" defaultValue={term.id} aria-label="الفصل الدراسي" className={`${inputCls} md:w-64`}>
          {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="rounded-lg bg-brand-700 px-5 py-2 font-semibold text-white">عرض</button>
      </form>
      {list.length === 0 ? <p className="text-gray-700">لا توجد جداول لهذا الفصل الدراسي.</p> : (
        <Table head={["المرحلة", "الجدول", "الحالة", "عدد الخانات", "ساري من"]}>
          {list.map((t) => (
            <tr key={t.id}>
              <td className="p-3">{t.stageName}</td>
              <td className="p-3"><Link href={`/timetables/${t.id}`} className="font-medium text-brand-700 hover:underline">{t.name}</Link></td>
              <td className="p-3">{TIMETABLE_STATUS_AR[t.status]}</td>
              <td className="p-3">{t.entries}</td>
              <td className="p-3" dir="ltr">{t.effectiveFrom ?? "—"}</td>
            </tr>
          ))}
        </Table>
      )}
      {draftable.length > 0 && (
        <Card title="إنشاء مسودة جدول جديدة">
          <p className="mb-3 text-sm text-gray-700">لتعديل جدول معتمد افتحيه واختاري «نسخ إلى مسودة» بدل البدء من الصفر.</p>
          <ActionForm action={createTimetableAction} submitLabel="إنشاء المسودة" ariaLabel="إنشاء مسودة جدول">
            <input type="hidden" name="termId" value={term.id} />
            <div className="grid gap-3 md:grid-cols-2">
              <select name="stageId" aria-label="المرحلة" className={inputCls}>
                {draftable.map((st) => <option key={st.id} value={st.id}>{st.nameAr}</option>)}
              </select>
              <input name="name" aria-label="اسم الجدول" placeholder="اسم الجدول" defaultValue={`الجدول الأسبوعي — ${term.name}`} className={inputCls} />
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
