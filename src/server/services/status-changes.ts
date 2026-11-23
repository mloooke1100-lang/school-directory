/**
 * الانقطاع والنقل والانسحاب وإعادة القيد: طلب بالتاريخ والمرجع الإداري، ثم اعتماد بصلاحية status_changes.approve.
 * - لا تتغير حالة القيد إلا عند الاعتماد، ولا تحويل آلي أبدًا (مهما بلغ الغياب).
 * - لا يُحذف سجل الطالبة عند انتقالها؛ يبقى بقيدها وحالته.
 * - طلب واحد قيد الاعتماد لكل قيد.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { can, requirePermission, stageScope, type AuthContext } from "@/auth/rbac";
import { ConflictError, StaleRecordError } from "@/domain/conflicts";
import { writeAudit } from "../audit";
import { updateVersioned } from "../versioned";
import { stageFilter } from "../scope-sql";
import { isoDate, optText, reqUuid, ValidationError, versionField } from "../forms";
import { activeYearEnrollment, dbConstraint } from "./affairs-common";

export const STATUS_EFFECT = { DROPOUT: "DROPPED_OUT", TRANSFER_OUT: "TRANSFERRED_OUT", WITHDRAWAL: "WITHDRAWN", REINSTATEMENT: "ACTIVE" } as const;

export const statusChangeSchema = z.object({
  studentId: reqUuid("الطالبة"),
  type: z.enum(["DROPOUT", "TRANSFER_OUT", "WITHDRAWAL", "REINSTATEMENT"], { error: "نوع الإجراء غير صالح" }),
  effectiveDate: isoDate("تاريخ السريان"),
  reference: optText(200),
  destinationSchool: optText(200),
  notes: optText(500),
});
export const decisionSchema = z.object({ version: versionField, decision: z.enum(["APPROVED", "REJECTED"], { error: "القرار غير صالح" }), notes: optText(500) });

export async function createStatusChange(db: DB, ctx: AuthContext, raw: unknown) {
  const d = statusChangeSchema.parse(raw);
  const enr = await activeYearEnrollment(db, d.studentId);
  requirePermission(ctx, "status_changes.write", enr.stageId);
  if (d.type === "DROPOUT" && !d.reference) throw new ValidationError("الانقطاع يتطلب المرجع الإداري (رقم الخطاب أو القرار)", "reference");
  if (d.type === "TRANSFER_OUT" && !d.destinationSchool) throw new ValidationError("النقل يتطلب اسم المدرسة المنقول إليها", "destinationSchool");
  if (d.type === "REINSTATEMENT" && enr.status === "ACTIVE") throw new ValidationError("الطالبة منتظمة أصلًا", "type");
  if (d.type !== "REINSTATEMENT" && enr.status !== "ACTIVE") throw new ValidationError("الإجراء يتطلب أن تكون الطالبة منتظمة حاليًا", "type");
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(s.studentStatusChanges).values({ studentId: d.studentId, enrollmentId: enr.id, type: d.type, effectiveDate: d.effectiveDate, reference: d.reference, destinationSchool: d.destinationSchool, notes: d.notes, requestedById: ctx.userId }).returning();
      await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "status_change", entityId: row.id, after: row });
      return row;
    });
  } catch (e) {
    if (dbConstraint(e) === "status_change_pending_uq") throw new ConflictError("للطالبة طلب آخر قيد الاعتماد؛ يُبتّ فيه أولًا.");
    throw e;
  }
}

/** الاعتماد يطبّق الحالة على القيد في المعاملة نفسها؛ الرفض لا يغيّر القيد */
export async function decideStatusChange(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  const d = decisionSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({ c: s.studentStatusChanges, stageId: s.grades.stageId, enrollment: s.studentEnrollments })
      .from(s.studentStatusChanges)
      .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.id, s.studentStatusChanges.enrollmentId))
      .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
      .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
      .where(eq(s.studentStatusChanges.id, id));
    if (!r) throw new ValidationError("الطلب غير موجود");
    requirePermission(ctx, "status_changes.approve", r.stageId);
    if (r.c.version !== d.version) throw new StaleRecordError();
    if (r.c.status !== "PENDING") throw new ValidationError("يُبتّ في الطلب وهو قيد الاعتماد فقط");
    const after = await updateVersioned(tx, s.studentStatusChanges, id, d.version, { status: d.decision, approvedById: ctx.userId, approvedAt: new Date(), notes: d.notes ?? r.c.notes });
    let enrollmentAfter = null;
    if (d.decision === "APPROVED") {
      const target = STATUS_EFFECT[r.c.type as keyof typeof STATUS_EFFECT];
      if (!target) throw new ValidationError("نوع إجراء غير مدعوم");
      [enrollmentAfter] = await tx.update(s.studentEnrollments).set({ status: target, version: sql`${s.studentEnrollments.version} + 1`, updatedById: ctx.userId }).where(eq(s.studentEnrollments.id, r.c.enrollmentId)).returning();
    }
    await writeAudit(tx, { actorId: ctx.userId, action: d.decision === "APPROVED" ? "approve" : "reject", entityType: "status_change", entityId: id, before: { change: r.c, enrollment: r.enrollment }, after: { change: after, enrollment: enrollmentAfter } });
    return after;
  });
}

export async function listStatusChanges(db: DB, ctx: AuthContext, f: { pendingOnly?: boolean; studentId?: string } = {}) {
  const scope = stageScope(ctx, "status_changes.read");
  if (scope.kind === "none") return [];
  const rows = await db
    .select({ c: s.studentStatusChanges, fullName: s.students.fullName, grade: s.grades.nameAr, section: s.classSections.name, stageId: s.stages.id, stageName: s.stages.nameAr, requestedBy: s.users.displayName })
    .from(s.studentStatusChanges)
    .innerJoin(s.students, eq(s.students.id, s.studentStatusChanges.studentId))
    .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.id, s.studentStatusChanges.enrollmentId))
    .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .innerJoin(s.stages, eq(s.stages.id, s.grades.stageId))
    .innerJoin(s.users, eq(s.users.id, s.studentStatusChanges.requestedById))
    .where(and(stageFilter(scope, s.stages.id), f.pendingOnly ? eq(s.studentStatusChanges.status, "PENDING") : sql`true`, f.studentId ? eq(s.studentStatusChanges.studentId, f.studentId) : sql`true`))
    .orderBy(desc(s.studentStatusChanges.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r, canApprove: can(ctx, "status_changes.approve", r.stageId) }));
}
