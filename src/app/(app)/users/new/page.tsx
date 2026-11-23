import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { userFormOptions } from "@/server/services/users";
import { employeesWithoutAccount } from "@/server/services/employees";
import { can } from "@/auth/rbac";
import { ActionForm, Field } from "@/components/form";
import { RoleFields } from "@/components/role-fields";
import { BackLink, Card, Denied, inputCls, PageHeader } from "@/components/ui";
import { createUserAction } from "../actions";

export default async function NewUserPage() {
  const ctx = await requireUser();
  if (!can(ctx, "users.manage")) return <Denied message="إدارة الحسابات والصلاحيات متاحة للمديرة فقط." />;
  const db = getDb();
  const [opts, employees] = await Promise.all([userFormOptions(db), employeesWithoutAccount(db)]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/users" label="الحسابات والصلاحيات" />
      <PageHeader title="إنشاء حساب دخول" subtitle="تُولَّد كلمة مرور مؤقتة تظهر مرة واحدة بعد الحفظ." />
      <Card>
        <ActionForm action={createUserAction} submitLabel="إنشاء الحساب" ariaLabel="نموذج إنشاء حساب">
          <div className="grid gap-4 md:grid-cols-2">
            <Field name="username" label="اسم المستخدم (لاتيني)" hint="3–32 حرفًا: a-z و0-9 و . _ -">
              <input id="username" name="username" dir="ltr" autoComplete="off" maxLength={32} className={`${inputCls} text-right`} />
            </Field>
            <Field name="displayName" label="الاسم الظاهر">
              <input id="displayName" name="displayName" maxLength={100} className={inputCls} />
            </Field>
            <Field name="employeeId" label="ربط بسجل موظفة (اختياري)" className="md:col-span-2">
              <select id="employeeId" name="employeeId" defaultValue="" className={inputCls}>
                <option value="">— بلا ربط —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.jobTitle})</option>)}
              </select>
            </Field>
          </div>
          <RoleFields roles={opts.roles} stages={opts.stages} />
        </ActionForm>
      </Card>
    </div>
  );
}
