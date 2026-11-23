"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { runAction } from "@/server/run-action";
import { errorToState, formToObject, type FormState } from "@/server/forms";
import { createSubstitute, updateSubstitute } from "@/server/services/substitutes";

export async function createSubstituteAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  let date: string;
  try {
    date = (await createSubstitute(getDb(), ctx, formToObject(fd))).date;
  } catch (e) {
    return errorToState(e);
  }
  revalidatePath("/substitutes");
  revalidatePath("/");
  redirect(`/substitutes?date=${date}&saved=1`);
}
export async function updateSubstituteAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await updateSubstitute(getDb(), ctx, id, formToObject(fd)), {}), ["/substitutes", "/"]);
}
