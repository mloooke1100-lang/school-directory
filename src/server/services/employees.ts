/**
 * دليل الموظفات بأقسامه: المعلمات، الهيئة الإدارية، المستخدمات والحراس.
 * تاريخا المباشرة (الوزارة/المدرسة) منفصلان دائمًا، ويُحفظ النص الأصلي ونوع التقويم.
 * وجود الموظفة في الدليل منفصل عن امتلاكها حساب دخول (لا تُنشأ حسابات تلقائيًا).
 */
import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { can, ForbiddenError, requirePermission, type AuthContext } from "@/auth/rbac";
import { normalizeArabic, toLikePattern } from "@/domain/arabic";
import { resolveServiceDate, ServiceDateError, type ServiceDateValue } from "@/domain/service-dates";
import { riyadhNow } from "@/domain/time";
import { writeAudit } from "../audit";
import { updateVersioned } from "../versioned";
import { optText, reqText, stringArray, ValidationError, versionField } from "../forms";
import { getActiveYear } from "../school";

export type Category = (typeof s.employeeCategory.enumValues)[number];
export const DIRECTORY_GROUPS = {
  teachers: { title: "دليل المعلمات", categories: ["TEACHER"] as Category[] },
  admin: { title: "دليل الهيئة الإدارية", categories: ["LEADERSHIP", "ADMINISTRATIVE", "COUNSELOR"] as Category[] },
  service: { title: "دليل المستخدمات والحراس", categories: ["SERVICE", "GUARD"] as Category[] },
} as const;
export type DirectoryGroup = keyof typeof DIRECTORY_GROUPS;

export function groupOfCategory(c: Category): DirectoryGroup {
  return (Object.keys(DIRECTORY_GROUPS) as DirectoryGroup[]).find((g) => DIRECTORY_GROUPS[g].categories.includes(c))!;
}

const calendarField = z
  .union([z.literal(""), z.enum(["HIJRI", "GREGORIAN"])])
  .optional()
  .transform((v) => (v ? v : null));
const verificationField = z.enum(["COMPLETE", "INCOMPLETE", "PENDING_VERIFICATION"], { error: "حالة التحقق غير صالحة" }).default("PENDING_VERIFICATION");

export const employeeSchema = z.object({
  fullName: reqText("الاسم الكامل", 150),
  category: z.enum(s.employeeCategory.enumValues, { error: "اختاري الفئة الوظيفية" }),
  jobTitle: reqText("المسمى الوظيفي", 120),
  specialization: optText(120),
  status: z.enum(s.employmentStatus.enumValues, { error: "الحالة الوظيفية غير صالحة" }).default("ACTIVE"),
  dataStatus: z.enum(s.dataStatus.enumValues, { error: "حالة البيانات غير صالحة" }).default("INCOMPLETE"),
  duties: optText(2000),
  workLocation: optText(200),
  notes: optText(2000),
  stageIds: stringArray.pipe(z.array(z.uuid({ error: "مرحلة غير صالحة" }))),
  ministryCalendar: calendarField,
  ministryDate: optText(40),
  ministryVerification: verificationField,
  schoolCalendar: calendarField,
  schoolDate: optText(40),
  schoolVerification: verificationField,
});
export const employeeUpdateSchema = employeeSchema.extend({ version: versionField });

type EmployeeInput = z.infer<typeof employeeSchema>;

function resolveDates(d: EmployeeInput): { MINISTRY: ServiceDateValue; SCHOOL: ServiceDateValue } {
  try {
    return {
      MINISTRY: resolveServiceDate(d.ministryCalendar, d.ministryDate, d.ministryVerification),
      SCHOOL: (() => {
        try {
          return resolveServiceDate(d.schoolCalendar, d.schoolDate, d.schoolVerification);
        } catch (e) {
          if (e instanceof ServiceDateError) throw new ValidationError(`تاريخ المباشرة بالمدرسة: ${e.message}`, "schoolDate");
          throw e;
        }
      })(),
    };
  } catch (e) {
    if (e instanceof ServiceDateError) throw new ValidationError(`تاريخ المباشرة بالوزارة: ${e.message}`, "ministryDate");
    throw e;
  }
}

