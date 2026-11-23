/**
 * الاستئذان: وقت الطلب، وقت الخروج، حالة الطلب، والاعتماد بصلاحية leave.approve.
 * المسار: قيد الاعتماد → معتمد/مرفوض → (عند الخروج) مكتمل. الإلغاء بالحالة دون حذف.
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { can, requirePermission, stageScope, type AuthContext } from "@/auth/rbac";
import { ConflictError, StaleRecordError } from "@/domain/conflicts";
import { hhmmToMinutes, riyadhNow } from "@/domain/time";
import { writeAudit } from "../audit";
import { updateVersioned } from "../versioned";
import { stageFilter } from "../scope-sql";
import { isoDate, optText, reqText, reqUuid, ValidationError, versionField } from "../forms";
import { dbConstraint, sectionStage } from "./affairs-common";

const time = (label: string) =>
  z.string({ error: `${label} مطلوب` }).regex(/^\d{1,2}:\d{2}$/, { error: `${label} بصيغة ساعة:دقيقة` }).transform((v, c) => {
    try {
      return hhmmToMinutes(v);
    } catch {
      c.addIssue({ code: "custom", message: `${label} غير صالح` });
      return z.NEVER;
    }
  });

export const leaveSchema = z.object({ sectionId: reqUuid("الفصل"), studentId: reqUuid("الطالبة"), date: isoDate("التاريخ"), requestTime: time("وقت الاستئذان"), reason: reqText("سبب الاستئذان", 300), notes: optText(300) });
export const leaveDecisionSchema = z.object({ version: versionField, decision: z.enum(["APPROVED", "REJECTED"], { error: "القرار غير صالح" }), notes: optText(300) });
export const leaveExitSchema = z.object({ version: versionField, exitTime: time("وقت الخروج") });

async function loadLeave(tx: Pick<DB, "select">, id: string) {
  const [r] = await tx
    .select({ l: s.studentLeaveRequests, stageId: s.grades.stageId })
    .from(s.studentLeaveRequests)
    .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.id, s.studentLeaveRequests.enrollmentId))
    .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .where(eq(s.studentLeaveRequests.id, id));
  if (!r) throw new ValidationError("الطلب غير موجود");
  return r;
}

export async function createLeave(db: DB, ctx: AuthContext, raw: unknown) {
  const d = leaveSchema.parse(raw);
  const sec = await sectionStage(db, d.sectionId);
  requirePermission(ctx, "leave.write", sec.stageId);
  if (d.date > riyadhNow().date) throw new ValidationError("لا يُسجَّل استئذان لتاريخ في المستقبل", "date");
  const [enr] = await db.select().from(s.studentEnrollments).where(and(eq(s.studentEnrollments.studentId, d.studentId), eq(s.studentEnrollments.sectionId, d.sectionId), eq(s.studentEnrollments.status, "ACTIVE")));
  if (!enr) throw new ValidationError("الطالبة ليست منتظمة في هذا الفصل", "studentId");
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(s.studentLeaveRequests).values({ studentId: d.studentId, enrollmentId: enr.id, date: d.date, requestMinute: d.requestTime, reason: d.reason, notes: d.notes, requestedById: ctx.userId }).returning();
      await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "leave", entityId: row.id, after: row });
      return row;
    });
  } catch (e) {
    if (dbConstraint(e) === "leave_active_uq") throw new ConflictError("للطالبة استئذان مسجّل في هذا اليوم.");
    throw e;
  }
}

export async function decideLeave(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  const d = leaveDecisionSchema.parse(raw);
  return db.transaction(async (tx) => {
    const { l, stageId } = await loadLeave(tx, id);
    requirePermission(ctx, "leave.approve", stageId);
    if (l.version !== d.version) throw new StaleRecordError();
    if (l.status !== "PENDING") throw new ValidationError("يُبتّ في الطلب وهو قيد الاعتماد فقط");
    const after = await updateVersioned(tx, s.studentLeaveRequests, id, d.version, { status: d.decision, approvedById: ctx.userId, approvedAt: new Date(), notes: d.notes ?? l.notes });
    await writeAudit(tx, { actorId: ctx.userId, action: d.decision === "APPROVED" ? "approve" : "reject", entityType: "leave", entityId: id, before: l, after });
    return after;
  });
}

export async function recordLeaveExit(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  const d = leaveExitSchema.parse(raw);
  return db.transaction(async (tx) => {
    const { l, stageId } = await loadLeave(tx, id);
    requirePermission(ctx, "leave.write", stageId);
    if (l.version !== d.version) throw new StaleRecordError();
    if (l.status !== "APPROVED") throw new ValidationError("يُسجَّل الخروج بعد اعتماد الطلب فقط");
    if (d.exitTime < l.requestMinute) throw new ValidationError("وقت الخروج قبل وقت الاستئذان", "exitTime");
    const after = await updateVersioned(tx, s.studentLeaveRequests, id, d.version, { status: "COMPLETED", exitMinute: d.exitTime });
    await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "leave", entityId: id, before: l, after });
    return after;
  });
}

export async function cancelLeave(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  const { version } = z.object({ version: versionField }).parse(raw);
  return db.transaction(async (tx) => {
    const { l, stageId } = await loadLeave(tx, id);
    requirePermission(ctx, "leave.write", stageId);
    if (l.version !== version) throw new StaleRecordError();
    if (!["PENDING", "APPROVED"].includes(l.status)) throw new ValidationError("لا يُلغى طلب مكتمل أو مرفوض");
    const after = await updateVersioned(tx, s.studentLeaveRequests, id, version, { status: "CANCELLED" });
    await writeAudit(tx, { actorId: ctx.userId, action: "cancel", entityType: "leave", entityId: id, before: l, after });
    return after;
  });
}

export async function listLeaves(db: DB, ctx: AuthContext, date: string) {
  const scope = stageScope(ctx, "leave.read");
  if (scope.kind === "none") return [];
  const rows = await db
    .select({ l: s.studentLeaveRequests, fullName: s.students.fullName, grade: s.grades.nameAr, section: s.classSections.name, stageId: s.stages.id, stageName: s.stages.nameAr, requestedBy: s.users.displayName })
    .from(s.studentLeaveRequests)
    .innerJoin(s.students, eq(s.students.id, s.studentLeaveRequests.studentId))
    .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.id, s.studentLeaveRequests.enrollmentId))
    .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .innerJoin(s.stages, eq(s.stages.id, s.grades.stageId))
    .innerJoin(s.users, eq(s.users.id, s.studentLeaveRequests.requestedById))
    .where(and(eq(s.studentLeaveRequests.date, date), stageFilter(scope, s.stages.id)))
    .orderBy(asc(s.studentLeaveRequests.requestMinute));
  return rows.map((r) => ({ ...r, canWrite: can(ctx, "leave.write", r.stageId), canApprove: can(ctx, "leave.approve", r.stageId) }));
}

/** طلبات استئذان الطالبة (السجل التاريخي) ضمن مراحل الصلاحية */
export async function studentLeaves(db: DB, ctx: AuthContext, studentId: string) {
  const rows = await db
    .select({ l: s.studentLeaveRequests, stageId: s.grades.stageId })
    .from(s.studentLeaveRequests)
    .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.id, s.studentLeaveRequests.enrollmentId))
    .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .where(eq(s.studentLeaveRequests.studentId, studentId))
    .orderBy(asc(s.studentLeaveRequests.date));
  return rows.filter((r) => can(ctx, "leave.read", r.stageId)).map((r) => r.l);
}
