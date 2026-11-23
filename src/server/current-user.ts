import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { SESSION_COOKIE, validateSession } from "@/auth/session";
import { loadAuthContext, type AuthContext } from "@/auth/rbac";

/**
 * يعيد سياق المستخدمة الحالية أو يحوّل لصفحة الدخول — يُستدعى في كل صفحة وعملية خادم.
 * إذا كان الحساب يتطلب تغيير كلمة المرور (أول دخول أو بعد إعادة التعيين) يُحوَّل إلى شاشة التغيير
 * ولا يُسمح بأي صفحة أو عملية أخرى حتى يتم التغيير (يُطبَّق على الخادم وليس بإخفاء الروابط).
 */
export async function requireUser(opts: { allowPasswordChange?: boolean } = {}): Promise<AuthContext> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const db = getDb();
  const userId = await validateSession(db, token);
  if (!userId) redirect("/login");
  let ctx: AuthContext;
  try {
    ctx = await loadAuthContext(db, userId);
  } catch {
    redirect("/login");
  }
  if (ctx.mustChangePassword && !opts.allowPasswordChange) redirect("/change-password");
  return ctx;
}

export async function currentSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