/** الحقول الحساسة (التواريخ والملاحظات الإدارية) تتطلب صلاحية الاطلاع عليها */
function requireSensitiveIfProvided(ctx: AuthContext, d: EmployeeInput) {
  if (can(ctx, "employees.read_sensitive")) return;
  if (d.notes || d.ministryDate || d.schoolDate) throw new ForbiddenError("لا تملكين صلاحية تعديل تواريخ المباشرة أو الملاحظات الإدارية");
}

async function validStages(db: Pick<DB, "select">, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db.select({ id: s.stages.id }).from(s.stages).where(inArray(s.stages.id, ids));
  if (rows.length !== new Set(ids).size) throw new ValidationError("إحدى المراحل المختارة غير موجودة", "stageIds");
  return [...new Set(ids)];
}

export interface EmployeeListFilters {
  q?: string;
  category?: string;
  stageId?: string;
  status?: string;
  dataStatus?: string;
}

export async function listEmployees(db: DB, ctx: AuthContext, group: DirectoryGroup, f: EmployeeListFilters = {}) {
  requirePermission(ctx, "employees.read");
  const sensitive = can(ctx, "employees.read_sensitive");
  const cats = DIRECTORY_GROUPS[group].categories;
  const category = f.category && cats.includes(f.category as Category) ? [f.category as Category] : cats;
  const q = f.q ? normalizeArabic(f.q) : "";
  const rows = await db
    .select({
      id: s.employees.id,
      fullName: s.employees.fullName,
      category: s.employees.category,
      jobTitle: s.employees.jobTitle,
      specialization: s.employees.specialization,
      status: s.employees.status,
      dataStatus: s.employees.dataStatus,
      duties: s.employees.duties,
      workLocation: s.employees.workLocation,
      notes: s.employees.notes,
    })
    .from(s.employees)
    .where(
      and(
        inArray(s.employees.category, category),
        f.status && (s.employmentStatus.enumValues as readonly string[]).includes(f.status) ? eq(s.employees.status, f.status as (typeof s.employmentStatus.enumValues)[number]) : sql`true`,
        f.dataStatus && (s.dataStatus.enumValues as readonly string[]).includes(f.dataStatus) ? eq(s.employees.dataStatus, f.dataStatus as (typeof s.dataStatus.enumValues)[number]) : sql`true`,
        f.stageId
          ? inArray(s.employees.id, db.select({ id: s.employeeAssignments.employeeId }).from(s.employeeAssignments).where(and(eq(s.employeeAssignments.stageId, f.stageId), eq(s.employeeAssignments.isActive, true))))
          : sql`true`,
        q ? or(ilike(s.employees.nameNormalized, toLikePattern(q)), ilike(s.employees.jobTitle, toLikePattern(q)), ilike(s.employees.specialization, toLikePattern(q))) : sql`true`,
      ),
    )
    .orderBy(asc(s.employees.fullName));
  const ids = rows.map((r) => r.id);
  const [assignments, dates, accounts] = await Promise.all([
    ids.length
      ? db
          .select({ employeeId: s.employeeAssignments.employeeId, titleAr: s.employeeAssignments.titleAr, position: s.employeeAssignments.position, duties: s.employeeAssignments.duties, stageName: s.stages.nameAr })
          .from(s.employeeAssignments)
          .leftJoin(s.stages, eq(s.stages.id, s.employeeAssignments.stageId))
          .where(and(inArray(s.employeeAssignments.employeeId, ids), eq(s.employeeAssignments.isActive, true)))
      : [],
    sensitive && ids.length ? db.select().from(s.employeeServiceDates).where(inArray(s.employeeServiceDates.employeeId, ids)) : [],
    sensitive && ids.length
      ? db
          .select({ employeeId: s.users.employeeId, isActive: s.users.isActive, roleName: s.roles.nameAr, stageName: s.stages.nameAr })
          .from(s.users)
          .leftJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
          .leftJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
          .leftJoin(s.stages, eq(s.stages.id, s.userRoles.stageId))
          .where(inArray(s.users.employeeId, ids))
      : [],
  ]);
  return {
    sensitive,
    rows: rows.map((r) => ({
      ...r,
      notes: sensitive ? r.notes : null,
      stages: [...new Set(assignments.filter((a) => a.employeeId === r.id && a.stageName).map((a) => a.stageName!))],
      assignments: assignments.filter((a) => a.employeeId === r.id && a.position !== "OTHER").map((a) => a.titleAr),
      ministry: sensitive ? (dates.find((d) => d.employeeId === r.id && d.kind === "MINISTRY") ?? null) : null,
      school: sensitive ? (dates.find((d) => d.employeeId === r.id && d.kind === "SCHOOL") ?? null) : null,
      account: sensitive
        ? (() => {
            const acc = accounts.filter((a) => a.employeeId === r.id);
            if (acc.length === 0) return null;
            return { isActive: acc[0].isActive, roles: acc.filter((a) => a.roleName).map((a) => (a.stageName ? `${a.roleName} (${a.stageName})` : a.roleName!)) };
          })()
        : null,
    })),
  };
}

