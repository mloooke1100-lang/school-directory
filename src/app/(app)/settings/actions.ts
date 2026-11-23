"use server";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { runAction } from "@/server/run-action";
import { formToObject, type FormState } from "@/server/forms";
import { updateLeadership, updateSchoolSettings } from "@/server/services/settings";

export async function updateSchoolAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  return runAction(async () => {
    await updateSchoolSettings(getDb(), ctx, formToObject(fd));
    return {};
  }, ["/", "/settings", "/about"]);
}

export async function updateLeadershipAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  return runAction(async () => {
    await updateLeadership(getDb(), ctx, formToObject(fd));
    return {};
  }, ["/settings", "/staff/admin"]);
}
