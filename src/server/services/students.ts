/**
 * دليل الطالبات: عرض وإضافة وتعديل الطالبة وقيودها السنوية.
 * كل دالة تتحقق من المدخلات بـ Zod وتفحص الصلاحية مع تقييد المرحلة على الخادم، وتكتب سجل تدقيق داخل المعاملة نفسها.
 * لا حذف لسجل طالبة. حالات النقل/الانقطاع/الانسحاب لا تُضبط من هنا (تمر بإجراء الاعتماد في المرحلة 6).
 */
import { and, asc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { can, ForbiddenError, requirePermission, stageScope, type AuthContext } from "@/auth/rbac";
import { normalizeArabic, toLikePattern } from "@/domain/arabic";
import { writeAudit } from "../audit";
import { updateVersioned } from "../versioned";
import { stageFilter } from "../scope-sql";
import { checkbox, isoDate, optText, reqText, reqUuid, ValidationError, versionField } from "../forms";
import { getActiveYear } from "../school";

/** الحالات التي يمكن ضبطها من شاشة القيد؛ الباقي (نقل/انقطاع/انسحاب) عبر إجراء معتمد فقط */
export const EDITABLE_ENROLLMENT_STATUSES = ["ACTIVE", "PROMOTED", "GRADUATED"] as const;
const WORKFLOW_ONLY = new Set(["TRANSFERRED_OUT", "DROPPED_OUT", "WITHDRAWN"]);

const schoolNumber = z
  .string()
  .trim()
  .max(30, { error: "الرقم المدرسي أطول من المسموح" })
  .regex(/^[A-Za-z0-9\-/]*$/, { error: "الرقم المدرسي يقبل الحروف اللاتينية والأرقام و - و / فقط" })
  .optional()
  .transform((v) => (v ? v : null));

const dataStatusField = z.enum(["COMPLETE", "INCOMPLETE", "PENDING_VERIFICATION"], { error: "حالة البيانات غير صالحة" }).default("COMPLETE");
const enrollmentStatusField = z.enum(EDITABLE_ENROLLMENT_STATUSES, { error: "حالة القيد غير مسموحة من هذه الشاشة" }).default("ACTIVE");

export const studentCreateSchema = z.object({
  fullName: reqText("الاسم الكامل", 150),
  schoolNumber,
  notes: optText(500),
  dataStatus: dataStatusField,
  yearId: reqUuid("السنة الدراسية"),
  sectionId: reqUuid("الفصل"),
  enrolledAt: isoDate("تاريخ القيد"),
  status: enrollmentStatusField,
  confirmDuplicate: checkbox,
});

export const studentUpdateSchema = z.object({
  version: versionField,
  fullName: reqText("الاسم الكامل", 150),
  schoolNumber,
  notes: optText(500),
  dataStatus: dataStatusField,
});

export const enrollmentUpdateSchema = z.object({
  version: versionField,
  sectionId: reqUuid("الفصل"),
  enrolledAt: isoDate("تاريخ القيد"),
  status: z.enum(["ACTIVE", "PROMOTED", "GRADUATED", "TRANSFERRED_OUT", "DROPPED_OUT", "WITHDRAWN"], { error: "حالة القيد غير صالحة" }),
});

export const enrollmentCreateSchema = z.object({
  yearId: reqUuid("السنة الدراسية"),
  sectionId: reqUuid("الفصل"),
  enrolledAt: isoDate("تاريخ القيد"),
  status: enrollmentStatusField,
});

async function sectionInfo(db: Pick<DB, "select">, sectionId: string) {
  const [r] = await db
    .select({ id: s.classSections.id, yearId: s.classSections.yearId, stageId: s.grades.stageId, isActive: s.classSections.isActive })
    .from(s.classSections)
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .where(eq(s.classSections.id, sectionId));
  if (!r) throw new ValidationError("الفصل المختار غير موجود", "sectionId");
  return r;
}

/** مراحل قيود الطالبة (لفحص الصلاحية) */
async function studentStages(db: Pick<DB, "select">, studentId: string, onlyActiveYear = false) {
  const rows = await db
    .select({ stageId: s.grades.stageId, yearStatus: s.academicYears.status })
    .from(s.studentEnrollments)
    .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .innerJoin(s.academicYears, eq(s.academicYears.id, s.studentEnrollments.yearId))
    .where(eq(s.studentEnrollments.studentId, studentId));
  const pick = onlyActiveYear && rows.some((r) => r.yearStatus === "ACTIVE") ? rows.filter((r) => r.yearStatus === "ACTIVE") : rows;
  return [...new Set(pick.map((r) => r.stageId))];
}

/** صلاحية على طالبة: تُمنح إن كانت المستخدمة تملكها لمرحلة القيد في السنة النشطة (أو أي قيد إن لم يوجد) */
async function requireStudentPermission(db: DB, ctx: AuthContext, perm: "students.read" | "students.write", studentId: string) {
  const stages = await studentStages(db, studentId, true);
  if (stages.length === 0) return requirePermission(ctx, perm, null);
  if (!stages.some((st) => can(ctx, perm, st))) throw new ForbiddenError();
}

export interface StudentListFilters {
  q?: string;
  yearId?: string;
  stageId?: string;
  gradeId?: string;
  sectionId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listStudents(db: DB, ctx: AuthContext, f: StudentListFilters = {}) {
  const scope = stageScope(ctx, "students.read");
  if (scope.kind === "none") throw new ForbiddenError();
  const year = f.yearId ? { id: f.yearId } : await getActiveYear(db);
  if (!year) return { rows: [], total: 0 };
  const q = f.q ? normalizeArabic(f.q) : "";
  const where = and(
    eq(s.studentEnrollments.yearId, year.id),
    stageFilter(scope, s.grades.stageId),
    f.stageId ? eq(s.grades.stageId, f.stageId) : sql`true`,
    f.gradeId ? eq(s.grades.id, f.gradeId) : sql`true`,
    f.sectionId ? eq(s.classSections.id, f.sectionId) : sql`true`,
    f.status && (s.enrollmentStatus.enumValues as readonly string[]).includes(f.status)
      ? eq(s.studentEnrollments.status, f.status as (typeof s.enrollmentStatus.enumValues)[number])
      : sql`true`,
    q.length >= 1 ? or(ilike(s.students.nameNormalized, toLikePattern(q)), ilike(s.students.schoolNumber, toLikePattern(q))) : sql`true`,
  );
  const base = db
    .select({
      id: s.students.id,
      fullName: s.students.fullName,
      schoolNumber: s.students.schoolNumber,
      dataStatus: s.students.dataStatus,
      updatedAt: s.students.updatedAt,
      enrollmentStatus: s.studentEnrollments.status,
      stageName: s.stages.nameAr,
      gradeName: s.grades.nameAr,
      sectionName: s.classSections.name,
      sectionId: s.classSections.id,
    })
    .from(s.students)
    .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.studentId, s.students.id))
    .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .innerJoin(s.stages, eq(s.stages.id, s.grades.stageId))
    .where(where);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const rows = await base.orderBy(asc(s.stages.order), asc(s.grades.order), asc(s.classSections.name), asc(s.students.fullName)).limit(limit).offset(f.offset ?? 0);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.students)
    .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.studentId, s.students.id))
    .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .where(where);
  return { rows, total: n };
}