export async function getEmployeeRecord(db: DB, ctx: AuthContext, id: string) {
  requirePermission(ctx, "employees.read");
  const sensitive = can(ctx, "employees.read_sensitive");
  const [emp] = await db.select().from(s.employees).where(eq(s.employees.id, id));
  if (!emp) return null;
  const assignments = await db
    .select({ id: s.employeeAssignments.id, position: s.employeeAssignments.position, titleAr: s.employeeAssignments.titleAr, stageId: s.employeeAssignments.stageId, stageName: s.stages.nameAr, isActive: s.employeeAssignments.isActive, startDate: s.employeeAssignments.startDate, endDate: s.employeeAssignments.endDate, duties: s.employeeAssignments.duties })
    .from(s.employeeAssignments)
    .leftJoin(s.stages, eq(s.stages.id, s.employeeAssignments.stageId))
    .where(eq(s.employeeAssignments.employeeId, id));
  const dates = sensitive ? await db.select().from(s.employeeServiceDates).where(eq(s.employeeServiceDates.employeeId, id)) : [];
  const subjects = await db
    .select({ subject: s.subjects.nameAr, stageName: s.stages.nameAr })
    .from(s.teacherSubjects)
    .innerJoin(s.subjects, eq(s.subjects.id, s.teacherSubjects.subjectId))
    .innerJoin(s.stages, eq(s.stages.id, s.teacherSubjects.stageId))
    .where(eq(s.teacherSubjects.employeeId, id));

  // الجدول المرتبط بها (للعرض فقط — إدارة الجداول في المرحلة 5)، ضمن مراحل صلاحية الجداول فقط
  const timetable = can(ctx, "timetable.read")
    ? (
        await db
          .select({
            dayOfWeek: s.timetableEntries.dayOfWeek,
            periodNumber: s.timetableEntries.periodNumber,
            kind: s.timetableEntries.kind,
            subject: s.subjects.nameAr,
            gradeName: s.grades.nameAr,
            sectionName: s.classSections.name,
            room: s.rooms.name,
            stageId: s.weeklyTimetables.stageId,
          })
          .from(s.timetableEntries)
          .innerJoin(s.weeklyTimetables, eq(s.weeklyTimetables.id, s.timetableEntries.timetableId))
          .leftJoin(s.subjects, eq(s.subjects.id, s.timetableEntries.subjectId))
          .leftJoin(s.classSections, eq(s.classSections.id, s.timetableEntries.sectionId))
          .leftJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
          .leftJoin(s.rooms, eq(s.rooms.id, s.timetableEntries.roomId))
          .where(and(eq(s.timetableEntries.teacherId, id), eq(s.weeklyTimetables.status, "APPROVED")))
          .orderBy(asc(s.timetableEntries.dayOfWeek), asc(s.timetableEntries.periodNumber))
      ).filter((r) => can(ctx, "timetable.read", r.stageId))
    : null;
  const homerooms = await db
    .select({ gradeName: s.grades.nameAr, sectionName: s.classSections.name, yearName: s.academicYears.name })
    .from(s.classSections)
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .innerJoin(s.academicYears, eq(s.academicYears.id, s.classSections.yearId))
    .where(and(eq(s.classSections.homeroomTeacherId, id), eq(s.academicYears.status, "ACTIVE")));
  const account = sensitive || can(ctx, "users.manage")
    ? (
        await db
          .select({ id: s.users.id, username: s.users.username, isActive: s.users.isActive, roleName: s.roles.nameAr, stageName: s.stages.nameAr })
          .from(s.users)
          .leftJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
          .leftJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
          .leftJoin(s.stages, eq(s.stages.id, s.userRoles.stageId))
          .where(eq(s.users.employeeId, id))
      ).reduce<null | { id: string; username: string; isActive: boolean; roles: string[] }>((acc, r) => {
        const a = acc ?? { id: r.id, username: r.username, isActive: r.isActive, roles: [] };
        if (r.roleName) a.roles.push(r.stageName ? `${r.roleName} (${r.stageName})` : r.roleName);
        return a;
      }, null)
    : null;
  return {
    employee: { ...emp, notes: sensitive ? emp.notes : null },
    sensitive,
    canWrite: can(ctx, "employees.write"),
    assignments,
    ministry: dates.find((d) => d.kind === "MINISTRY") ?? null,
    school: dates.find((d) => d.kind === "SCHOOL") ?? null,
    subjects,
    timetable,
    homerooms,
    account,
  };
}

