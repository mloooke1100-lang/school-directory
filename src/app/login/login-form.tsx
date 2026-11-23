"use client";
import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-medium text-gray-800">اسم المستخدم</label>
        <input id="username" name="username" autoComplete="username" required dir="ltr"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-right focus:border-brand-600 focus:outline-none" />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-800">كلمة المرور</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-right focus:border-brand-600 focus:outline-none" />
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>
      )}
      <button type="submit" disabled={pending}
        className="w-full rounded-lg bg-brand-700 px-4 py-2.5 font-semibold text-white hover:bg-brand-800 disabled:opacity-60">
        {pending ? "جارٍ التحقق…" : "تسجيل الدخول"}
      </button>
    </form>
  );
}
