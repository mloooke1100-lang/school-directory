import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { enrollmentOptions } from "@/server/services/students";
import { can } from "@/auth/rbac";
import { riyadhNow } from "@/domain/time";
import { ActionForm, Field } from "@/components/form";
import { YearSectionFields } from "@/components/student-fields";
import { BackLink, Card, Denied, inputCls, PageHeader } from "@/components/ui";
import { createStudentAction } from "../actions";
import { StudentBasicFields } from "../student-basic-fields";

export default async function NewStudentPage() {
  const ctx = await requireUser();
  if (!can(ctx, "students.write")) return <Denied message="لا تملكين صلاحية إضافة الطالبات." />;
  const opts = await enrollmentOptions(getDb(), ctx);
  const active = opts.years.find((y) => y.status === "ACTIVE");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/students" label="دليل الطالبات" />
      <PageHeader title="إضافة طالبة" subtitle="تُضاف الطالبة بمعرّف داخلي ثابت، ويُنشأ قيدها في السنة والفصل المختارين." />
      <Card>
        <ActionForm action={createStudentAction} submitLabel="إضافة الطالبة" ariaLabel="نموذج إضافة طالبة">
          <StudentBasicFields />
          <fieldset className="grid gap-4 rounded-lg border border-gray-200 p-4 md:grid-cols-2">
            <legend className="px-1 text-sm font-semibold text-brand-900">القيد الدراسي</legend>
            <YearSectionFields years={opts.years} sections={opts.sections} defaultYearId={active?.id} />
            <Field name="enrolledAt" label="تاريخ القيد (ميلادي)">
              <input id="enrolledAt" name="enrolledAt" type="date" defaultValue={riyadhNow().date} className={inputCls} />
            </Field>
            <Field name="status" label="حالة القيد">
              <select id="status" name="status" defaultValue="ACTIVE" className={inputCls}>
                <option value="ACTIVE">منتظمة</option>
                <option value="PROMOTED">منقولة للصف التالي</option>
                <option value="GRADUATED">متخرجة</option>
              </select>
            </Field>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirmDuplicate" /> تأكيد الإضافة رغم تشابه الاسم مع طالبة في الفصل نفسه
          </label>
        </ActionForm>
      </Card>
    </div>
  );
}
