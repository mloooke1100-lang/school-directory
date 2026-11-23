/**
 * إعدادات المدرسة والقيادة — قابلة للتعديل بصلاحية settings.write وليست ثابتة في الكود.
 * تغيير شاغلة منصب قيادي لا يحذف التكليف السابق بل يُنهيه (يبقى أثره في السجل).
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { can, requirePermission, type AuthContext } from "@/auth/rbac";
import { riyadhNow } from "@/domain/time";
import { StaleRecordError } from "@/domain/conflicts";
import { writeAudit } from "../audit";
import { updateVersioned } from "../versioned";
import { checkbox, optText, optUuid, reqText, ValidationError, versionField } from "../forms";
import { getActiveYear, getSchool } from "../school";

export const LEADERSHIP_POSITIONS = ["PRINCIPAL", "VP_ACADEMIC", "VP_STUDENTS", "COUNSELOR", "DIRECTORY_OFFICER"] as const;
const IDENTITY_KEY = "identity.verification";

export const schoolSchema = z.object({
  version: versionField,
  nameAr: reqText("اسم المدرسة", 200),
  educationOffice: reqText("الجهة التعليمية", 200),
  systemName: reqText("اسم النظام", 120),
  tagline: optText(200),
  creditLine: reqText("سطر الإنشاء والتطوير", 200),
  officialApproved: checkbox,
  principalNameStatus: z.enum(["PENDING_VERIFICATION", "COMPLETE"], { error: "حالة التحقق غير صالحة" }),
});

export const leadershipSchema = z.object({
  position: z.enum(LEADERSHIP_POSITIONS, { error: "المنصب غير صالح" }),
  employeeId: optUuid(),
  titleAr: reqText("مسمى المنصب", 120),
  duties: optText(1000),
  /** معرّف التكليف الحالي كما رأته المستخدمة (قفل تفاؤلي على المنصب) */
  currentAssignmentId: optUuid(),
});

export async function getSettings(db: DB, ctx: AuthContext) {
  requirePermission(ctx, "settings.read");
  const school = await getSchool(db);
  if (!school) return null;
  const [identity] = await db.select().from(s.schoolSettings).where(and(eq(s.schoolSettings.schoolId, school.id), eq(s.schoolSettings.key, IDENTITY_KEY)));
  const current = await db
    .select({ id: s.employeeAssignments.id, position: s.employeeAssignments.position, titleAr: s.employeeAssignments.titleAr, duties: s.employeeAssignments.duties, startDate: s.employeeAssignments.startDate, employeeId: s.employees.id, employeeName: s.employees.fullName })
    .from(s.employeeAssignments)
    .innerJoin(s.employees, eq(s.employees.id, s.employeeAssignments.employeeId))
    .where(and(inArray(s.employeeAssignments.position, [...LEADERSHIP_POSITIONS]), eq(s.employeeAssignments.isActive, true)));
  const candidates = await db
    .select({ id: s.employees.id, fullName: s.employees.fullName, jobTitle: s.employees.jobTitle })
    .from(s.employees)
    .where(inArray(s.employees.category, ["LEADERSHIP", "ADMINISTRATIVE", "COUNSELOR", "TEACHER"]))
    .orderBy(asc(s.employees.fullName));
  const stages = await db.select().from(s.stages).orderBy(asc(s.stages.order));
  const years = await db.select().from(s.academicYears).orderBy(asc(s.academicYears.startDate));
  return {
    school,
    principalNameStatus: ((identity?.value as { principalName?: string } | undefined)?.principalName ?? "PENDING_VERIFICATION") as "PENDING_VERIFICATION" | "COMPLETE",
    leadership: LEADERSHIP_POSITIONS.map((p) => ({ position: p, current: current.find((c) => c.position === p) ?? null })),
    candidates,
    stages,
    years,
    canWrite: can(ctx, "settings.write"),
  };
}

export async function updateSchoolSettings(db: DB, ctx: AuthContext, raw: unknown) {
  requirePermission(ctx, "settings.write");
  const d = schoolSchema.parse(raw);
  const school = await getSchool(db);
  if (!school) throw new ValidationError("لا توجد مدرسة مُعرّفة");
  return db.transaction(async (tx) => {
    const { principalNameStatus, version, ...fields } = d;
    const after = await updateVersioned(tx, s.schools, school.id, version, { ...fields, updatedById: ctx.userId });
    const [prev] = await tx.select().from(s.schoolSettings).where(and(eq(s.schoolSettings.schoolId, school.id), eq(s.schoolSettings.key, IDENTITY_KEY)));
    await tx
      .insert(s.schoolSettings)
      .values({ schoolId: school.id, key: IDENTITY_KEY, value: { principalName: principalNameStatus }, updatedById: ctx.userId })
      .onConflictDoUpdate({ target: [s.schoolSettings.schoolId, s.schoolSettings.key], set: { value: { principalName: principalNameStatus }, updatedById: ctx.userId, updatedAt: new Date() } });
    await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "school", entityId: school.id, before: { school, identity: prev?.value ?? null }, after: { school: after, identity: { principalName: principalNameStatus } } });
    return after;
  });
}

export async function updateLeadership(db: DB, ctx: AuthContext, raw: unknown) {
  requirePermission(ctx, "settings.write");
  const d = leadershipSchema.parse(raw);
  return db.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(s.employeeAssignments)
      .where(and(eq(s.employeeAssignments.position, d.position), eq(s.employeeAssignments.isActive, true)));
    const cur = current[0] ?? null;
    // إن تغيّر شاغل المنصب منذ فتح الصفحة نرفض الحفظ (لا ضياع لتعديل مستخدمة أخرى)
    if ((cur?.id ?? null) !== d.currentAssignmentId) throw new StaleRecordError();
    if (d.employeeId) {
      const [emp] = await tx.select({ id: s.employees.id }).from(s.employees).where(eq(s.employees.id, d.employeeId));
      if (!emp) throw new ValidationError("الموظفة غير موجودة", "employeeId");
    }
    const today = riyadhNow().date;
    let after: typeof s.employeeAssignments.$inferSelect | null = null;
    if (cur && cur.employeeId === d.employeeId) {
      [after] = await tx.update(s.employeeAssignments).set({ titleAr: d.titleAr, duties: d.duties }).where(eq(s.employeeAssignments.id, cur.id)).returning();
    } else {
      if (cur) await tx.update(s.employeeAssignments).set({ isActive: false, endDate: today }).where(eq(s.employeeAssignments.id, cur.id));
      if (d.employeeId) {
        const year = await getActiveYear(tx as unknown as DB);
        [after] = await tx
          .insert(s.employeeAssignments)
          .values({ employeeId: d.employeeId, position: d.position, titleAr: d.titleAr, duties: d.duties, yearId: year?.id ?? null, startDate: today })
          .returning();
      }
    }
    await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "leadership", entityId: d.position, before: cur, after });
    return after;
  });
}