export async function getStudentRecord(db: DB, ctx: AuthContext, id: string) {
  const [student] = await db.select().from(s.students).where(eq(s.students.id, id));
  if (!student) return null;
  await requireStudentPermission(db, ctx, "students.read", id);
  const enrollments = await db
    .select({
      id: s.studentEnrollments.id,
      version: s.studentEnrollments.version,
      yearId: s.academicYears.id,
      yearName: s.academicYears.name,
      yearStatus: s.academicYears.status,
      yearStart: s.academicYears.startDate,
      status: s.studentEnrollments.status,
      enrolledAt: s.studentEnrollments.enrolledAt,
      updatedAt: s.studentEnrollments.updatedAt,
      stageId: s.stages.id,
      stageName: s.stages.nameAr,
      gradeName: s.grades.nameAr,
      sectionName: s.classSections.name,
      sectionId: s.classSections.id,
    })
    .from(s.studentEnrollments)
    .innerJoin(s.academicYears, eq(s.academicYears.id, s.studentEnrollments.yearId))
    .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .innerJoin(s.stages, eq(s.stages.id, s.grades.stageId))
    .where(eq(s.studentEnrollments.studentId, id))
    .orderBy(sql`${s.academicYears.startDate} DESC`);
  // القيود في مراحل خارج صلاحية المستخدمة لا تُعرض
  const visible = enrollments.filter((e) => can(ctx, "students.read", e.stageId));
  const canWrite = visible.some((e) => e.yearStatus === "ACTIVE" && can(ctx, "students.write", e.stageId)) || (enrollments.length === 0 && can(ctx, "students.write", null));
  return { student, enrollments: visible, canWrite };
}

