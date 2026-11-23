import Link from "next/link";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { searchDirectory } from "@/server/search";
import * as s from "@/db/schema";

const CATEGORY_AR: Record<string, string> = { LEADERSHIP: "قيادة", TEACHER: "معلمة", ADMINISTRATIVE: "إدارية", SERVICE: "مستخدمة", GUARD: "حارس", COUNSELOR: "مرشدة" };
const DATA_AR: Record<string, string> = { COMPLETE: "مكتمل", INCOMPLETE: "غير مكتمل", PENDING_VERIFICATION: "بانتظار التحقق" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; stage?: string; category?: string }> }) {
  const ctx = await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const db = getDb();
  const stages = await db.select().from(s.stages).orderBy(s.stages.order);
  type Cat = (typeof s.employeeCategory.enumValues)[number];
  const category = (s.employeeCategory.enumValues as readonly string[]).includes(sp.category ?? "") ? (sp.category as Cat) : undefined;
  const stageId = stages.some((x) => x.id === sp.stage) ? sp.stage : undefined;
  const r = q ? await searchDirectory(db, ctx, q, { stageId, category }) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <h1 className="text-2xl font-bold text-brand-900">البحث الشامل</h1>
      <form className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto]" role="search">
        <input name="q" defaultValue={q} placeholder="الاسم أو جزء منه، الرقم المدرسي، التخصص…" aria-label="نص البحث" className="rounded-xl border border-gray-300 bg-white px-4 py-2.5" />
        <select name="stage" defaultValue={stageId ?? ""} aria-label="المرحلة" className="rounded-xl border border-gray-300 bg-white px-3 py-2.5">
          <option value="">كل المراحل</option>
          {stages.map((st) => <option key={st.id} value={st.id}>{st.nameAr}</option>)}
        </select>
        <select name="category" defaultValue={category ?? ""} aria-label="الوظيفة" className="rounded-xl border border-gray-300 bg-white px-3 py-2.5">
          <option value="">كل الوظائف</option>
          {Object.entries(CATEGORY_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="rounded-xl bg-brand-700 px-5 py-2.5 font-semibold text-white">بحث</button>
      </form>

      {!r && <p className="text-gray-700">اكتبي حرفين على الأقل للبحث.</p>}
      {r && (
        <>
          <section aria-labelledby="st">
            <h2 id="st" className="mb-2 font-semibold">الطالبات ({r.students.length})</h2>
            {r.students.length === 0 ? <p className="text-sm text-gray-600">لا نتائج.</p> : (
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-brand-50 text-right text-brand-900"><tr><th className="p-3">الاسم</th><th className="p-3">الرقم المدرسي</th><th className="p-3">المرحلة</th><th className="p-3">الصف / الشعبة</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {r.students.map((x) => (
                      <tr key={x.id}>
                        <td className="p-3"><Link href={`/students/${x.id}`} className="font-medium text-brand-700 underline-offset-2 hover:underline">{x.fullName}</Link></td>
                        <td className="p-3" dir="ltr">{x.schoolNumber ?? "—"}</td>
                        <td className="p-3">{x.stageName}</td>
                        <td className="p-3">{x.gradeName} / {x.sectionName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section aria-labelledby="em">
            <h2 id="em" className="mb-2 font-semibold">الموظفات ({r.employees.length})</h2>
            {r.employees.length === 0 ? <p className="text-sm text-gray-600">لا نتائج.</p> : (
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white text-sm">
                {r.employees.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <span className="font-medium">{x.fullName}</span>
                    <span className="text-gray-700">{CATEGORY_AR[x.category]} · {x.jobTitle}{x.specialization ? ` · ${x.specialization}` : ""}</span>
                    {x.dataStatus !== "COMPLETE" && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{DATA_AR[x.dataStatus]}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {r.sections.length > 0 && (
            <section aria-labelledby="sec">
              <h2 id="sec" className="mb-2 font-semibold">الفصول</h2>
              <ul className="flex flex-wrap gap-2 text-sm">{r.sections.map((x) => <li key={x.id} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5">{x.stageName} · {x.label}</li>)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