async function writeServiceDates(tx: Pick<DB, "insert">, employeeId: string, userId: string, dates: ReturnType<typeof resolveDates>) {
  for (const kind of ["MINISTRY", "SCHOOL"] as const) {
    const v = dates[kind];
    await tx
      .insert(s.employeeServiceDates)
      .values({ employeeId, kind, ...v, updatedById: userId })
      .onConflictDoUpdate({ target: [s.employeeServiceDates.employeeId, s.employeeServiceDates.kind], set: { ...v, updatedById: userId, updatedAt: new Date() } });
  }
}

/** يزامن تكليفات المراحل العامة (position = OTHER) دون المساس بتكليفات القيادة، ويحفظ الأثر بإنهاء القديم لا حذفه */
async function syncStageAssignments(tx: DB | Parameters<Parameters<DB["transaction"]>[0]>[0], employeeId: string, jobTitle: string, stageIds: string[]) {
  const year = await getActiveYear(tx as DB);
  const current = await tx
    .select()
    .from(s.employeeAssignments)
    .where(and(eq(s.employeeAssignments.employeeId, employeeId), eq(s.employeeAssignments.position, "OTHER"), eq(s.employeeAssignments.isActive, true)));
  const today = riyadhNow().date;
  for (const a of current) {
    if (!a.stageId || !stageIds.includes(a.stageId)) {
      await tx.update(s.employeeAssignments).set({ isActive: false, endDate: today }).where(eq(s.employeeAssignments.id, a.id));
    }
  }
  for (const st of stageIds) {
    if (!current.some((a) => a.stageId === st)) {
      await tx.insert(s.employeeAssignments).values({ employeeId, position: "OTHER", titleAr: jobTitle, stageId: st, yearId: year?.id ?? null, startDate: today });
    }
  }
}

