"use client";
/**
 * نموذج موحّد مرتبط بعملية خادم. رسالة «تم الحفظ» تظهر فقط عندما يُرجع الخادم ok=true
 * (أي بعد نجاح المعاملة فعليًا)، والأخطاء تظهر برسالة واضحة وعلى الحقل المعني.
 */
import { createContext, startTransition, useActionState, useContext, type ReactNode } from "react";
import type { FormState } from "@/server/forms";

const Ctx = createContext<FormState>({});

export function ActionForm({
  action,
  children,
  submitLabel = "حفظ",
  confirmMessage,
  className = "space-y-4",
  ariaLabel,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel?: string;
  confirmMessage?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <Ctx.Provider value={state}>
      {/* الإرسال يدويًا بدل خاصية action: React 19 يمسح حقول النموذج بعد كل إرسال عبر action،
          فتضيع مدخلات المستخدمة عند ظهور خطأ تحقق. بعد النجاح تُعاد تهيئة الحقول بمفتاح الإصدار من الخادم. */}
      <form
        className={className}
        aria-label={ariaLabel}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          if (confirmMessage && !window.confirm(confirmMessage)) return;
          const fd = new FormData(e.currentTarget);
          startTransition(() => formAction(fd));
        }}
      >
        {children}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="submit" disabled={pending} className="rounded-lg bg-brand-700 px-5 py-2.5 font-semibold text-white hover:bg-brand-800 disabled:opacity-60">
            {pending ? "جارٍ الحفظ…" : submitLabel}
          </button>
          {state.ok && state.message && (
            <p role="status" className="rounded-lg bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800">
              {state.message}
            </p>
          )}
        </div>
        {state.error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.error}
          </p>
        )}
        {state.ok && state.secret && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">كلمة المرور المؤقتة (تظهر مرة واحدة فقط — سلّميها لصاحبة الحساب بطريقة آمنة):</p>
            <p dir="ltr" className="mt-1 select-all text-right font-mono text-base" data-testid="temp-password">
              {state.secret}
            </p>
            <p className="mt-1 text-xs">سيُطلب منها تغييرها عند أول دخول.</p>
          </div>
        )}
      </form>
    </Ctx.Provider>
  );
}

/** حقل بعنوان ورسالة خطأ من الخادم */
export function Field({ name, id, label, hint, children, className = "" }: { name: string; id?: string; label: string; hint?: string; children: ReactNode; className?: string }) {
  const st = useContext(Ctx);
  const err = st.fieldErrors?.[name];
  return (
    <div className={className}>
      <label htmlFor={id ?? name} className="mb-1 block text-sm font-medium text-gray-800">
        {label}
      </label>
      {children}
      {hint && !err && <p className="mt-1 text-xs text-gray-600">{hint}</p>}
      {err && <p className="mt-1 text-xs font-medium text-red-700">{err}</p>}
    </div>
  );
}