export async function createStudent(db: DB, ctx: AuthContext, raw: unknown) {
  const d = studentCreateSchema.parse(raw);
  const sec = await sectionInfo(db, d.sectionId);
  requirePermission(ctx, "students.write", sec.stageId);
  if (sec.yearId !== d.yearId) throw new ValidationError("الفصل المختار لا يتبع السنة الدراسية المختارة", "sectionId");
  if (!sec.isActive) throw new ValidationError("الفصل المختار غير نشط", "sectionId");
  const nameNormalized = normalizeArabic(d.fullName);

  // منع التكرار غير المقصود: الاسم نفسه في الفصل نفسه يتطلب تأكيدًا صريحًا
  if (!d.confirmDuplicate) {
    const [dup] = await db
      .select({ id: s.students.id })
      .from(s.students)
      .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.studentId, s.students.id))
      .where(and(eq(s.students.nameNormalized, nameNormalized), eq(s.studentEnrollments.sectionId, d.sectionId)));
    if (dup) throw new ValidationError("توجد طالبة بالاسم نفسه في هذا الفصل. إن كانت طالبة مختلفة فعلًا فعّلي «تأكيد الإضافة رغم تشابه الاسم».", "confirmDuplicate");
  }

  return db.transaction(async (tx) => {
    const [st] = await tx
      .insert(s.students)
      .values({ fullName: d.fullName, nameNormalized, schoolNumber: d.schoolNumber, notes: d.notes, dataStatus: d.dataStatus, createdById: ctx.userId, updatedById: ctx.userId })
      .returning();
    const [en] = await tx
      .insert(s.studentEnrollments)
      .values({ studentId: st.id, yearId: d.yearId, sectionId: d.sectionId, enrolledAt: d.enrolledAt, status: d.status, updatedById: ctx.userId })
      .returning();
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "student", entityId: st.id, after: { student: st, enrollment: en } });
    return st;
  });
}

export async function updateStudent(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  const d = studentUpdateSchema.parse(raw);
  await requireStudentPermission(db, ctx, "students.write", id);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.students).where(eq(s.students.id, id));
    if (!before) throw new ValidationError("الطالبة غير موجودة");
    const after = await updateVersioned(tx, s.students, id, d.version, {
      fullName: d.fullName,
      nameNormalized: normalizeArabic(d.fullName),
      schoolNumber: d.schoolNumber,
      notes: d.notes,
      dataStatus: d.dataStatus,
      updatedById: ctx.userId,
    });
    await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "student", entityId: id, before, after });
    return after;
  });
}

