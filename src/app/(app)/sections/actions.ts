"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { runAction } from "@/server/run-action";
import { errorToState, formToObject, type FormState } from "@/server/forms";
import { createSection, updateSection } from "@/server/services/sections";

export async function createSectionAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  let id: string;
  try {
    id = (await createSection(getDb(), ctx, formToObject(fd))).id;
  } catch (e) {
    return errorToState(e);
  }
  revalidatePath("/sections");
  redirect(`/sections/${id}?saved=1`);
}

export async function updateSectionAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  return runAction(async () => {
    await updateSection(getDb(), ctx, id, formToObject(fd));
    return {};
  }, ["/sections", `/sections/${id}`]);
}
