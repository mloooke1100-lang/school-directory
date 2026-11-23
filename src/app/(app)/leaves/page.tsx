import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/server/current-user";
import { listLeaves } from "@/server/services/leaves";
import { sectionOptions } from "@/server/services/section-options";
import { DONE_AR } from "@/server/run-action";
import { can, stageScope } from "@/auth/rbac";
import { REQUEST_STATUS_AR } from "@/domain/labels";
import { formatHijri, minutesToHHMM, riyadhNow } from "@/domain/time";
import { ActionForm, Field } from "@/components/form";
import { Card, Denied, inputCls, PageHeader, Table } from "@/components/ui";
import { cancelLeaveAction, createLeaveAction, decideLeaveAction, leaveExitAction } from "./actions";

export default async function LeavesPage({ searchParams }: { searchParams: Promise<{ date?: string; section?: string; done?: string }> }) {
  const ctx = await requireUser();
  if (stageScope(ctx, "leave.read").kind === "none") return <Denied />;
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : riyadhNow().date;
  const db = getDb();
  const back = `/leaves?date=${date}${sp.section ? `&section=${sp.section}` : ""}`;
  const [rows, sections] = await Promise.all([listLeaves(db, ctx, date), sectionOptions(db, ctx, "leave.write")]);
  const section = sections.find((x) => x.id === sp.section);
  const students = section
    ? await db.select({ id: s.students.id, fullName: s.students.fullName }).from(s.studentEnrollments).innerJoin(s.students, eq(s.students.id, s.studentEnrollments.studentId)).where(and(eq(s.studentEnrollments.sectionId, section.id), eq(s.studentEnrollments.status, "ACTIVE"))).orderBy(asc(s.students.fullName))
    : [];
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {sp.done && DONE_AR[sp.done] && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-800">{DONE_AR[sp.done]}</p>}
      <PageHeader title="الاستئذان" subtitle={`${formatHijri(date)} — الطلب ثم الاعتماد ثم تسجيل وقت الخروج. ليست تسجيلًا رسميًا في نظام نور.`} />
      <form className="no-print flex flex-wrap gap-2" aria-label="اختيار التاريخ">
        <input type="date" name="date" defaultValue={date} aria-label="التاريخ" className={`${inputCls} md:w-48`} />
        <button className="rounded-lg bg-brand-700 px-5 py-2 font-semibold text-white">عرض</button>
      </form>
      {rows.length === 0 ? <p className="text-gray-700">لا توجد طلبات استئذان في هذا اليوم.</p> : (
        <Table head={["الطالبة", "الفصل", "وقت الطلب", "السبب", "الحالة", "وقت الخروج", "إجراء"]}>
          {rows.map((r) => (
            <tr key={r.l.id}>
              <td className="p-2 font-medium">{r.fullName}</td>
              <td className="p-2">{r.grade} / {r.section}</td>
              <td className="p-2" dir="ltr">{minutesToHHMM(r.l.requestMinute)}</td>
              <td className="p-2">{r.l.reason}</td>
              <td className="p-2">{REQUEST_STATUS_AR[r.l.status]}</td>
              <td className="p-2" dir="ltr">{r.l.exitMinute != null ? minutesToHHMM(r.l.exitMinute) : "—"}</td>
              <td className="p-2">
                <div className="flex flex-wrap gap-2">
                  {r.l.status === "PENDING" && r.canApprove && (
                    <ActionForm action={decideLeaveAction.bind(null, r.l.id)} submitLabel="حفظ القرار" ariaLabel={`قرار استئذان ${r.fullName}`} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="version" value={r.l.version} />
                      <input type="hidden" name="back" value={back} />
                      <select name="decision" aria-label="القرار" className="rounded border border-gray-300 px-2 py-1"><option value="APPROVED">اعتماد</option><option value="REJECTED">رفض</option></select>
                    </ActionForm>
                  )}
                  {r.l.status === "APPROVED" && r.canWrite && (
                    <ActionForm action={leaveExitAction.bind(null, r.l.id)} submitLabel="تسجيل الخروج" ariaLabel={`خروج ${r.fullName}`} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="version" value={r.l.version} />
                      <input type="hidden" name="back" value={back} />
                      <input type="time" name="exitTime" aria-label="وقت الخروج" className="rounded border border-gray-300 px-2 py-1" />
                    </ActionForm>
                  )}
                  {["PENDING", "APPROVED"].includes(r.l.status) && r.canWrite && (
                    <ActionForm action={cancelLeaveAction.bind(null, r.l.id)} submitLabel="إلغاء" confirmMessage="إلغاء طلب الاستئذان؟" ariaLabel={`إلغاء استئذان ${r.fullName}`} className="space-y-1">
                      <input type="hidden" name="version" value={r.l.version} />
                      <input type="hidden" name="back" value={back} />
                    </ActionForm>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {can(ctx, "leave.write") && (
        <Card title="طلب استئذان جديد">
          <form className="mb-3 flex flex-wrap gap-2" aria-label="اختيار الفصل">
            <input type="hidden" name="date" value={date} />
            <select name="section" defaultValue={section?.id ?? ""} aria-label="الفصل" className={`${inputCls} md:w-72`}>
              <option value="">— اختاري الفصل —</option>
              {sections.map((x) => <option key={x.id} value={x.id}>{x.stage} · {x.grade} / {x.name}</option>)}
            </select>
            <button className="rounded-lg border border-brand-300 bg-white px-4 py-2 text-sm text-brand-800">عرض الطالبات</button>
          </form>
          {section && (
            <ActionForm action={createLeaveAction} submitLabel="حفظ الطلب" ariaLabel="طلب استئذان">
              <input type="hidden" name="sectionId" value={section.id} />
              <input type="hidden" name="date" value={date} />
              <div key={rows.length} className="grid gap-3 md:grid-cols-3">
                <Field name="studentId" label="الطالبة">
                  <select id="studentId" name="studentId" className={inputCls}><option value="">— اختاري —</option>{students.map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}</select>
                </Field>
                <Field name="requestTime" label="وقت الاستئذان"><input id="requestTime" type="time" name="requestTime" className={inputCls} /></Field>
                <Field name="reason" label="السبب"><input id="reason" name="reason" className={inputCls} /></Field>
              </div>
            </ActionForm>
          )}
        </Card>
      )}
    </div>
  );
}
