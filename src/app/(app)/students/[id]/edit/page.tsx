import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { enrollmentOptions, getStudentRecord } from "@/server/services/students";
import { can, ForbiddenError } from "@/auth/rbac";
import { ENROLLMENT_STATUS_AR, YEAR_STATUS_AR } from "@/domain/labels";
import { riyadhNow } from "@/domain/time";
import { ActionForm, Field } from "@/components/form";
import { YearSectionFields } from "@/components/student-fields";
import { BackLink, Card, Denied, inputCls, PageHeader } from "@/components/ui";
import { addEnrollmentAction, updateEnrollmentAction, updateStudentAction } from "../../actions";
import { StudentBasicFields } from "../../student-basic-fields";

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  let rec;
  try {
    rec = await getStudentRecord(db, ctx, id);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  if (!rec) notFound();
  if (!rec.canWrite) return <Denied message="لا تملكين صلاحية تعديل بيانات هذه الطالبة." />;
  const opts = await enrollmentOptions(db, ctx);
  const st = rec.student;
  const enrolledYears = new Set(rec.enrollments.map((e) => e.yearId));
  const freeYears = opts.years.filter((y) => !enrolledYears.has(y.id));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href={`/students/${id}`} label="ملف الطالبة" />
      <PageHeader title={`تعديل: ${st.fullName}`} subtitle={`المعرّف الداخلي: ${st.id.slice(0, 8)}`} />
      <Card title="البيانات الأساسية">
        <ActionForm action={updateStudentAction.bind(null, id)} ariaLabel="البيانات الأساسية">
          <div key={st.version} className="space-y-4">
            <input type="hidden" name="version" value={st.version} />
            <StudentBasicFields v={st} />
          </div>
        </ActionForm>
      </Card>

      {rec.enrollments.map((e) => {
        const editable = e.yearStatus !== "ARCHIVED" && can(ctx, "students.write", e.stageId);
        const workflow = ["TRANSFERRED_OUT", "DROPPED_OUT", "WITHDRAWN"].includes(e.status);
        return (
          <Card key={e.id} title={`القيد — ${e.yearName} (${YEAR_STATUS_AR[e.yearStatus]})`}>
            {!editable ? (
              <p className="text-sm text-gray-700">{e.stageName} · {e.gradeName} / {e.sectionName} · {ENROLLMENT_STATUS_AR[e.status]} — {e.yearStatus === "ARCHIVED" ? "سنة مؤرشفة للعرض فقط." : "لا تملكين صلاحية تعديل هذا القيد."}</p>
            ) : (
              <ActionForm action={updateEnrollmentAction.bind(null, id, e.id)} ariaLabel={`قيد ${e.yearName}`}>
                <div key={e.version} className="grid gap-4 md:grid-cols-2">
                  <input type="hidden" name="version" value={e.version} />
                  <YearSectionFields years={[{ id: e.yearId, name: e.yearName }]} sections={opts.sections} defaultYearId={e.yearId} defaultSectionId={e.sectionId} lockYear idPrefix={`e${e.id.slice(0, 8)}-`} />
                  <Field name="enrolledAt" id={`e${e.id.slice(0, 8)}-enrolledAt`} label="تاريخ القيد">
                    <input id={`e${e.id.slice(0, 8)}-enrolledAt`} name="enrolledAt" type="date" defaultValue={e.enrolledAt} className={inputCls} />
                  </Field>
                  <Field name="status" id={`e${e.id.slice(0, 8)}-status`} label="حالة القيد" hint={workflow ? "هذه الحالة سُجّلت عبر إجراء معتمد ولا تُغيَّر من هنا." : "النقل والانقطاع والانسحاب تُسجَّل عبر إجراءات شؤون الطالبات المعتمدة."}>
                    <select id={`e${e.id.slice(0, 8)}-status`} name="status" defaultValue={e.status} className={inputCls}>
                      {(workflow ? [e.status] : ["ACTIVE", "PROMOTED", "GRADUATED"]).map((k) => <option key={k} value={k}>{ENROLLMENT_STATUS_AR[k]}</option>)}
                    </select>
                  </Field>
                </div>
              </ActionForm>
            )}
          </Card>
        );
      })}

      {freeYears.length > 0 && (
        <Card title="إضافة قيد لسنة دراسية أخرى">
          <ActionForm action={addEnrollmentAction.bind(null, id)} submitLabel="إضافة القيد" ariaLabel="إضافة قيد">
            <div key={rec.enrollments.length} className="grid gap-4 md:grid-cols-2">
              <YearSectionFields years={freeYears} sections={opts.sections} idPrefix="new-" />
              <Field name="enrolledAt" id="enrolledAt-new" label="تاريخ القيد">
                <input id="enrolledAt-new" name="enrolledAt" type="date" defaultValue={riyadhNow().date} className={inputCls} />
              </Field>
              <input type="hidden" name="status" value="ACTIVE" />
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
