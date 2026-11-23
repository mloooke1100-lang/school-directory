import Link from "next/link";
import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/server/current-user";
import { listStudents } from "@/server/services/students";
import { can, ForbiddenError } from "@/auth/rbac";
import { ENROLLMENT_STATUS_AR } from "@/domain/labels";
import { btnPrimary, DataBadge, Denied, inputCls, PageHeader, Table } from "@/components/ui";

type SP = { q?: string; year?: string; stage?: string; status?: string; page?: string };
const PAGE = 50;

export default async function StudentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const [years, stages] = await Promise.all([db.select().from(s.academicYears).orderBy(asc(s.academicYears.startDate)), db.select().from(s.stages).orderBy(asc(s.stages.order))]);
  const yearId = years.some((y) => y.id === sp.year) ? sp.year : undefined;
  const stageId = stages.some((x) => x.id === sp.stage) ? sp.stage : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  let data;
  try {
    data = await listStudents(db, ctx, { q: sp.q?.slice(0, 100), yearId, stageId, status: sp.status, limit: PAGE, offset: (page - 1) * PAGE });
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  const qs = (p: number) => `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(yearId ? { year: yearId } : {}), ...(stageId ? { stage: stageId } : {}), ...(sp.status ? { status: sp.status } : {}), page: String(p) })}`;
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="دليل الطالبات" subtitle={`${data.total.toLocaleString("en-US")} طالبة في النتائج`} actions={can(ctx, "students.write") && <Link href="/students/new" className={btnPrimary}>إضافة طالبة</Link>} />
      <form className="no-print grid gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]" role="search" aria-label="تصفية الطالبات">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="الاسم أو جزء منه أو الرقم المدرسي" aria-label="بحث" className={inputCls} />
        <select name="year" defaultValue={yearId ?? ""} aria-label="السنة الدراسية" className={inputCls}>
          <option value="">السنة النشطة</option>
          {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
        <select name="stage" defaultValue={stageId ?? ""} aria-label="المرحلة" className={inputCls}>
          <option value="">كل المراحل</option>
          {stages.map((x) => <option key={x.id} value={x.id}>{x.nameAr}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} aria-label="حالة القيد" className={inputCls}>
          <option value="">كل الحالات</option>
          {Object.entries(ENROLLMENT_STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="rounded-lg bg-brand-700 px-5 py-2 font-semibold text-white">تصفية</button>
      </form>
      {data.rows.length === 0 ? <p className="text-gray-700">لا توجد نتائج.</p> : (
        <Table head={["الاسم", "الرقم المدرسي", "المرحلة", "الصف / الشعبة", "حالة القيد", "البيانات", "آخر تحديث"]}>
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td className="p-3"><Link href={`/students/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.fullName}</Link></td>
              <td className="p-3" dir="ltr">{r.schoolNumber ?? "—"}</td>
              <td className="p-3">{r.stageName}</td>
              <td className="p-3"><Link href={`/sections/${r.sectionId}`} className="hover:underline">{r.gradeName} / {r.sectionName}</Link></td>
              <td className="p-3">{ENROLLMENT_STATUS_AR[r.enrollmentStatus]}</td>
              <td className="p-3"><DataBadge status={r.dataStatus} /></td>
              <td className="p-3 text-gray-600">{r.updatedAt.toLocaleDateString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh" })}</td>
            </tr>
          ))}
        </Table>
      )}
      {data.total > PAGE && (
        <nav aria-label="الصفحات" className="no-print flex gap-3 text-sm">
          {page > 1 && <Link href={qs(page - 1)} className="text-brand-700 underline">السابقة</Link>}
          <span>صفحة {page} من {Math.ceil(data.total / PAGE)}</span>
          {page * PAGE < data.total && <Link href={qs(page + 1)} className="text-brand-700 underline">التالية</Link>}
        </nav>
      )}
    </div>
  );
}
