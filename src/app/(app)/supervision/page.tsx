import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/server/current-user";
import { dailySupervision, listAreas, weeklySupervision } from "@/server/services/supervision";
import { can, ForbiddenError } from "@/auth/rbac";
import { ASSIGNMENT_STATUS_AR, SUPERVISION_PERIOD_AR } from "@/domain/labels";
import { DAY_NAMES_AR, formatHijri, minutesToHHMM, riyadhNow } from "@/domain/time";
import { ActionForm, Field } from "@/components/form";
import { PrintButton } from "@/components/print-button";
import { btnSecondary, Card, Denied, inputCls, PageHeader, Table } from "@/components/ui";
import { createAssignmentAction, updateAssignmentAction } from "./actions";

export default async function SupervisionPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await requireUser();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : riyadhNow().date;
  const db = getDb();
  let week, day, floors;
  try {
    [week, day, floors] = await Promise.all([weeklySupervision(db, ctx, date), dailySupervision(db, ctx, date), listAreas(db, ctx)]);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  const canWrite = can(ctx, "supervision.write");
  const employees = canWrite ? await db.select({ id: s.employees.id, fullName: s.employees.fullName, jobTitle: s.employees.jobTitle }).from(s.employees).where(eq(s.employees.status, "ACTIVE")).orderBy(asc(s.employees.fullName)) : [];
  const areas = floors.flatMap((f) => f.areas.filter((a) => a.isActive).map((a) => ({ id: a.id, label: `${f.building} · ${f.name} · ${a.name}` })));
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="مراقبة الأدوار"
        subtitle="تنظيم تكليفات مراقبة الأدوار والممرات والمناطق — وليس تتبعًا إلكترونيًا لمواقع الأشخاص. كل تكليف يُسند صراحة."
        actions={<><PrintButton label="طباعة جدول المراقبة" />{canWrite && <Link href="/supervision/areas" className={btnSecondary}>المباني والأدوار والمناطق</Link>}</>}
      />
      <form className="no-print flex flex-wrap gap-2" aria-label="اختيار اليوم">
        <input type="date" name="date" defaultValue={date} aria-label="التاريخ" className={`${inputCls} md:w-48`} />
        <button className="rounded-lg bg-brand-700 px-5 py-2 font-semibold text-white">عرض</button>
      </form>

      <section aria-labelledby="daily" className="space-y-2">
        <h2 id="daily" className="font-semibold">جدول المراقبة اليومي — {DAY_NAMES_AR[new Date(`${date}T12:00:00Z`).getUTCDay()]} {formatHijri(date)}</h2>
        {!day ? <p className="text-sm text-gray-700">التاريخ خارج الفصول الدراسية.</p> : day.rows.length === 0 ? <p className="text-sm text-gray-700">لا توجد تكليفات لهذا اليوم.</p> : (
          <Table head={["الوقت", "الفترة", "المنطقة", "الموظفة المسؤولة", "النوع", "الحالة"]}>
            {day.rows.map((r) => (
              <tr key={r.a.id} className={r.a.status === "CANCELLED" ? "text-gray-500" : ""}>
                <td className="p-2" dir="ltr">{minutesToHHMM(r.a.startMinute)}–{minutesToHHMM(r.a.endMinute)}</td>
                <td className="p-2">{SUPERVISION_PERIOD_AR[r.a.periodType]}</td>
                <td className="p-2">{r.building} · {r.floor} · {r.area}</td>
                <td className="p-2 font-medium">{r.employee}</td>
                <td className="p-2">{r.a.date ? "ليوم محدد" : "أسبوعي"}</td>
                <td className="p-2">
                  {canWrite ? (
                    <ActionForm action={updateAssignmentAction.bind(null, r.a.id)} ariaLabel={`حالة مراقبة ${r.employee} ${r.area}`} className="no-print flex flex-wrap items-center gap-2">
                      <div key={r.a.version}>
                        <input type="hidden" name="version" value={r.a.version} />
                        <input type="hidden" name="notes" value={r.a.notes ?? ""} />
                        <select name="status" defaultValue={r.a.status} aria-label="الحالة" className="rounded border border-gray-300 px-2 py-1">
                          {Object.entries(ASSIGNMENT_STATUS_AR).filter(([k]) => r.a.status !== "CANCELLED" || k === "CANCELLED").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </div>
                    </ActionForm>
                  ) : null}
                  <span className={canWrite ? "hidden print:inline" : ""}>{ASSIGNMENT_STATUS_AR[r.a.status]}</span>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section aria-labelledby="weekly" className="space-y-2">
        <h2 id="weekly" className="font-semibold">جدول المراقبة الأسبوعي {week ? `— ${week.termName}` : ""}</h2>
        {!week ? <p className="text-sm text-gray-700">لا يوجد فصل دراسي.</p> : (
          <div className="grid gap-3 md:grid-cols-5">
            {[0, 1, 2, 3, 4].map((d) => (
              <div key={d} className="rounded-xl border border-gray-200 bg-white p-3">
                <h3 className="mb-2 font-semibold text-brand-900">{DAY_NAMES_AR[d]}</h3>
                <ul className="space-y-1.5 text-xs">
                  {week.rows.filter((r) => r.a.dayOfWeek === d).map((r) => (
                    <li key={r.a.id} className="rounded bg-brand-50 p-1.5">
                      <span dir="ltr" className="block">{minutesToHHMM(r.a.startMinute)}–{minutesToHHMM(r.a.endMinute)}</span>
                      {SUPERVISION_PERIOD_AR[r.a.periodType]} · {r.area}<br /><strong>{r.employee}</strong>
                    </li>
                  ))}
                  {!week.rows.some((r) => r.a.dayOfWeek === d) && <li className="text-gray-500">—</li>}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {canWrite && (
        <Card title="تكليف مراقبة جديد" className="no-print">
          {areas.length === 0 ? <p className="text-sm">عرّفي المناطق أولًا من «المباني والأدوار والمناطق».</p> : (
            <ActionForm action={createAssignmentAction} submitLabel="حفظ التكليف" ariaLabel="تكليف مراقبة">
              <div className="grid gap-3 md:grid-cols-3">
                <Field name="areaId" label="المنطقة"><select id="areaId" name="areaId" className={inputCls}>{areas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></Field>
                <Field name="employeeId" label="الموظفة المسؤولة">
                  <select id="employeeId" name="employeeId" defaultValue="" className={inputCls}><option value="">— اختاري —</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.jobTitle})</option>)}</select>
                </Field>
                <Field name="periodType" label="نوع الفترة"><select id="periodType" name="periodType" className={inputCls}>{Object.entries(SUPERVISION_PERIOD_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field name="mode" label="نوع التكليف"><select id="mode" name="mode" className={inputCls}><option value="WEEKLY">أسبوعي متكرر</option><option value="DATE">ليوم محدد</option></select></Field>
                <Field name="dayOfWeek" label="اليوم (للأسبوعي)"><select id="dayOfWeek" name="dayOfWeek" className={inputCls}><option value="">—</option>{[0, 1, 2, 3, 4].map((d) => <option key={d} value={d}>{DAY_NAMES_AR[d]}</option>)}</select></Field>
                <Field name="date" label="التاريخ (ليوم محدد)"><input id="date" type="date" name="date" className={inputCls} /></Field>
                <Field name="start" label="وقت البداية"><input id="start" type="time" name="start" className={inputCls} /></Field>
                <Field name="end" label="وقت النهاية"><input id="end" type="time" name="end" className={inputCls} /></Field>
                <Field name="notes" label="ملاحظات إدارية"><input id="notes" name="notes" className={inputCls} /></Field>
              </div>
              <p className="text-xs text-gray-600">يُرفض التكليف إن تعارض مع حصص الموظفة أو انتظارها أو نشاطها أو مراقبة أخرى.</p>
            </ActionForm>
          )}
        </Card>
      )}
    </div>
  );
}