export async function updateEnrollment(db: DB, ctx: AuthContext, enrollmentId: string, raw: unknown) {
  const d = enrollmentUpdateSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.studentEnrollments).where(eq(s.studentEnrollments.id, enrollmentId));
    if (!before) throw new ValidationError("القيد غير موجود");
    const oldSec = await sectionInfo(tx, before.sectionId);
    const newSec = await sectionInfo(tx, d.sectionId);
    // الصلاحية مطلوبة للمرحلتين: القديمة والجديدة
    requirePermission(ctx, "students.write", oldSec.stageId);
    requirePermission(ctx, "students.write", newSec.stageId);
    if (newSec.yearId !== before.yearId) throw new ValidationError("لا يمكن نقل القيد إلى فصل في سنة دراسية أخرى؛ أضيفي قيدًا جديدًا للسنة الأخرى", "sectionId");
    if (d.status !== before.status && (WORKFLOW_ONLY.has(d.status) || WORKFLOW_ONLY.has(before.status))) {
      throw new ValidationError("حالات النقل والانقطاع والانسحاب تُسجَّل عبر إجراء شؤون الطالبات المعتمد، وليس بالتعديل المباشر", "status");
    }
    const after = await updateVersioned(tx, s.studentEnrollments, enrollmentId, d.version, {
      sectionId: d.sectionId,
      enrolledAt: d.enrolledAt,
      status: d.status,
      updatedById: ctx.userId,
    });
    await tx.update(s.students).set({ updatedAt: new Date(), updatedById: ctx.userId }).where(eq(s.students.id, before.studentId));
    await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "enrollment", entityId: enrollmentId, before, after });
    return after;
  });
}

export async function addEnrollment(db: DB, ctx: AuthContext, studentId: string, raw: unknown) {
  const d = enrollmentCreateSchema.parse(raw);
  const sec = await sectionInfo(db, d.sectionId);
  requirePermission(ctx, "students.write", sec.stageId);
  await requireStudentPermission(db, ctx, "students.read", studentId);
  if (sec.yearId !== d.yearId) throw new ValidationError("الفصل المختار لا يتبع السنة الدراسية المختارة", "sectionId");
  const [year] = await db.select().from(s.academicYears).where(eq(s.academicYears.id, d.yearId));
  if (!year) throw new ValidationError("السنة غير موجودة", "yearId");
  if (year.status === "ARCHIVED") throw new ValidationError("السنة مؤرشفة ولا تقبل قيودًا جديدة", "yearId");
  return db.transaction(async (tx) => {
    const [en] = await tx
      .insert(s.studentEnrollments)
      .values({ studentId, yearId: d.yearId, sectionId: d.sectionId, enrolledAt: d.enrolledAt, status: d.status, updatedById: ctx.userId })
      .returning();
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "enrollment", entityId: en.id, after: en });
    return en;
  });
}

/** الخيارات المتاحة لنماذج القيد: السنوات غير المؤرشفة، والفصول النشطة ضمن مراحل الكتابة المسموحة */
export async function enrollmentOptions(db: DB, ctx: AuthContext) {
  const scope = stageScope(ctx, "students.write");
  const years = await db.select().from(s.academicYears).where(ne(s.academicYears.status, "ARCHIVED")).orderBy(asc(s.academicYears.startDate));
  const sections =
    scope.kind === "none" || years.length === 0
      ? []
      : await db
          .select({ id: s.classSections.id, yearId: s.classSections.yearId, name: s.classSections.name, gradeName: s.grades.nameAr, stageName: s.stages.nameAr })
          .from(s.classSections)
          .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
          .innerJoin(s.stages, eq(s.stages.id, s.grades.stageId))
          .where(and(eq(s.classSections.isActive, true), inArray(s.classSections.yearId, years.map((y) => y.id)), stageFilter(scope, s.stages.id)))
          .orderBy(asc(s.stages.order), asc(s.grades.order), asc(s.classSections.name));
  return { years, sections };
}
