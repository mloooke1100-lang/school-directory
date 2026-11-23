import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { DIRECTORY_GROUPS, employeeFormOptions, type DirectoryGroup } from "@/server/services/employees";
import { can } from "@/auth/rbac";
import { ActionForm } from "@/components/form";
import { EmployeeFormFields } from "@/components/employee-form-fields";
import { BackLink, Card, Denied, PageHeader } from "@/components/ui";
import { createEmployeeAction } from "../actions";

export default async function NewEmployeePage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const ctx = await requireUser();
  if (!can(ctx, "employees.write")) return <Denied message="لا تملكين صلاحية إضافة الموظفات." />;
  const { group } = await searchParams;
  const g: DirectoryGroup = group && group in DIRECTORY_GROUPS ? (group as DirectoryGroup) : "teachers";
  const { stages } = await employeeFormOptions(getDb());
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href={`/staff/${g}`} label={DIRECTORY_GROUPS[g].title} />
      <PageHeader title={`إضافة إلى ${DIRECTORY_GROUPS[g].title}`} subtitle="لا تُنشأ حسابات دخول تلقائيًا؛ الحسابات تُدار من شاشة الحسابات بواسطة المديرة." />
      <Card>
        <ActionForm action={createEmployeeAction} submitLabel="إضافة" ariaLabel="نموذج إضافة موظفة">
          <EmployeeFormFields categories={DIRECTORY_GROUPS[g].categories} stages={stages} stageIds={[]} sensitive={can(ctx, "employees.read_sensitive")} ministry={null} school={null} />
        </ActionForm>
      </Card>
    </div>
  );
}
