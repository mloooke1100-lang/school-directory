"use server";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { runAction, runAndRedirect } from "@/server/run-action";
import { formToObject, type FormState } from "@/server/forms";
import { cancelLeave, createLeave, decideLeave, recordLeaveExit } from "@/server/services/leaves";

const P = ["/leaves", "/", "/students"];
export async function createLeaveAction(_: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await createLeave(getDb(), ctx, formToObject(fd)), {}), P);
}
export async function decideLeaveAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAndRedirect(() => decideLeave(getDb(), ctx, id, formToObject(fd)), fd, "/leaves", fd.get("decision") === "REJECTED" ? "rejected" : "approved", P);
}
export async function leaveExitAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAndRedirect(() => recordLeaveExit(getDb(), ctx, id, formToObject(fd)), fd, "/leaves", "exit", P);
}
export async function cancelLeaveAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAndRedirect(() => cancelLeave(getDb(), ctx, id, formToObject(fd)), fd, "/leaves", "cancelled", P);
}
