/**
 * الفصول والشعب: لكل صف شعب في كل سنة دراسية. الاطلاع بصلاحية students.read، والإدارة بـ sections.write،
 * وكلاهما مقيّد بمرحلة الصف على الخادم.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { can, ForbiddenError, requirePermission, stageScope, type AuthContext } from "@/auth/rbac";
import { writeAudit } from "../audit";
import { updateVersioned } from "../versioned";
import { stageFilter } from "../scope-sql";
import { checkbox, optUuid, reqText, reqUuid, ValidationError, versionField } from "../forms";
import { getActiveYear } from "../school";

export const sectionCreateSchema = z.object({
  gradeId: reqUuid("الصف"),
  yearId: reqUuid("السنة الدراسية"),
  name: reqText("اسم الشعبة", 30),
  homeroomTeacherId: optUuid(),
  roomId: optUuid(),
});
export const sectionUpdateSchema = z.object({
  version: versionField,
  name: reqText("اسم الشعبة", 30),
  homeroomTeacherId: optUuid(),
  roomId: optUuid(),
  isActive: checkbox,
});

async function checkTeacher(db: Pick<DB, "select">, id: string | null) {
  if (!id) return;
  const [t] = await db.select({ category: s.employees.category }).from(s.employees).where(eq(s.employees.id, id));
  if (!t || t.category !== "TEACHER") throw new ValidationError("رائدة الفصل يجب أن تكون معلمة مسجلة في الدليل", "homeroomTeacherId");
}

export async function listSections(db: DB, ctx: AuthContext, f: { yearId?: string; stageId?: string } = {}) {
  const scope = stageScope(ctx, "students.read");
  if (scope.kind === "none") throw new ForbiddenError();
  const year = f.yearId ? { id: f.yearId } : await getActiveYear(db);
  if (!year) return [];
  const rows = await db
    .select({
      id: s.classSections.id,
      name: s.classSections.name,
      isActive: s.classSections.isActive,
      gradeName: s.grades.nameAr,
      stageId: s.stages.id,
      stageName: s.stages.nameAr,
      homeroom: s.employees.fullName,
      room: s.rooms.name,
      students: sql<number>`(SELECT count(*)::int FROM ${s.studentEnrollments} WHERE ${s.studentEnrollments.sectionId} = ${s.classSections.id} AND ${s.studentEnrollments.status} = 'ACTIVE')`,
    })
    .from(s.classSections)
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .innerJoin(s.stages, eq(s.stages.id, s.grades.stageId))
    .leftJoin(s.employees, eq(s.employees.id, s.classSections.homeroomTeacherId))
    .leftJoin(s.rooms, eq(s.rooms.id, s.classSections.roomId))
    .where(and(eq(s.classSections.yearId, year.id), stageFilter(scope, s.stages.id), f.stageId ? eq(s.stages.id, f.stageId) : sql`true`))
    .orderBy(asc(s.stages.order), asc(s.grades.order), asc(s.classSections.name));
  return rows.map((r) => ({ ...r, canWrite: can(ctx, "sections.write", r.stageId) }));
}

export async function getSection(db: DB, ctx: AuthContext, id: string) {
  const [sec] = await db
    .select({
      section: s.classSections,
      gradeName: s.grades.nameAr,
      stageId: s.stages.id,
      stageName: s.stages.nameAr,
      yearName: s.academicYears.name,
      homeroom: s.employees.fullName,
      room: s.rooms.name,
    })
    .from(s.classSections)
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .innerJoin(s.stages, eq(s.stages.id, s.grades.stageId))
    .innerJoin(s.academicYears, eq(s.academicYears.id, s.classSections.yearId))
    .leftJoin(s.employees, eq(s.employees.id, s.classSections.homeroomTeacherId))
    .leftJoin(s.rooms, eq(s.rooms.id, s.classSections.roomId))
    .where(eq(s.classSections.id, id));
  if (!sec) return null;
  requirePermission(ctx, "students.read", sec.stageId);
  const students = await db
    .select({ id: s.students.id, fullName: s.students.fullName, schoolNumber: s.students.schoolNumber, status: s.studentEnrollments.status })
    .from(s.studentEnrollments)
    .innerJoin(s.students, eq(s.students.id, s.studentEnrollments.studentId))
    .where(eq(s.studentEnrollments.sectionId, id))
    .orderBy(asc(s.students.fullName));
  return { ...sec, students, canWrite: can(ctx, "sections.write", sec.stageId) };
}

export async function createSection(db: DB, ctx: AuthContext, raw: unknown) {
  const d = sectionCreateSchema.parse(raw);
  const [grade] = await db.select().from(s.grades).where(eq(s.grades.id, d.gradeId));
  if (!grade) throw new ValidationError("الصف غير موجود", "gradeId");
  requirePermission(ctx, "sections.write", grade.stageId);
  const [year] = await db.select().from(s.academicYears).where(eq(s.academicYears.id, d.yearId));
  if (!year) throw new ValidationError("السنة غير موجودة", "yearId");
  if (year.status === "ARCHIVED") throw new ValidationError("لا يمكن إضافة شعبة إلى سنة مؤرشفة", "yearId");
  await checkTeacher(db, d.homeroomTeacherId);
  return db.transaction(async (tx) => {
    const [sec] = await tx.insert(s.classSections).values({ ...d, updatedById: ctx.userId }).returning();
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "section", entityId: sec.id, after: sec });
    return sec;
  });
}

export async function updateSection(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  const d = sectionUpdateSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ sec: s.classSections, stageId: s.grades.stageId }).from(s.classSections).innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId)).where(eq(s.classSections.id, id));
    if (!before) throw new ValidationError("الشعبة غير موجودة");
    requirePermission(ctx, "sections.write", before.stageId);
    await checkTeacher(tx, d.homeroomTeacherId);
    if (!d.isActive && before.sec.isActive) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.studentEnrollments).where(and(eq(s.studentEnrollments.sectionId, id), eq(s.studentEnrollments.status, "ACTIVE")));
      if (n > 0) throw new ValidationError(`لا يمكن تعطيل شعبة فيها ${n} من الطالبات المنتظمات؛ انقليهن أولًا`, "isActive");
    }
    const after = await updateVersioned(tx, s.classSections, id, d.version, { ...d, version: undefined, updatedById: ctx.userId });
    await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "section", entityId: id, before: before.sec, after });
    return after;
  });
}

export async function sectionFormOptions(db: DB, ctx: AuthContext) {
  const scope = stageScope(ctx, "sections.write");
  const grades = await db
    .select({ id: s.grades.id, nameAr: s.grades.nameAr, stageName: s.stages.nameAr })
    .from(s.grades)
    .innerJoin(s.stages, eq(s.stages.id, s.grades.stageId))
    .where(stageFilter(scope, s.stages.id))
    .orderBy(asc(s.stages.order), asc(s.grades.order));
  const years = await db.select().from(s.academicYears).where(sql`${s.academicYears.status} <> 'ARCHIVED'`).orderBy(asc(s.academicYears.startDate));
  const rooms = await db.select().from(s.rooms).where(eq(s.rooms.isActive, true)).orderBy(asc(s.rooms.name));
  return { grades, years, rooms };
}
