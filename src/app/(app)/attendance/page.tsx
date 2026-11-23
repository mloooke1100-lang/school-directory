import Link from "next/link";
import { getDb } from "@/db/client";
import { DONE_AR } from "@/server/run-action";
import { requireUser } from "@/server/current-user";
import { dailyLog, sectionRoster } from "@/server/services/attendance";
import { sectionOptions } from "@/server/services/section-options";
import { ForbiddenError, stageScope } from "@/auth/rbac";
import { ABSENCE_KIND_AR, RECORD_STATUS_AR } from "@/domain/labels";
import { DAY_NAMES_AR, formatHijri, minutesToHHMM, riyadhNow } from "@/domain/time";
import { dayOfWeekOf } from "@/domain/schedule";
import { ActionForm, Field } from "@/components/form";
import { Card, Denied, inputCls, PageHeader, Table } from "@/components/ui";
import { approveEventAction, cancelEventAction, correctEventAction, recordAbsencesAction, recordLateAction } from "./actions";

type Ev = { id: string; version: number; type: string; status: string; absenceKind: string | null; lateMinutes: number | null; arrivalMinute: number | null; schoolStartMinute: number | null };
const describe = (e: Ev) => (e.type === "ABSENCE" ? `غياب ${ABSENCE_KIND_AR[e.absenceKind ?? "UNKNOWN"]}` : `تأخر ${e.lateMinutes} دقيقة (وصول ${minutesToHHMM(e.arrivalMinute!)})`);

