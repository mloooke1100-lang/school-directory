"use server";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { runAction, runAndRedirect } from "@/server/run-action";
import { formToObject, type FormState } from "@/server/forms";
import { approveEvent, cancelEvent, correctEvent, recordAbsences, recordLate } from "@/server/services/attendance";

const P = ["/attendance", "/", "/students"];
export async function recordAbsencesAction(_: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => {
    const r = await recordAbsences(getDb(), ctx, formToObject(fd));
    return { message: `تم الحفظ: ${r.created} غياب جديد${r.skipped ? ` (تُخطّيت ${r.skipped} مسجّلة مسبقًا)` : ""}` };
  }, P);
}
export async function recordLateAction(_: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await recordLate(getDb(), ctx, formToObject(fd)), {}), P);
}
export async function correctEventAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAndRedirect(() => correctEvent(getDb(), ctx, id, formToObject(fd)), fd, "/attendance", "corrected", P);
}
export async function cancelEventAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAndRedirect(() => cancelEvent(getDb(), ctx, id, formToObject(fd)), fd, "/attendance", "cancelled", P);
}
export async function approveEventAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAndRedirect(() => approveEvent(getDb(), ctx, id, formToObject(fd)), fd, "/attendance", "approved", P);
}
