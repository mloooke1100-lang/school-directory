import Link from "next/link";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { listUsers, rolesWithPermissions } from "@/server/services/users";
import { ForbiddenError } from "@/auth/rbac";
import { PERMISSIONS, type Permission } from "@/auth/permissions";
import { btnPrimary, Denied, PageHeader, Table } from "@/components/ui";

export default async function UsersPage() {
  const ctx = await requireUser();
  const db = getDb();
  let users, roles;
  try {
    [users, roles] = await Promise.all([listUsers(db, ctx), rolesWithPermissions(db, ctx)]);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied message="إدارة الحسابات والصلاحيات متاحة للمديرة فقط." />;
    throw e;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="الحسابات والصلاحيات" subtitle="لا تُنشأ حسابات تلقائيًا للموظفات. كل حساب يُنشأ صراحة ويُفرض تغيير كلمة مروره عند أول دخول." actions={<Link href="/users/new" className={btnPrimary}>إنشاء حساب</Link>} />
      <Table head={["اسم المستخدم", "الاسم الظاهر", "الموظفة المرتبطة", "الأدوار", "الحالة", "آخر دخول"]}>
        {users.map((u) => (
          <tr key={u.id}>
            <td className="p-3" dir="ltr"><Link href={`/users/${u.id}`} className="font-medium text-brand-700 hover:underline">{u.username}</Link></td>
            <td className="p-3">{u.displayName}</td>
            <td className="p-3">{u.employeeName ?? "—"}</td>
            <td className="p-3">{u.roles.join("، ") || "—"}</td>
            <td className="p-3">
              {u.isActive ? "مفعّل" : <span className="text-red-700">معطّل</span>}
              {u.mustChangePassword && <span className="mr-1 rounded bg-amber-100 px-1.5 text-xs text-amber-900">يلزم تغيير كلمة المرور</span>}
              {u.lockedUntil && u.lockedUntil > new Date() && <span className="mr-1 rounded bg-red-50 px-1.5 text-xs text-red-800">موقوف مؤقتًا</span>}
            </td>
            <td className="p-3 text-gray-600">{u.lastLoginAt?.toLocaleString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh" }) ?? "—"}</td>
          </tr>
        ))}
      </Table>
      <section aria-labelledby="matrix">
        <h2 id="matrix" className="mb-2 font-semibold">مصفوفة صلاحيات الأدوار</h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-brand-50 text-brand-900"><tr><th className="p-2 text-right">الصلاحية</th>{roles.map((r) => <th key={r.id} className="p-2">{r.nameAr}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {(Object.keys(PERMISSIONS) as Permission[]).map((p) => (
                <tr key={p}>
                  <td className="p-2">{PERMISSIONS[p]}</td>
                  {roles.map((r) => <td key={r.id} className="p-2 text-center">{r.permissions.includes(p) ? "✓" : ""}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-600">صلاحيات الأدوار النظامية الأربعة معرّفة في البرنامج ومراجَعة؛ تعديلها أو إضافة أدوار مخصصة مُدرج في القضايا المفتوحة.</p>
      </section>
    </div>
  );
}
