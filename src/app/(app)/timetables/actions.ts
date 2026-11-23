"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { runAction } from "@/server/run-action";
import { errorToState, formToObject, type FormState } from "@/server/forms";
import { createRoom, createSubject } from "@/server/services/catalog";
import { addEntry, approveTimetable, copyToDraft, createPeriod, createTimetable, deleteEntry, deletePeriod, updatePeriod } from "@/server/services/timetables";

const P = ["/timetables", "/timetables/periods"];

export async function createPeriodAction(_: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await createPeriod(getDb(), ctx, formToObject(fd)), {}), P);
}
export async function updatePeriodAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await updatePeriod(getDb(), ctx, id, formToObject(fd)), {}), P);
}
export async function deletePeriodAction(id: string, _: FormState) {
  const ctx = await requireUser();
  return runAction(async () => (await deletePeriod(getDb(), ctx, id), { message: "تم الحذف" }), P);
}
export async function createTimetableAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  let id: string;
  try {
    id = (await createTimetable(getDb(), ctx, formToObject(fd))).id;
  } catch (e) {
    return errorToState(e);
  }
  revalidatePath("/timetables");
  redirect(`/timetables/${id}`);
}
export async function copyTimetableAction(id: string, _: FormState): Promise<FormState> {
  const ctx = await requireUser();
  let newId: string;
  try {
    newId = (await copyToDraft(getDb(), ctx, id)).id;
  } catch (e) {
    return errorToState(e);
  }
  revalidatePath("/timetables");
  redirect(`/timetables/${newId}`);
}
export async function approveTimetableAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  try {
    await approveTimetable(getDb(), ctx, id, formToObject(fd));
  } catch (e) {
    return errorToState(e);
  }
  revalidatePath("/timetables");
  revalidatePath("/sections", "layout");
  redirect(`/timetables/${id}?approved=1`); // نموذج الاعتماد يختفي بعد الاعتماد، فتُعرض الرسالة في الصفحة
}
export async function addEntryAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await addEntry(getDb(), ctx, id, formToObject(fd)), {}), [`/timetables/${id}`]);
}
export async function deleteEntryAction(timetableId: string, entryId: string, _: FormState) {
  const ctx = await requireUser();
  return runAction(async () => (await deleteEntry(getDb(), ctx, entryId), { message: "تم الحذف" }), [`/timetables/${timetableId}`]);
}

export async function createSubjectAction(_: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await createSubject(getDb(), ctx, formToObject(fd)), {}), ["/timetables/catalog"]);
}
export async function createRoomAction(_: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await createRoom(getDb(), ctx, formToObject(fd)), {}), ["/timetables/catalog"]);
}
