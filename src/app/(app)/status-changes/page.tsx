import Link from "next/link";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { listStatusChanges } from "@/server/services/status-changes";
import { DONE_AR } from "@/server/run-action";
import { stageScope } from "@/auth/rbac";
import { REQUEST_STATUS_AR, STATUS_CHANGE_AR } from "@/domain/labels";
import { ActionForm } from "@/components/form";
import { Denied, PageHeader, SavedNotice, Table } from "@/components/ui";
import { decideStatusChangeAction } from "./actions";

export default async function StatusChangesPage({ searchParams }: { searchParams: Promise<{ saved?: string; done?: string; pending?: string }> }) {
  const ctx = await requireUser();
  if (stageScope(ctx, "status_changes.read").kind === "none") return <Denied />;
  const sp = await searchParams;
  const pendingOnly = sp.pending === "1";
  const rows = await listStatusChanges(getDb(), ctx, { pendingOnly });
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <SavedNotice show={sp.saved === "1"} />
      {sp.done && DONE_AR[sp.done] && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-800">{DONE_AR[sp.done]}</p>}
      <PageHeader title="الانقطاع والنقل" subtitle="لا تتغير حالة قيد الطالبة إلا بعد اعتماد الطلب بصلاحية مخولة، ولا تحويل آلي إلى «منقطعة». لا يُحذف سجل الطالبة عند نقلها. يُسجَّل الطلب من ملف الطالبة." />
      <nav className="no-print flex gap-3 text-sm" aria-label="تصفية">
        <Link href="/status-changes" className={!pendingOnly ? "font-bold text-brand-800" : "text-brand-700 underline"}>كل الطلبات</Link>
        <Link href="/status-changes?pending=1" className={pendingOnly ? "font-bold text-brand-800" : "text-brand-700 underline"}>قيد الاعتماد</Link>
      </nav>
      {rows.length === 0 ? <p className="text-gray-700">لا توجد طلبات.</p> : (
        <Table head={["الطالبة", "الفصل", "الإجراء", "تاريخ السريان", "المرجع / الوجهة", "مقدمة الطلب", "الحالة"]}>
          {rows.map((r) => (
            <tr key={r.c.id}>
              <td className="p-2"><Link href={`/students/${r.c.studentId}`} className="font-medium text-brand-700 hover:underline">{r.fullName}</Link></td>
              <td className="p-2">{r.stageName} · {r.grade} / {r.section}</td>
              <td className="p-2">{STATUS_CHANGE_AR[r.c.type]}</td>
              <td className="p-2" dir="ltr">{r.c.effectiveDate}</td>
              <td className="p-2">{[r.c.reference, r.c.destinationSchool].filter(Boolean).join(" · ") || "—"}</td>
              <td className="p-2">{r.requestedBy}</td>
              <td className="p-2">
                {r.c.status === "PENDING" && r.canApprove ? (
                  <>
                  <span className="mb-1 block text-amber-900">{REQUEST_STATUS_AR.PENDING}</span>
                  <ActionForm action={decideStatusChangeAction.bind(null, r.c.id)} submitLabel="حفظ القرار" confirmMessage="تأكيد القرار؟ عند الاعتماد تتغير حالة قيد الطالبة." ariaLabel={`قرار ${r.fullName}`} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="version" value={r.c.version} />
                    <input type="hidden" name="back" value={pendingOnly ? "/status-changes?pending=1" : "/status-changes"} />
                    <select name="decision" aria-label="القرار" className="rounded border border-gray-300 px-2 py-1"><option value="APPROVED">اعتماد</option><option value="REJECTED">رفض</option></select>
                  </ActionForm>
                  </>
                ) : REQUEST_STATUS_AR[r.c.status]}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
