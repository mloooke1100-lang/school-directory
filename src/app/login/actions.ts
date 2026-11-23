"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { login, logout, SESSION_COOKIE } from "@/auth/session";

const schema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

export interface LoginState {
  error?: string;
}

export async function loginAction(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ username: form.get("username"), password: form.get("password") });
  if (!parsed.success) return { error: "أدخلي اسم المستخدم وكلمة المرور" };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const r = await login(getDb(), parsed.data.username, parsed.data.password, { ip, userAgent: h.get("user-agent") });
  if (!r.ok) {
    if (r.reason === "locked") return { error: "تم إيقاف الحساب مؤقتًا بسبب محاولات متكررة. حاولي بعد 15 دقيقة." };
    if (r.reason === "inactive") return { error: "هذا الحساب غير مفعّل." };
    return { error: "اسم المستخدم أو كلمة المرور غير صحيحة" };
  }
  (await cookies()).set(SESSION_COOKIE, r.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: r.expiresAt,
  });
  redirect("/");
}

export async function logoutAction() {
  const jar = await cookies();
  await logout(getDb(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
