import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/server/current-user";
import { listActivities } from "@/server/services/activities";
import { getActiveYear } from "@/server/school";
import { stageFilter } from "@/server/scope-sql";
import { can, stageScope } from "@/auth/rbac";
import { riyadhNow } from "@/domain/time";
import { ActionForm, Field } from "@/components/form";
import { BackLink, Card, Denied, inputCls, PageHeader } from "@/components/ui";
import { createSessionAction } from "../../actions";

export default async function NewSessionPage() {
  const ctx = await requireUser();
  if (!can(ctx, "activities.write")) return <Denied message="لا تملكين صلاحية إدارة الأنشطة." />;
  const db = getDb();
  const year = await getActiveYear(db);
  const [activities, employees, rooms, sections] = await Promise.all([
    listActivities(db, ctx),
    db.select({ id: s.employees.id, fullName: s.employees.fullName, jobTitle: s.employees.jobTitle }).from(s.employees).where(eq(s.employees.status, "ACTIVE")).orderBy(asc(s.employees.fullName)),
    db.select().from(s.rooms).where(eq(s.rooms.isActive, true)).orderBy(asc(s.rooms.name)),
    year
      ? db.select({ id: s.classSections.id, name: s.classSections.name, grade: s.grades.nameAr, stage: s.stages.nameAr }).from(s.classSections).innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId)).innerJoin(s.stages, eq(s.stages.id, s.grades.stageId)).where(and(eq(s.classSections.yearId, year.id), eq(s.classSections.isActive, true), stageFilter(stageScope(ctx, "activities.write"), s.stages.id))).orderBy(asc(s.stages.order), asc(s.grades.order))
      : [],
  ]);
  const usable = activities.filter((a) => a.isActive && a.canWrite);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/activities" label="حصص النشاط" />
      <PageHeader title="إضافة جلسة نشاط" subtitle="يُرفض الحفظ إن كانت المشرفة أو القاعة أو الفصل مشغولين في الوقت نفسه." />
      <Card>
        <ActionForm action={createSessionAction} submitLabel="حفظ الجلسة" ariaLabel="إضافة جلسة نشاط">
          <div className="grid gap-3 md:grid-cols-2">
            <Field name="activityId" label="النشاط">
              <select id="activityId" name="activityId" className={inputCls}>{usable.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.stageName ?? "كل المراحل"})</option>)}</select>
            </Field>
            <Field name="date" label="التاريخ"><input id="date" type="date" name="date" defaultValue={riyadhNow().date} className={inputCls} /></Field>
            <Field name="start" label="وقت البداية"><input id="start" type="time" name="start" className={inputCls} /></Field>
            <Field name="end" label="وقت النهاية"><input id="end" type="time" name="end" className={inputCls} /></Field>
            <Field name="sectionId" label="الفصل">
              <select id="sectionId" name="sectionId" className={inputCls}>
                <option value="">— مجموعة بدل فصل —</option>
                {sections.map((x) => <option key={x.id} value={x.id}>{x.stage} · {x.grade} / {x.name}</option>)}
              </select>
            </Field>
            <Field name="groupName" label="أو اسم المجموعة"><input id="groupName" name="groupName" className={inputCls} /></Field>
            <Field name="supervisorId" label="المشرفة">
              <select id="supervisorId" name="supervisorId" defaultValue="" className={inputCls}>
                <option value="">— اختاري —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.jobTitle})</option>)}
              </select>
            </Field>
            <Field name="roomId" label="القاعة">
              <select id="roomId" name="roomId" className={inputCls}>
                <option value="">—</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field name="location" label="الموقع (إن لم يكن قاعة)"><input id="location" name="location" className={inputCls} /></Field>
            <Field name="notes" label="ملاحظات"><input id="notes" name="notes" className={inputCls} /></Field>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