export async function createEmployee(db: DB, ctx: AuthContext, raw: unknown) {
  requirePermission(ctx, "employees.write");
  const d = employeeSchema.parse(raw);
  requireSensitiveIfProvided(ctx, d);
  const dates = resolveDates(d);
  const stageIds = await validStages(db, d.stageIds);
  return db.transaction(async (tx) => {
    const [e] = await tx
      .insert(s.employees)
      .values({
        fullName: d.fullName,
        nameNormalized: normalizeArabic(d.fullName),
        category: d.category,
        jobTitle: d.jobTitle,
        specialization: d.specialization,
        status: d.status,
        dataStatus: d.dataStatus,
        duties: d.duties,
        workLocation: d.workLocation,
        notes: d.notes,
        createdById: ctx.userId,
        updatedById: ctx.userId,
      })
      .returning();
    await writeServiceDates(tx, e.id, ctx.userId, dates);
    await syncStageAssignments(tx, e.id, d.jobTitle, stageIds);
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "employee", entityId: e.id, after: { employee: e, serviceDates: dates, stageIds } });
    return e;
  });
}

export async function updateEmployee(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  requirePermission(ctx, "employees.write");
  const d = employeeUpdateSchema.parse(raw);
  const sensitive = can(ctx, "employees.read_sensitive");
  requireSensitiveIfProvided(ctx, d);
  const dates = resolveDates(d);
  const stageIds = await validStages(db, d.stageIds);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.employees).where(eq(s.employees.id, id));
    if (!before) throw new ValidationError("الموظفة غير موجودة");
    const beforeDates = await tx.select().from(s.employeeServiceDates).where(eq(s.employeeServiceDates.employeeId, id));
    // القفل التفاؤلي على سجل الموظفة يحمي النموذج كاملًا (بما فيه التواريخ والمراحل)
    const after = await updateVersioned(tx, s.employees, id, d.version, {
      fullName: d.fullName,
      nameNormalized: normalizeArabic(d.fullName),
      category: d.category,
      jobTitle: d.jobTitle,
      specialization: d.specialization,
      status: d.status,
      dataStatus: d.dataStatus,
      duties: d.duties,
      workLocation: d.workLocation,
      // من لا يملك الصلاحية الحساسة لا يرى الملاحظات، فلا تُمسح بحفظه
      ...(sensitive ? { notes: d.notes } : {}),
      updatedById: ctx.userId,
    });
    if (sensitive) await writeServiceDates(tx, id, ctx.userId, dates);
    await syncStageAssignments(tx, id, d.jobTitle, stageIds);
    await writeAudit(tx, {
      actorId: ctx.userId,
      action: "update",
      entityType: "employee",
      entityId: id,
      before: { employee: before, serviceDates: beforeDates },
      after: { employee: after, serviceDates: sensitive ? dates : "unchanged", stageIds },
    });
    return after;
  });
}

export async function employeeFormOptions(db: DB) {
  return { stages: await db.select().from(s.stages).orderBy(asc(s.stages.order)) };
}

/** المعلمات النشطات (لاختيار رائدة الفصل) */
export async function activeTeachers(db: DB) {
  return db
    .select({ id: s.employees.id, fullName: s.employees.fullName })
    .from(s.employees)
    .where(and(eq(s.employees.category, "TEACHER"), eq(s.employees.status, "ACTIVE")))
    .orderBy(asc(s.employees.fullName));
}

/** الموظفات غير المرتبطات بحساب (لربط حساب جديد) */
export async function employeesWithoutAccount(db: DB, exceptUserId?: string) {
  const linked = db.select({ id: s.users.employeeId }).from(s.users).where(exceptUserId ? sql`${s.users.id} <> ${exceptUserId} AND ${s.users.employeeId} IS NOT NULL` : sql`${s.users.employeeId} IS NOT NULL`);
  return db
    .select({ id: s.employees.id, fullName: s.employees.fullName, jobTitle: s.employees.jobTitle })
    .from(s.employees)
    .where(and(sql`${s.employees.id} NOT IN (${linked})`, or(eq(s.employees.status, "ACTIVE"), isNull(s.employees.status))))
    .orderBy(asc(s.employees.fullName));
}
