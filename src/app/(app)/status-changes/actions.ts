"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { runAndRedirect } from "@/server/run-action";
import { errorToState, formToObject, type FormState } from "@/server/forms";
import { createStatusChange, decideStatusChange } from "@/server/services/status-changes";

export async function createStatusChangeAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  try {
    await createStatusChange(getDb(), ctx, formToObject(fd));
  } catch (e) {
    return errorToState(e);
  }
  revalidatePath("/status-changes");
  redirect("/status-changes?saved=1");
}
export async function decideStatusChangeAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAndRedirect(() => decideStatusChange(getDb(), ctx, id, formToObject(fd)), fd, "/status-changes", fd.get("decision") === "REJECTED" ? "rejected" : "approved", ["/status-changes", "/students", "/"]);
}
