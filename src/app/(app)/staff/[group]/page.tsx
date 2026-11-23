import Link from "next/link";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/server/current-user";
import { DIRECTORY_GROUPS, listEmployees, type DirectoryGroup } from "@/server/services/employees";
import { can, ForbiddenError } from "@/auth/rbac";
import { CATEGORY_AR, EMPLOYMENT_STATUS_AR } from "@/domain/labels";
import { btnPrimary, DataBadge, Denied, inputCls, PageHeader, Table } from "@/components/ui";
import { ServiceDateView } from "@/components/service-date";

type SP = { q?: string; category?: string; stage?: string; status?: string };

export default async function StaffDirectoryPage({ params, searchParams }: { params: Promise<{ group: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireUser();
  const { group } = await params;
  if (!(group in DIRECTORY_GROUPS)) notFound();
  const g = group as DirectoryGroup;
  const sp = await searchParams;
  const db = getDb();
  const stages = await db.select().from(s.stages).orderBy(asc(s.stages.order));
  let data;
  try {
    data = await listEmployees(db, ctx, g, { q: sp.q?.slice(0, 100), category: sp.category, stageId: stages.some((x) => x.id === sp.stage) ? sp.stage : undefined, status: sp.status });
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  const cats = DIRECTORY_GROUPS[g].categories;
  const sens = data.sensitive;
  const head =
    g === "admin"
      ? ["الاسم", "المسمى الوظيفي", ...(sens ? ["المباشرة بالوزارة", "المباشرة بالمدرسة"] : []), "المسؤوليات والتكليفات", ...(sens ? ["صلاحيات النظام"] : []), "حالة البيانات"]
      : g === "service"
        ? ["الاسم", "المعرّف الداخلي", "المسمى الوظيفي", "المهام المعتمدة", "المرحلة / الموقع", "الحالة الوظيفية", ...(sens ? ["ملاحظات"] : [])]
        : ["الاسم", "التخصص", "المرحلة", ...(sens ? ["المباشرة بالوزارة", "المباشرة بالمدرسة"] : []), "الحالة الوظيفية", "حالة البيانات"];
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        title={DIRECTORY_GROUPS[g].title}
        subtitle={`${data.rows.length.toLocaleString("en-US")} سجل · وجود الموظفة في الدليل لا يعني امتلاكها حساب دخول.`}
        actions={can(ctx, "employees.write") && <Link href={`/employees/new?group=${g}`} className={btnPrimary}>إضافة {g === "teachers" ? "معلمة" : g === "admin" ? "إدارية" : "مستخدمة أو حارس"}</Link>}
      />
      <form className="no-print grid gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]" role="search" aria-label="تصفية الدليل">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="الاسم أو المسمى أو التخصص" aria-label="بحث" className={inputCls} />
        {cats.length > 1 ? (
          <select name="category" defaultValue={sp.category ?? ""} aria-label="الفئة" className={inputCls}>
            <option value="">كل الفئات</option>
            {cats.map((c) => <option key={c} value={c}>{CATEGORY_AR[c]}</option>)}
          </select>
        ) : <span className="hidden md:block" />}
        <select name="stage" defaultValue={sp.stage ?? ""} aria-label="المرحلة" className={inputCls}>
          <option value="">كل المراحل</option>
          {stages.map((x) => <option key={x.id} value={x.id}>{x.nameAr}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} aria-label="الحالة الوظيفية" className={inputCls}>
          <option value="">كل الحالات</option>
          {Object.entries(EMPLOYMENT_STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="rounded-lg bg-brand-700 px-5 py-2 font-semibold text-white">تصفية</button>
      </form>
      {data.rows.length === 0 ? <p className="text-gray-700">لا توجد سجلات.</p> : (
        <Table head={head}>
          {data.rows.map((r) => {
            const name = <td className="p-3"><Link href={`/employees/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.fullName}</Link></td>;
            if (g === "admin")
              return (
                <tr key={r.id}>
                  {name}
                  <td className="p-3">{r.jobTitle}</td>
                  {sens && <td className="p-3"><ServiceDateView v={r.ministry} /></td>}
                  {sens && <td className="p-3"><ServiceDateView v={r.school} /></td>}
                  <td className="p-3">{[...r.assignments, r.duties].filter(Boolean).join(" · ") || "—"}</td>
                  {sens && <td className="p-3">{r.account ? <>{r.account.roles.join("، ") || "بلا أدوار"}{!r.account.isActive && <span className="text-xs text-red-700"> (معطّل)</span>}</> : <span className="text-gray-600">لا يوجد حساب</span>}</td>}
                  <td className="p-3"><DataBadge status={r.dataStatus} /></td>
                </tr>
              );
            if (g === "service")
              return (
                <tr key={r.id}>
                  {name}
                  <td className="p-3 font-mono text-xs" dir="ltr">{r.id.slice(0, 8)}</td>
                  <td className="p-3">{r.jobTitle}</td>
                  <td className="p-3">{r.duties ?? "—"}</td>
                  <td className="p-3">{[r.stages.join("، "), r.workLocation].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="p-3">{EMPLOYMENT_STATUS_AR[r.status]}</td>
                  {sens && <td className="p-3">{r.notes ?? "—"}</td>}
                </tr>
              );
            return (
              <tr key={r.id}>
                {name}
                <td className="p-3">{r.specialization ?? <span className="text-amber-900">غير مكتمل</span>}</td>
                <td className="p-3">{r.stages.join("، ") || "—"}</td>
                {sens && <td className="p-3"><ServiceDateView v={r.ministry} /></td>}
                {sens && <td className="p-3"><ServiceDateView v={r.school} /></td>}
                <td className="p-3">{EMPLOYMENT_STATUS_AR[r.status]}</td>
                <td className="p-3"><DataBadge status={r.dataStatus} /></td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
