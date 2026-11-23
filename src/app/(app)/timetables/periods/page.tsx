import Link from "next/link";
import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/server/current-user";
import { listPeriods } from "@/server/services/timetables";
import { getTermForDate } from "@/server/school";
import { can, ForbiddenError } from "@/auth/rbac";
import { PERIOD_KIND_AR } from "@/domain/labels";
import { DAY_NAMES_AR, minutesToHHMM, riyadhNow } from "@/domain/time";
import { ActionForm, Field } from "@/components/form";
import { BackLink, Card, Denied, inputCls, PageHeader } from "@/components/ui";
import { createPeriodAction, deletePeriodAction, updatePeriodAction } from "../actions";

function PeriodFields({ prefix, v }: { prefix: string; v?: { dayOfWeek: number | null; number: number; kind: string; label: string | null; startMinute: number; endMinute: number } }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
      <Field name="dayOfWeek" id={`${prefix}-day`} label="اليوم">
        <select id={`${prefix}-day`} name="dayOfWeek" defaultValue={v?.dayOfWeek ?? ""} className={inputCls}>
          <option value="">كل الأيام</option>
          {[0, 1, 2, 3, 4].map((d) => <option key={d} value={d}>{DAY_NAMES_AR[d]} فقط</option>)}
        </select>
      </Field>
      <Field name="number" id={`${prefix}-number`} label="الرقم">
        <input id={`${prefix}-number`} name="number" type="number" min={1} max={99} defaultValue={v?.number} className={inputCls} />
      </Field>
      <Field name="kind" id={`${prefix}-kind`} label="النوع">
        <select id={`${prefix}-kind`} name="kind" defaultValue={v?.kind ?? "LESSON"} className={inputCls}>
          {Object.entries(PERIOD_KIND_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field name="label" id={`${prefix}-label`} label="التسمية">
        <input id={`${prefix}-label`} name="label" defaultValue={v?.label ?? ""} className={inputCls} />
      </Field>
      <Field name="start" id={`${prefix}-start`} label="البداية">
        <input id={`${prefix}-start`} name="start" type="time" defaultValue={v ? minutesToHHMM(v.startMinute) : ""} className={inputCls} />
      </Field>
      <Field name="end" id={`${prefix}-end`} label="النهاية">
        <input id={`${prefix}-end`} name="end" type="time" defaultValue={v ? minutesToHHMM(v.endMinute) : ""} className={inputCls} />
      </Field>
    </div>
  );
}

export default async function PeriodsPage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const ctx = await requireUser();
  const db = getDb();
  const term = await getTermForDate(db, riyadhNow().date);
  if (!term) return <p>التاريخ الحالي خارج الفصول الدراسية المعرّفة.</p>;
  const stages = (await db.select().from(s.stages).orderBy(asc(s.stages.order))).filter((st) => can(ctx, "timetable.read", st.id));
  if (stages.length === 0) return <Denied />;
  const { stage } = await searchParams;
  const st = stages.find((x) => x.id === stage) ?? stages[0];
  let rows;
  try {
    rows = await listPeriods(db, ctx, term.id, st.id);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  const canWrite = can(ctx, "timetable.write", st.id);
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <BackLink href="/timetables" label="الجداول الدراسية" />
      <PageHeader title="أوقات الحصص" subtitle={`${term.name} — تُعدّ لكل مرحلة على حدة. تعريف «يوم محدد» يحل محل العام في ذلك اليوم (مثل الخميس). لا تُفترض أي أوقات.`} />
      <nav aria-label="المراحل" className="no-print flex flex-wrap gap-2">
        {stages.map((x) => <Link key={x.id} href={`/timetables/periods?stage=${x.id}`} aria-current={x.id === st.id ? "page" : undefined} className={`rounded-lg px-4 py-2 text-sm ${x.id === st.id ? "bg-brand-700 text-white" : "border border-brand-300 bg-white text-brand-800"}`}>{x.nameAr}</Link>)}
      </nav>
      {rows.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">أوقات الحصص غير مكتملة لـ{st.nameAr}. لن تظهر «الحصة الحالية» لطالباتها حتى تُعدّ.</p>}
      {rows.map((r) => (
        <Card key={r.id} className="space-y-2">
          <p className="text-sm font-semibold">{r.dayOfWeek === null ? "كل الأيام" : DAY_NAMES_AR[r.dayOfWeek]} · {PERIOD_KIND_AR[r.kind]} {r.number} <span dir="ltr">({minutesToHHMM(r.startMinute)}–{minutesToHHMM(r.endMinute)})</span></p>
          {canWrite && (
            <div className="space-y-2">
              <ActionForm action={updatePeriodAction.bind(null, r.id)} ariaLabel={`تعديل الفترة ${r.number}`}>
                <div key={r.version}>
                  <input type="hidden" name="version" value={r.version} />
                  <PeriodFields prefix={r.id.slice(0, 8)} v={r} />
                </div>
              </ActionForm>
              <ActionForm action={deletePeriodAction.bind(null, r.id)} submitLabel="حذف الفترة" confirmMessage="تأكيد حذف هذه الفترة؟" ariaLabel={`حذف الفترة ${r.number}`}>
                <span />
              </ActionForm>
            </div>
          )}
        </Card>
      ))}
      {canWrite && (
        <Card title="إضافة فترة">
          <ActionForm action={createPeriodAction} submitLabel="إضافة الفترة" ariaLabel="إضافة فترة">
            <input type="hidden" name="termId" value={term.id} />
            <input type="hidden" name="stageId" value={st.id} />
            <div key={rows.length}><PeriodFields prefix="new" /></div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