function EventActions({ e, canWrite, canApprove, label, back }: { e: Ev; canWrite: boolean; canApprove: boolean; label: string; back: string }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      {canApprove && e.status === "RECORDED" && (
        <ActionForm action={approveEventAction.bind(null, e.id)} submitLabel="اعتماد" ariaLabel={`اعتماد ${label}`} className="space-y-1">
          <input type="hidden" name="version" value={e.version} />
          <input type="hidden" name="back" value={back} />
        </ActionForm>
      )}
      {canWrite && (
        <ActionForm action={correctEventAction.bind(null, e.id)} submitLabel="تصحيح" ariaLabel={`تصحيح ${label}`} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="version" value={e.version} />
          <input type="hidden" name="back" value={back} />
          {e.type === "ABSENCE" ? (
            <select name="absenceKind" defaultValue={e.absenceKind ?? "UNKNOWN"} aria-label="نوع الغياب" className="rounded border border-gray-300 px-2 py-1">
              {Object.entries(ABSENCE_KIND_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          ) : (
            <input type="time" name="arrival" defaultValue={minutesToHHMM(e.arrivalMinute!)} aria-label="وقت الوصول المصحّح" className="rounded border border-gray-300 px-2 py-1" />
          )}
        </ActionForm>
      )}
      {canWrite && (
        <ActionForm action={cancelEventAction.bind(null, e.id)} submitLabel="إلغاء السجل" confirmMessage="إلغاء هذا السجل؟ يبقى محفوظًا بحالة «ملغى»." ariaLabel={`إلغاء ${label}`} className="space-y-1">
          <input type="hidden" name="version" value={e.version} />
          <input type="hidden" name="back" value={back} />
        </ActionForm>
      )}
    </div>
  );
}

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string; section?: string; done?: string }> }) {
  const ctx = await requireUser();
  if (stageScope(ctx, "attendance.read").kind === "none") return <Denied />;
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : riyadhNow().date;
  const db = getDb();
  const sections = await sectionOptions(db, ctx, "attendance.read");
  const section = sections.find((x) => x.id === sp.section);
  let roster: Awaited<ReturnType<typeof sectionRoster>> | null = null;
  if (section) {
    try {
      roster = await sectionRoster(db, ctx, section.id, date);
    } catch (e) {
      if (e instanceof ForbiddenError) return <Denied />;
      throw e;
    }
  }
  const log = section ? [] : await dailyLog(db, ctx, date);
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {sp.done && DONE_AR[sp.done] && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-800">{DONE_AR[sp.done]}</p>}
      <PageHeader title="الغياب والتأخر" subtitle={`${DAY_NAMES_AR[dayOfWeekOf(date)]} ${formatHijri(date)} — سجلات داخلية وليست تسجيلًا رسميًا في نظام نور. لا تتغير حالة القيد آليًا بسبب الغياب.`} />
      <form className="no-print grid gap-2 md:grid-cols-[auto_1fr_auto]" aria-label="اختيار اليوم والفصل">
        <input type="date" name="date" defaultValue={date} aria-label="التاريخ" className={inputCls} />
        <select name="section" defaultValue={section?.id ?? ""} aria-label="الفصل" className={inputCls}>
          <option value="">سجل اليوم لكل الفصول</option>
          {sections.map((x) => <option key={x.id} value={x.id}>{x.stage} · {x.grade} / {x.name}</option>)}
        </select>
        <button className="rounded-lg bg-brand-700 px-5 py-2 font-semibold text-white">عرض</button>
      </form>

      {!section && (
        log.length === 0 ? <p className="text-gray-700">لا توجد سجلات غياب أو تأخر في هذا اليوم.</p> : (
          <Table head={["الطالبة", "الفصل", "الحدث", "الحالة"]}>
            {log.map((r) => (
              <tr key={r.e.id} className={["CORRECTED", "CANCELLED"].includes(r.e.status) ? "text-gray-500" : ""}>
                <td className="p-2"><Link href={`/students/${r.e.studentId}`} className="text-brand-700 hover:underline">{r.fullName}</Link></td>
                <td className="p-2"><Link href={`/attendance?date=${date}&section=${r.sectionId}`} className="hover:underline">{r.stageName} · {r.grade} / {r.section}</Link></td>
                <td className="p-2">{describe(r.e)}</td>
                <td className="p-2">{RECORD_STATUS_AR[r.e.status]}</td>
              </tr>
            ))}
          </Table>
        )
      )}

      {section && roster && (
        <>
          {roster.canWrite && (
            <Card title={`تسجيل الغياب — ${section.grade} / ${section.name}`}>
              <ActionForm action={recordAbsencesAction} submitLabel="حفظ الغياب" ariaLabel="تسجيل الغياب">
                <input type="hidden" name="sectionId" value={section.id} />
                <input type="hidden" name="date" value={date} />
                <ul className="grid gap-1 md:grid-cols-2" key={roster.rows.map((r) => (r.absence?.id ?? "") + (r.late?.id ?? "")).join()}>
                  {roster.rows.map((r) => (
                    <li key={r.studentId}>
                      <label className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${r.absence ? "border-red-200 bg-red-50" : r.late ? "border-amber-200 bg-amber-50" : "border-gray-200"}`}>
                        <input type="checkbox" name="studentIds" value={r.studentId} disabled={!!r.absence || !!r.late} />
                        {r.fullName}
                        {r.absence && <span className="mr-auto text-xs text-red-800">غائبة</span>}
                        {r.late && <span className="mr-auto text-xs text-amber-900">متأخرة {r.late.lateMinutes} د</span>}
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field name="absenceKind" label="نوع الغياب">
                    <select id="absenceKind" name="absenceKind" defaultValue="UNKNOWN" className={inputCls}>{Object.entries(ABSENCE_KIND_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  </Field>
                  <Field name="notes" label="ملاحظات الحدث (اختياري)"><input id="notes" name="notes" className={inputCls} /></Field>
                </div>
              </ActionForm>
            </Card>
          )}
          {roster.canWrite && (
            <Card title="تسجيل التأخر">
              <ActionForm action={recordLateAction} submitLabel="حفظ التأخر" ariaLabel="تسجيل التأخر">
                <input type="hidden" name="sectionId" value={section.id} />
                <input type="hidden" name="date" value={date} />
                <div key={roster.rows.filter((r) => r.late).length} className="grid gap-3 md:grid-cols-3">
                  <Field name="studentId" id="late-student" label="الطالبة">
                    <select id="late-student" name="studentId" className={inputCls}>
                      <option value="">— اختاري —</option>
                      {roster.rows.filter((r) => !r.absence && !r.late).map((r) => <option key={r.studentId} value={r.studentId}>{r.fullName}</option>)}
                    </select>
                  </Field>
                  <Field name="schoolStart" id="late-start" label="وقت بداية الدوام" hint={roster.defaultStart === null ? "أوقات الحصص غير مكتملة لهذه المرحلة: أدخليه يدويًا" : "من أوقات الحصص المُعدّة"}>
                    <input id="late-start" type="time" name="schoolStart" defaultValue={roster.defaultStart === null ? "" : minutesToHHMM(roster.defaultStart)} className={inputCls} />
                  </Field>
                  <Field name="arrival" id="late-arrival" label="وقت الوصول"><input id="late-arrival" type="time" name="arrival" className={inputCls} /></Field>
                </div>
                <p className="text-xs text-gray-600">تُحسب مدة التأخر تلقائيًا.</p>
              </ActionForm>
            </Card>
          )}
          <section aria-labelledby="ev" className="space-y-2">
            <h2 id="ev" className="font-semibold">سجلات اليوم في الفصل</h2>
            {roster.rows.every((r) => !r.absence && !r.late) ? <p className="text-sm text-gray-700">لا توجد سجلات.</p> : (
              <ul className="space-y-2">
                {roster.rows.flatMap((r) => [r.absence, r.late].filter((e): e is NonNullable<typeof e> => !!e).map((e) => (
                  <li key={e.id} className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
                    <p className="mb-2"><strong>{r.fullName}</strong> — {describe(e)} · {RECORD_STATUS_AR[e.status]}{e.supersedesId && " · (تصحيح لسجل سابق)"}</p>
                    <EventActions e={e} canWrite={roster!.canWrite} canApprove={roster!.canApprove} label={`${r.fullName} ${e.type === "ABSENCE" ? "غياب" : "تأخر"}`} back={`/attendance?date=${date}&section=${section.id}`} />
                  </li>
                )))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
