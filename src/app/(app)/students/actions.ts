"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { runAction } from "@/server/run-action";
import { errorToState, formToObject, type FormState } from "@/server/forms";
import { addEnrollment, createStudent, updateEnrollment, updateStudent } from "@/server/services/students";

export async function createStudentAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  let id: string;
  try {
    id = (await createStudent(getDb(), ctx, formToObject(fd))).id;
  } catch (e) {
    return errorToState(e);
  }
  revalidatePath("/students");
  redirect(`/students/${id}?saved=1`);
}

export async function updateStudentAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  return runAction(async () => {
    await updateStudent(getDb(), ctx, id, formToObject(fd));
    return {};
  }, ["/students", `/students/${id}`]);
}

export async function updateEnrollmentAction(studentId: string, enrollmentId: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  return runAction(async () => {
    await updateEnrollment(getDb(), ctx, enrollmentId, formToObject(fd));
    return {};
  }, ["/students", `/students/${studentId}`]);
}

export async function addEnrollmentAction(studentId: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireUser();
  return runAction(async () => {
    await addEnrollment(getDb(), ctx, studentId, formToObject(fd));
    return {};
  }, ["/students", `/students/${studentId}`]);
}
