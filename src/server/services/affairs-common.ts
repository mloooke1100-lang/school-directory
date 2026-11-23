import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { ValidationError } from "../forms";

/** القيد في السنة النشطة للطالبة مع مرحلتها وشعبتها */
export async function activeYearEnrollment(db: Pick<DB, "select">, studentId: string) {
  const [e] = await db
    .select({ id: s.studentEnrollments.id, status: s.studentEnrollments.status, version: s.studentEnrollments.version, sectionId: s.studentEnrollments.sectionId, stageId: s.grades.stageId })
    .from(s.studentEnrollments)
    .innerJoin(s.academicYears, eq(s.academicYears.id, s.studentEnrollments.yearId))
    .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .where(and(eq(s.studentEnrollments.studentId, studentId), eq(s.academicYears.status, "ACTIVE")));
  if (!e) throw new ValidationError("لا يوجد قيد للطالبة في السنة الدراسية النشطة");
  return e;
}

/** مرحلة الشعبة */
export async function sectionStage(db: Pick<DB, "select">, sectionId: string) {
  const [r] = await db.select({ stageId: s.grades.stageId, yearId: s.classSections.yearId }).from(s.classSections).innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId)).where(eq(s.classSections.id, sectionId));
  if (!r) throw new ValidationError("الفصل غير موجود", "sectionId");
  return r;
}

export function dbConstraint(e: unknown): string | undefined {
  const c = (e as { cause?: { code?: string; constraint?: string } })?.cause;
  return c?.code === "23505" ? c.constraint : undefined;
}
