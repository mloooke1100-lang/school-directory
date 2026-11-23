import Link from "next/link";
import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/server/current-user";
import { listActivities, listSessions } from "@/server/services/activities";
import { can, ForbiddenError } from "@/auth/rbac";
import { ASSIGNMENT_STATUS_AR } from "@/domain/labels";
import { DAY_NAMES_AR, minutesToHHMM, riyadhNow } from "@/domain/time";
import { dayOfWeekOf } from "@/domain/schedule";
import { ActionForm, Field } from "@/components/form";
import { btnPrimary, Card, Denied, inputCls, PageHeader, SavedNotice, Table } from "@/components/ui";
import { createActivityAction, updateActivityAction, updateSessionAction } from "./actions";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; saved?: string }> }) {
  const ctx = await requireUser();
  const sp = await searchParams;
  const today = riyadhNow().date;
  const from = ISO.test(sp.from ?? "") ? sp.from! : today;
  const to = ISO.test(sp.to ?? "") ? sp.to! : new Date(new Date(`${from}T12:00:00Z`).getTime() + 6 * 86400_000).toISOString().slice(0, 10);
  const db = getDb();
  let activities, sessions;
  try {
    [activities, sessions] = await Promise.all([listActivities(db, ctx), listSessions(db, ctx, from, to)]);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  const stages = (await db.select().from(s.stages).orderBy(asc(s.stages.order))).filter((st) => can(ctx, "activities.write", st.id));
  const canWrite = can(ctx, "activities.write");
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <SavedNotice show={sp.saved === "1"} />
      <PageHeader title="حصص النشاط" subtitle="النشاط والفصل أو المجموعة والمشرفة والتاريخ والوقت والموقع والحالة." actions={canWrite && activities.some((a) => a.isActive) && <Link href="/activities/sessions/new" className={btnPrimary}>إضافة جلسة نشاط</Link>} />
      <form className="no-print flex flex-wrap items-end gap-2" aria-label="الفترة">
        <div><label htmlFor="from" className="mb-1 block text-sm">من</label><input id="from" type="date" name="from" defaultValue={from} className={inputCls} /></div>
        <div><label htmlFor="to" className="mb-1 block text-sm">إلى</label><input id="to" type="date" name="to" defaultValue={to} className={inputCls} /></div>
        <button className="rounded-lg bg-brand-700 px-5 py-2 font-semibold text-white">عرض</button>
      </form>
      {sessions.length === 0 ? <p className="text-gray-700">لا توجد جلسات نشاط في هذه الفترة.</p> : (
        <Table head={["التاريخ", "الوقت", "النشاط", "الفصل / المجموعة", "المشرفة", "الموقع", "الحالة"]}>
          {sessions.map((x) => (
            <tr key={x.id} className={x.status === "CANCELLED" ? "text-gray-500" : ""}>
              <td className="p-2">{DAY_NAMES_AR[dayOfWeekOf(x.date)]} <span dir="ltr">{x.date}</span></td>
              <td className="p-2" dir="ltr">{minutesToHHMM(x.startMinute)}–{minutesToHHMM(x.endMinute)}</td>
              <td className="p-2 font-medium">{x.name}</td>
              <td className="p-2">{x.section ?? x.groupName ?? "—"}</td>
              <td className="p-2">{x.supervisor}</td>
              <td className="p-2">{[x.room, x.location].filter(Boolean).join(" · ") || "—"}</td>
              <td className="p-2">
                {x.canWrite ? (
                  <ActionForm action={updateSessionAction.bind(null, x.id)} ariaLabel={`حالة جلسة ${x.name}`} className="flex flex-wrap items-center gap-2">
                    <div key={x.version}>
                      <input type="hidden" name="version" value={x.version} />
                      <input type="hidden" name="notes" value={x.notes ?? ""} />
                      <select name="status" defaultValue={x.status} aria-label="الحالة" className="rounded border border-gray-300 px-2 py-1">
                        {Object.entries(ASSIGNMENT_STATUS_AR).filter(([k]) => x.status !== "CANCELLED" || k === "CANCELLED").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </div>
                  </ActionForm>
                ) : ASSIGNMENT_STATUS_AR[x.status]}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <section aria-labelledby="acts" className="space-y-3">
        <h2 id="acts" className="font-semibold">الأنشطة المعرّفة</h2>
        {activities.length === 0 && <p className="text-sm text-gray-700">لا توجد أنشطة معرّفة بعد.</p>}
        {activities.map((a) => (
          <Card key={a.id}>
            {a.canWrite ? (
              <ActionForm action={updateActivityAction.bind(null, a.id)} ariaLabel={`نشاط ${a.name}`}>
                <div key={a.version} className="grid gap-3 md:grid-cols-4">
                  <input type="hidden" name="version" value={a.version} />
                  <input type="hidden" name="stageId" value={a.stageId ?? ""} />
                  <Field name="name" id={`${a.id}-name`} label={`اسم النشاط (${a.stageName ?? "كل المراحل"})`}><input id={`${a.id}-name`} name="name" defaultValue={a.name} className={inputCls} /></Field>
                  <Field name="description" id={`${a.id}-desc`} label="الوصف" className="md:col-span-2"><input id={`${a.id}-desc`} name="description" defaultValue={a.description ?? ""} className={inputCls} /></Field>
                  <Field name="isActive" id={`${a.id}-active`} label="الحالة"><label className="flex items-center gap-2 py-2 text-sm"><input id={`${a.id}-active`} type="checkbox" name="isActive" defaultChecked={a.isActive} /> نشط</label></Field>
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm"><strong>{a.name}</strong> · {a.stageName ?? "كل المراحل"} · {a.isActive ? "نشط" : "متوقف"}{a.description && ` · ${a.description}`}</p>
            )}
          </Card>
        ))}
        {stages.length > 0 && (
          <Card title="إضافة نشاط">
            <ActionForm action={createActivityAction} submitLabel="إضافة النشاط" ariaLabel="إضافة نشاط">
              <div key={activities.length} className="grid gap-3 md:grid-cols-3">
                <Field name="name" id="new-act-name" label="اسم النشاط"><input id="new-act-name" name="name" className={inputCls} /></Field>
                <Field name="stageId" id="new-act-stage" label="المرحلة">
                  <select id="new-act-stage" name="stageId" className={inputCls}>
                    {can(ctx, "activities.write", null) && <option value="">كل المراحل</option>}
                    {stages.map((st) => <option key={st.id} value={st.id}>{st.nameAr}</option>)}
                  </select>
                </Field>
                <Field name="description" id="new-act-desc" label="الوصف"><input id="new-act-desc" name="description" className={inputCls} /></Field>
              </div>
            </ActionForm>
          </Card>
        )}
      </section>
    </div>
  );
}
