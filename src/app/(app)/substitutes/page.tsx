import Link from "next/link";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { listSubstitutes } from "@/server/services/substitutes";
import { can, stageScope } from "@/auth/rbac";
import { ASSIGNMENT_STATUS_AR } from "@/domain/labels";
import { formatHijri, minutesToHHMM, riyadhNow } from "@/domain/time";
import { ActionForm } from "@/components/form";
import { btnPrimary, Denied, inputCls, PageHeader, SavedNotice, Table } from "@/components/ui";
import { updateSubstituteAction } from "./actions";

export default async function SubstitutesPage({ searchParams }: { searchParams: Promise<{ date?: string; saved?: string }> }) {
  const ctx = await requireUser();
  if (stageScope(ctx, "substitutes.read").kind === "none") return <Denied />;
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : riyadhNow().date;
  const rows = await listSubstitutes(getDb(), ctx, date);
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <SavedNotice show={sp.saved === "1"} />
      <PageHeader title="حصص الانتظار" subtitle={`${formatHijri(date)} — سجلات منفصلة تظهر في جدول ذلك اليوم فقط ولا تعدّل الجدول الأسبوعي.`} actions={can(ctx, "substitutes.write") && <Link href={`/substitutes/new?date=${date}`} className={btnPrimary}>إضافة حصة انتظار</Link>} />
      <form className="no-print flex flex-wrap gap-2" aria-label="اختيار التاريخ">
        <input type="date" name="date" defaultValue={date} aria-label="التاريخ" className={`${inputCls} md:w-48`} />
        <button className="rounded-lg bg-brand-700 px-5 py-2 font-semibold text-white">عرض</button>
      </form>
      {rows.length === 0 ? <p className="text-gray-700">لا توجد حصص انتظار في هذا التاريخ.</p> : (
        <Table head={["المرحلة", "الفصل", "الحصة", "الوقت", "المعلمة الأساسية", "المعلمة البديلة", "الحالة"]}>
          {rows.map((r) => (
            <tr key={r.id} className={r.status === "CANCELLED" ? "text-gray-500" : ""}>
              <td className="p-2">{r.stageName}</td>
              <td className="p-2">{r.section}</td>
              <td className="p-2">{r.periodNumber}</td>
              <td className="p-2" dir="ltr">{r.startMinute != null && r.endMinute != null ? `${minutesToHHMM(r.startMinute)}–${minutesToHHMM(r.endMinute)}` : "—"}</td>
              <td className="p-2">{r.original ?? "—"}</td>
              <td className="p-2 font-medium">{r.substitute}</td>
              <td className="p-2">
                {r.canWrite ? (
                  <ActionForm action={updateSubstituteAction.bind(null, r.id)} ariaLabel={`حالة انتظار الحصة ${r.periodNumber}`} className="flex flex-wrap items-center gap-2" confirmMessage={undefined}>
                    <div key={r.version} className="flex gap-2">
                      <input type="hidden" name="version" value={r.version} />
                      <input type="hidden" name="notes" value={r.notes ?? ""} />
                      <select name="status" defaultValue={r.status} aria-label="الحالة" className="rounded border border-gray-300 px-2 py-1">
                        {/* الملغى لا يُعاد تفعيله؛ يبقى النموذج ظاهرًا لتبقى رسالة الحفظ */}
                        {Object.entries(ASSIGNMENT_STATUS_AR).filter(([k]) => r.status !== "CANCELLED" || k === "CANCELLED").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </div>
                  </ActionForm>
                ) : ASSIGNMENT_STATUS_AR[r.status]}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
