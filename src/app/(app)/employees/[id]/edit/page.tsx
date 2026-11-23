import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { DIRECTORY_GROUPS, employeeFormOptions, getEmployeeRecord, groupOfCategory } from "@/server/services/employees";
import { ForbiddenError } from "@/auth/rbac";
import { ActionForm } from "@/components/form";
import { EmployeeFormFields } from "@/components/employee-form-fields";
import { BackLink, Card, Denied, PageHeader } from "@/components/ui";
import { updateEmployeeAction } from "../../actions";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  let rec;
  try {
    rec = await getEmployeeRecord(db, ctx, id);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  if (!rec) notFound();
  if (!rec.canWrite) return <Denied message="لا تملكين صلاحية تعديل بيانات الموظفات." />;
  const { stages } = await employeeFormOptions(db);
  const e = rec.employee;
  const g = groupOfCategory(e.category);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href={`/employees/${id}`} label="ملف الموظفة" />
      <PageHeader title={`تعديل: ${e.fullName}`} />
      <Card>
        <ActionForm action={updateEmployeeAction.bind(null, id)} ariaLabel="نموذج تعديل موظفة">
          <div key={e.version}>
            <input type="hidden" name="version" value={e.version} />
            <EmployeeFormFields
              v={e}
              categories={DIRECTORY_GROUPS[g].categories}
              stages={stages}
              stageIds={rec.assignments.filter((a) => a.isActive && a.position === "OTHER" && a.stageId).map((a) => a.stageId!)}
              sensitive={rec.sensitive}
              ministry={rec.ministry}
              school={rec.school}
            />
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
