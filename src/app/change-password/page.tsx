import Link from "next/link";
import { requireUser } from "@/server/current-user";
import { ActionForm, Field } from "@/components/form";
import { inputCls } from "@/components/ui";
import { logoutAction } from "../login/actions";
import { changePasswordAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const ctx = await requireUser({ allowPasswordChange: true });
  const forced = ctx.mustChangePassword;
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-gray-100 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="mb-1 text-xl font-bold text-brand-900">تغيير كلمة المرور</h1>
          <p className="mb-4 text-sm text-gray-700">
            {forced ? `مرحبًا ${ctx.displayName}. يجب تعيين كلمة مرور جديدة قبل استخدام النظام (أول دخول أو بعد إعادة التعيين).` : "ستبقى جلستك الحالية، وتُنهى جلساتك على الأجهزة الأخرى."}
          </p>
          <ActionForm action={changePasswordAction} submitLabel="حفظ كلمة المرور" ariaLabel="تغيير كلمة المرور">
            <Field name="currentPassword" label="كلمة المرور الحالية">
              <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" dir="ltr" className={`${inputCls} text-right`} />
            </Field>
            <Field name="newPassword" label="كلمة المرور الجديدة" hint="10 أحرف على الأقل وتشمل حروفًا وأرقامًا، ومختلفة عن الحالية.">
              <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" dir="ltr" className={`${inputCls} text-right`} />
            </Field>
            <Field name="confirmPassword" label="تأكيد كلمة المرور الجديدة">
              <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" dir="ltr" className={`${inputCls} text-right`} />
            </Field>
          </ActionForm>
        </div>
        <div className="flex justify-between text-sm">
          {!forced ? <Link href="/" className="text-brand-700 underline">العودة إلى لوحة التحكم</Link> : <span />}
          <form action={logoutAction}><button className="text-gray-700 underline">تسجيل الخروج</button></form>
        </div>
      </div>
    </main>
  );
}
