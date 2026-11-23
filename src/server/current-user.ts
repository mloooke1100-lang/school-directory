import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { SESSION_COOKIE, validateSession } from "@/auth/session";
import { loadAuthContext, type AuthContext } from "@/auth/rbac";

/** يعيد سياق المستخدمة الحالية أو يحوّل لصفحة الدخول — يُستدعى في كل صفحة وعملية خادم */
export async function requireUser(): Promise<AuthContext> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const db = getDb();
  const userId = await validateSession(db, token);
  if (!userId) redirect("/login");
  try {
    return await loadAuthContext(db, userId);
  } catch {
    redirect("/login");
  }
}
