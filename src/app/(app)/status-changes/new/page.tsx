import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/server/current-user";
import { activeYearEnrollment } from "@/server/services/affairs-common";
import { can } from "@/auth/rbac";
import { ENROLLMENT_STATUS_AR, STATUS_CHANGE_AR } from "@/domain/labels";
import { riyadhNow } from "@/domain/time";
import { ActionForm, Field } from "@/components/form";
import { BackLink, Card, Denied, inputCls, PageHeader } from "@/components/ui";
import { createStatusChangeAction } from "../actions";

export default async function NewStatusChangePage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const ctx = await requireUser();
  const { student } = await searchParams;
  if (!z.uuid().safeParse(student).success) notFound();
  const db = getDb();
  const [st] = await db.select().from(s.students).where(eq(s.students.id, student!));
  if (!st) notFound();
  let enr;
  try {
    enr = await activeYearEnrollment(db, st.id);
  } catch {
    return <Denied message="لا يوجد قيد للطالبة في السنة النشطة." />;
  }
  if (!can(ctx, "status_changes.write", enr.stageId)) return <Denied message="لا تملكين صلاحية تسجيل الانقطاع والنقل لهذه المرحلة." />;
  const types = enr.status === "ACTIVE" ? ["TRANSFER_OUT", "DROPOUT", "WITHDRAWAL"] : ["REINSTATEMENT"];
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink href={`/students/${st.id}`} label="ملف الطالبة" />
      <PageHeader title={`طلب إجراء: ${st.fullName}`} subtitle={`حالة القيد الحالية: ${ENROLLMENT_STATUS_AR[enr.status]}. لن تتغير إلا بعد الاعتماد.`} />
      <Card>
        <ActionForm action={createStatusChangeAction} submitLabel="حفظ الطلب" ariaLabel="طلب انقطاع أو نقل">
          <input type="hidden" name="studentId" value={st.id} />
          <div className="grid gap-3 md:grid-cols-2">
            <Field name="type" label="الإجراء">
              <select id="type" name="type" className={inputCls}>{types.map((t) => <option key={t} value={t}>{STATUS_CHANGE_AR[t]}</option>)}</select>
            </Field>
            <Field name="effectiveDate" label="تاريخ السريان"><input id="effectiveDate" type="date" name="effectiveDate" defaultValue={riyadhNow().date} className={inputCls} /></Field>
            <Field name="reference" label="المرجع الإداري (مطلوب للانقطاع)"><input id="reference" name="reference" className={inputCls} /></Field>
            <Field name="destinationSchool" label="المدرسة المنقول إليها (للنقل)"><input id="destinationSchool" name="destinationSchool" className={inputCls} /></Field>
            <Field name="notes" label="ملاحظات" className="md:col-span-2"><input id="notes" name="notes" className={inputCls} /></Field>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
