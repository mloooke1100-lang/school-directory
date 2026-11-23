import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { getUserForEdit, userFormOptions } from "@/server/services/users";
import { employeesWithoutAccount } from "@/server/services/employees";
import { ForbiddenError } from "@/auth/rbac";
import { ActionForm, Field } from "@/components/form";
import { RoleFields } from "@/components/role-fields";
import { BackLink, Card, Denied, inputCls, PageHeader } from "@/components/ui";
import { resetPasswordAction, updateUserAction } from "../actions";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  let u;
  try {
    u = await getUserForEdit(db, ctx, id);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied message="إدارة الحسابات والصلاحيات متاحة للمديرة فقط." />;
    throw e;
  }
  if (!u) notFound();
  const [opts, employees] = await Promise.all([userFormOptions(db), employeesWithoutAccount(db, id)]);
  const self = id === ctx.userId;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/users" label="الحسابات والصلاحيات" />
      <PageHeader title={u.displayName} subtitle={<span dir="ltr">{u.username}</span>} />
      <Card title="بيانات الحساب والأدوار">
        <ActionForm action={updateUserAction.bind(null, id)} ariaLabel="تعديل الحساب">
          <div key={u.version} className="space-y-4">
            <input type="hidden" name="version" value={u.version} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field name="displayName" label="الاسم الظاهر"><input id="displayName" name="displayName" defaultValue={u.displayName} className={inputCls} /></Field>
              <Field name="employeeId" label="الموظفة المرتبطة">
                <select id="employeeId" name="employeeId" defaultValue={u.employeeId ?? ""} className={inputCls}>
                  <option value="">— بلا ربط —</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.jobTitle})</option>)}
                </select>
              </Field>
              <Field name="isActive" label="حالة الحساب" hint={self ? "لا يمكنك تعطيل حسابك الحالي." : "التعطيل يُنهي جلسات الحساب فورًا."}>
                <label className="flex items-center gap-2 py-2 text-sm"><input id="isActive" type="checkbox" name="isActive" defaultChecked={u.isActive} /> الحساب مفعّل</label>
              </Field>
            </div>
            <RoleFields roles={opts.roles} stages={opts.stages} current={u.roles} />
          </div>
        </ActionForm>
      </Card>
      {!self && (
        <Card title="إعادة تعيين كلمة المرور">
          <p className="mb-3 text-sm text-gray-700">تُولَّد كلمة مؤقتة جديدة، ويُفك الإيقاف المؤقت، وتُنهى كل جلسات الحساب، ويُفرض التغيير عند الدخول التالي.</p>
          <ActionForm action={resetPasswordAction.bind(null, id)} submitLabel="إعادة تعيين كلمة المرور" confirmMessage="تأكيد: إعادة تعيين كلمة مرور هذا الحساب وإنهاء جلساته؟" ariaLabel="إعادة تعيين كلمة المرور">
            <input type="hidden" name="version" value={u.version} key={u.version} />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
