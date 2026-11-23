"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { currentSessionToken, requireUser } from "@/server/current-user";
import { errorToState, formToObject, type FormState } from "@/server/forms";
import { changeOwnPassword } from "@/server/services/users";

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser({ allowPasswordChange: true });
  try {
    await changeOwnPassword(getDb(), ctx.userId, await currentSessionToken(), formToObject(fd));
  } catch (e) {
    return errorToState(e);
  }
  redirect("/?password=changed");
}
