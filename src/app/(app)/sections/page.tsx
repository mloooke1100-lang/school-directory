import Link from "next/link";
import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/server/current-user";
import { listSections } from "@/server/services/sections";
import { can, ForbiddenError } from "@/auth/rbac";
import { btnPrimary, Denied, inputCls, PageHeader, Table } from "@/components/ui";

export default async function SectionsPage({ searchParams }: { searchParams: Promise<{ year?: string; stage?: string }> }) {
  const ctx = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const [years, stages] = await Promise.all([db.select().from(s.academicYears).orderBy(asc(s.academicYears.startDate)), db.select().from(s.stages).orderBy(asc(s.stages.order))]);
  const yearId = years.some((y) => y.id === sp.year) ? sp.year : undefined;
  const stageId = stages.some((x) => x.id === sp.stage) ? sp.stage : undefined;
  let rows;
  try {
    rows = await listSections(db, ctx, { yearId, stageId });
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="الفصول والشعب" subtitle={`${rows.length} شعبة`} actions={can(ctx, "sections.write") && <Link href="/sections/new" className={btnPrimary}>إضافة شعبة</Link>} />
      <form className="no-print grid gap-2 md:grid-cols-[auto_auto_auto]" aria-label="تصفية الفصول">
        <select name="year" defaultValue={yearId ?? ""} aria-label="السنة الدراسية" className={inputCls}>
          <option value="">السنة النشطة</option>
          {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
        <select name="stage" defaultValue={stageId ?? ""} aria-label="المرحلة" className={inputCls}>
          <option value="">كل المراحل</option>
          {stages.map((x) => <option key={x.id} value={x.id}>{x.nameAr}</option>)}
        </select>
        <button className="rounded-lg bg-brand-700 px-5 py-2 font-semibold text-white">تصفية</button>
      </form>
      {rows.length === 0 ? <p className="text-gray-700">لا توجد شعب.</p> : (
        <Table head={["المرحلة", "الصف / الشعبة", "رائدة الفصل", "القاعة", "الطالبات المنتظمات", "الحالة"]}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="p-3">{r.stageName}</td>
              <td className="p-3"><Link href={`/sections/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.gradeName} / {r.name}</Link></td>
              <td className="p-3">{r.homeroom ?? "—"}</td>
              <td className="p-3">{r.room ?? "—"}</td>
              <td className="p-3">{r.students}</td>
              <td className="p-3">{r.isActive ? "نشطة" : <span className="text-gray-500">معطّلة</span>}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
