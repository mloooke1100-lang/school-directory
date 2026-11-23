"use server";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { runAction } from "@/server/run-action";
import { formToObject, type FormState } from "@/server/forms";
import { createUser, resetUserPassword, updateUser } from "@/server/services/users";

export async function createUserAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  return runAction(async () => {
    const r = await createUser(getDb(), ctx, formToObject(fd));
    return { message: `تم إنشاء الحساب «${r.user.username}»`, secret: r.tempPassword };
  }, ["/users"]);
}

export async function updateUserAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  return runAction(async () => {
    await updateUser(getDb(), ctx, id, formToObject(fd));
    return {};
  }, ["/users", `/users/${id}`]);
}

export async function resetPasswordAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  return runAction(async () => {
    const r = await resetUserPassword(getDb(), ctx, id, formToObject(fd));
    return { message: "تمت إعادة تعيين كلمة المرور وإنهاء جلسات الحساب", secret: r.tempPassword };
  }, ["/users", `/users/${id}`]);
}
