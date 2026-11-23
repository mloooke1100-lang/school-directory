"use server";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { runAction } from "@/server/run-action";
import { formToObject, type FormState } from "@/server/forms";
import { createArea, createAssignment, createFloor, updateArea, updateAssignment } from "@/server/services/supervision";

const P = ["/supervision", "/supervision/areas", "/"];
export async function createAssignmentAction(_: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await createAssignment(getDb(), ctx, formToObject(fd)), {}), P);
}
export async function updateAssignmentAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await updateAssignment(getDb(), ctx, id, formToObject(fd)), {}), P);
}
export async function createFloorAction(_: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await createFloor(getDb(), ctx, formToObject(fd)), {}), P);
}
export async function createAreaAction(_: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await createArea(getDb(), ctx, formToObject(fd)), {}), P);
}
export async function updateAreaAction(id: string, _: FormState, fd: FormData) {
  const ctx = await requireUser();
  return runAction(async () => (await updateArea(getDb(), ctx, id, formToObject(fd)), {}), P);
}
