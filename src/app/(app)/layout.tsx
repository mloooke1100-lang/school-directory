import Link from "next/link";
import { requireUser } from "@/server/current-user";
import { getDb } from "@/db/client";
import { getSchool } from "@/server/school";
import { can } from "@/auth/rbac";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();
  const school = await getSchool(getDb());
  // تظهر فقط الوحدات المنفّذة فعلًا والمسموح بها للمستخدمة
  const nav = [
    { href: "/", label: "لوحة التحكم", show: true },
    { href: "/search", label: "البحث الشامل", show: can(ctx, "students.read") || can(ctx, "employees.read") },
    { href: "/students", label: "دليل الطالبات", show: can(ctx, "students.read") },
    { href: "/sections", label: "الفصول والشعب", show: can(ctx, "students.read") },
    { href: "/staff/teachers", label: "دليل المعلمات", show: can(ctx, "employees.read") },
    { href: "/staff/admin", label: "دليل الهيئة الإدارية", show: can(ctx, "employees.read") },
    { href: "/staff/service", label: "دليل المستخدمات والحراس", show: can(ctx, "employees.read") },
    { href: "/settings", label: "إعدادات المدرسة والقيادة", show: can(ctx, "settings.read") },
    { href: "/users", label: "الحسابات والصلاحيات", show: can(ctx, "users.manage") },
    { href: "/change-password", label: "تغيير كلمة المرور", show: true },
    { href: "/about", label: "عن النظام", show: true },
  ].filter((n) => n.show);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="no-print border-b border-brand-800 bg-brand-900 text-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:border-b-0">
        <div className="flex items-center justify-between gap-2 p-4 md:block">
          <div>
            <p className="text-sm font-bold leading-6">{school?.systemName}</p>
            <p className="hidden text-xs text-brand-100 md:block">{school?.tagline}</p>
          </div>
          <form action={logoutAction} className="md:hidden">
            <button className="rounded-md bg-brand-700 px-3 py-1.5 text-xs">خروج</button>
          </form>
        </div>
        <nav aria-label="القائمة الرئيسية" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:overflow-y-auto md:px-3">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm hover:bg-brand-800">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t border-brand-800 p-4 md:block">
          <p className="mb-2 text-xs text-brand-100">{ctx.displayName}</p>
          <form action={logoutAction}>
            <button className="w-full rounded-lg bg-brand-700 px-3 py-2 text-sm hover:bg-brand-600">تسجيل الخروج</button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 p-4 md:p-8">{children}</main>
        <footer className="no-print border-t border-gray-200 bg-white px-4 py-3 text-center text-xs text-gray-600">
          {school?.creditLine}
          {!school?.officialApproved && <span className="mx-2">· نظام داخلي غير معتمد رسميًا</span>}
        </footer>
      </div>
    </div>
  );
}
