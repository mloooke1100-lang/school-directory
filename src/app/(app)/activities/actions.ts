"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { runAction } from "@/server/run-action";
import { errorToState, formToObject, type FormState } from "@/server/forms";
import { createActivity, createSession, updateActivity, updateSession } from "@/server/services/activities";

export async function createActivityAction(_: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await createActivity(getDb(), ctx, formToObject(fd)), {}), ["/activities"]);
}
export async function updateActivityAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await updateActivity(getDb(), ctx, id, formToObject(fd)), {}), ["/activities"]);
}
export async function createSessionAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  let date: string;
  try {
    date = (await createSession(getDb(), ctx, formToObject(fd))).date;
  } catch (e) {
    return errorToState(e);
  }
  revalidatePath("/activities");
  revalidatePath("/");
  redirect(`/activities?from=${date}&to=${date}&saved=1`);
}
export async function updateSessionAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await updateSession(getDb(), ctx, id, formToObject(fd)), {}), ["/activities", "/"]);
}
