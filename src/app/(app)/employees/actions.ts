"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { runAction } from "@/server/run-action";
import { errorToState, formToObject, type FormState } from "@/server/forms";
import { createEmployee, updateEmployee } from "@/server/services/employees";

export async function createEmployeeAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  let id: string;
  try {
    id = (await createEmployee(getDb(), ctx, formToObject(fd))).id;
  } catch (e) {
    return errorToState(e);
  }
  revalidatePath("/staff", "layout");
  redirect(`/employees/${id}?saved=1`);
}

export async function updateEmployeeAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  return runAction(async () => {
    await updateEmployee(getDb(), ctx, id, formToObject(fd));
    return {};
  }, [`/employees/${id}`, "/staff/teachers", "/staff/admin", "/staff/service"]);
}
