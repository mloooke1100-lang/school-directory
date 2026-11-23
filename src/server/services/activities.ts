/**
 * الأنشطة وجلساتها: النشاط، الفصل أو المجموعة، المشرفة، التاريخ، الوقت، الموقع، الحالة.
 * تمنع: انشغال المشرفة، وحجز القاعة لأكثر من نشاط/حصة في الوقت نفسه، ونشاطين للفصل نفسه في وقت واحد.
 */
import { and, asc, between, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { can, ForbiddenError, requirePermission, stageScope, type AuthContext } from "@/auth/rbac";
import { ConflictError, overlaps, StaleRecordError } from "@/domain/conflicts";
import { dayOfWeekOf, describeCommitments, overlapping, type Commitment } from "@/domain/schedule";
import { hhmmToMinutes } from "@/domain/time";
import { writeAudit } from "../audit";
import { updateVersioned } from "../versioned";
import { checkbox, isoDate, optText, optUuid, reqText, reqUuid, ValidationError, versionField } from "../forms";
import { getTermForDate } from "../school";
import { commitmentsOnDate, roomWeeklyUse } from "./schedule";

const time = (label: string) =>
  z.string({ error: `${label} مطلوب` }).regex(/^\d{1,2}:\d{2}$/, { error: `${label} بصيغة ساعة:دقيقة` }).transform((v, c) => {
    try {
      return hhmmToMinutes(v);
    } catch {
      c.addIssue({ code: "custom", message: `${label} غير صالح` });
      return z.NEVER;
    }
  });

export const activitySchema = z.object({ name: reqText("اسم النشاط", 120), stageId: optUuid(), description: optText(1000) });
export const activityUpdateSchema = activitySchema.extend({ version: versionField, isActive: checkbox });
export const sessionSchema = z.object({
  activityId: reqUuid("النشاط"),
  date: isoDate("التاريخ"),
  start: time("وقت البداية"),
  end: time("وقت النهاية"),
  sectionId: optUuid(),
  groupName: optText(120),
  supervisorId: reqUuid("المشرفة"),
  roomId: optUuid(),
  location: optText(200),
  notes: optText(500),
});
export const sessionUpdateSchema = z.object({ version: versionField, status: z.enum(s.assignmentStatus.enumValues, { error: "الحالة غير صالحة" }), notes: optText(500) });

/** صلاحية على نشاط: نشاط عام (بلا مرحلة) يتطلب الصلاحية على كل المراحل */
function requireActivity(ctx: AuthContext, perm: "activities.read" | "activities.write", stageId: string | null) {
  requirePermission(ctx, perm, stageId);
}

export async function createActivity(db: DB, ctx: AuthContext, raw: unknown) {
  const d = activitySchema.parse(raw);
  requireActivity(ctx, "activities.write", d.stageId);
  return db.transaction(async (tx) => {
    const [a] = await tx.insert(s.activities).values(d).returning();
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "activity", entityId: a.id, after: a });
    return a;
  });
}

export async function updateActivity(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  const d = activityUpdateSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.activities).where(eq(s.activities.id, id));
    if (!before) throw new ValidationError("النشاط غير موجود");
    requireActivity(ctx, "activities.write", before.stageId);
    requireActivity(ctx, "activities.write", d.stageId);
    const after = await updateVersioned(tx, s.activities, id, d.version, { name: d.name, stageId: d.stageId, description: d.description, isActive: d.isActive });
    await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "activity", entityId: id, before, after });
    return after;
  });
}

export async function listActivities(db: DB, ctx: AuthContext) {
  const scope = stageScope(ctx, "activities.read");
  if (scope.kind === "none") throw new ForbiddenError();
  const rows = await db.select({ a: s.activities, stageName: s.stages.nameAr }).from(s.activities).leftJoin(s.stages, eq(s.stages.id, s.activities.stageId)).orderBy(asc(s.activities.name));
  return rows
    .filter((r) => r.a.stageId === null || can(ctx, "activities.read", r.a.stageId)) // النشاط العام يظهر لكل من تملك الاطلاع
    .map((r) => ({ ...r.a, stageName: r.stageName, canWrite: can(ctx, "activities.write", r.a.stageId) }));
}

async function sessionConflicts(db: DB, d: z.infer<typeof sessionSchema>, excludeSessionId?: string): Promise<string[]> {
  const range = { startMinute: d.start, endMinute: d.end };
  const term = await getTermForDate(db, d.date);
  const day = dayOfWeekOf(d.date);
  const problems: string[] = [];
  // المشرفة
  const busy = term ? overlapping(await commitmentsOnDate(db, term.id, d.supervisorId, d.date, day), range, excludeSessionId ? [excludeSessionId] : []) : [];
  if (busy.length) problems.push(`المشرفة مكلفة في الوقت نفسه — ${describeCommitments(busy).join("؛ ")}`);
  // جلسات أخرى في اليوم نفسه (القاعة والفصل)
  const others = await db
    .select({ id: s.activitySessions.id, startMinute: s.activitySessions.startMinute, endMinute: s.activitySessions.endMinute, roomId: s.activitySessions.roomId, sectionId: s.activitySessions.sectionId, name: s.activities.name })
    .from(s.activitySessions)
    .innerJoin(s.activities, eq(s.activities.id, s.activitySessions.activityId))
    .where(and(eq(s.activitySessions.date, d.date), ne(s.activitySessions.status, "CANCELLED")));
  for (const o of others) {
    if (o.id === excludeSessionId || !overlaps(o, range)) continue;
    if (d.roomId && o.roomId === d.roomId) problems.push(`القاعة محجوزة لنشاط «${o.name}» في الوقت نفسه`);
    if (d.sectionId && o.sectionId === d.sectionId) problems.push(`للفصل نشاط «${o.name}» في الوقت نفسه`);
  }
  // القاعة في الجدول المعتمد
  if (d.roomId && term && day <= 4) {
    const lessons: Commitment[] = overlapping(await roomWeeklyUse(db, term.id, d.roomId, day), range);
    if (lessons.length) problems.push(`القاعة محجوزة لحصة في الجدول — ${describeCommitments(lessons).join("؛ ")}`);
  }
  return problems;
}

export async function createSession(db: DB, ctx: AuthContext, raw: unknown) {
  const d = sessionSchema.parse(raw);
  if (d.end <= d.start) throw new ValidationError("وقت النهاية يجب أن يكون بعد البداية", "end");
  if (!d.sectionId && !d.groupName) throw new ValidationError("حدّدي الفصل أو اسم المجموعة", "sectionId");
  const [act] = await db.select().from(s.activities).where(eq(s.activities.id, d.activityId));
  if (!act || !act.isActive) throw new ValidationError("النشاط غير موجود أو غير نشط", "activityId");
  requireActivity(ctx, "activities.write", act.stageId);
  if (d.sectionId) {
    const [sec] = await db.select({ stageId: s.grades.stageId }).from(s.classSections).innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId)).where(eq(s.classSections.id, d.sectionId));
    if (!sec) throw new ValidationError("الفصل غير موجود", "sectionId");
    if (act.stageId && sec.stageId !== act.stageId) throw new ValidationError("الفصل لا يتبع مرحلة النشاط", "sectionId");
    requirePermission(ctx, "activities.write", sec.stageId);
  }
  const [sup] = await db.select().from(s.employees).where(eq(s.employees.id, d.supervisorId));
  if (!sup || sup.status !== "ACTIVE") throw new ValidationError("المشرفة غير موجودة أو ليست على رأس العمل", "supervisorId");
  const problems = await sessionConflicts(db, d);
  if (problems.length) throw new ConflictError(`تعارض: ${problems.join("؛ ")}`, problems);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.activitySessions)
      .values({ activityId: d.activityId, date: d.date, startMinute: d.start, endMinute: d.end, sectionId: d.sectionId, groupName: d.groupName, supervisorId: d.supervisorId, roomId: d.roomId, location: d.location, notes: d.notes, createdById: ctx.userId })
      .returning();
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "activity_session", entityId: row.id, after: row });
    return row;
  });
}

export async function updateSession(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  const d = sessionUpdateSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ x: s.activitySessions, stageId: s.activities.stageId }).from(s.activitySessions).innerJoin(s.activities, eq(s.activities.id, s.activitySessions.activityId)).where(eq(s.activitySessions.id, id));
    if (!before) throw new ValidationError("الجلسة غير موجودة");
    requireActivity(ctx, "activities.write", before.stageId);
    if (before.x.version !== d.version) throw new StaleRecordError();
    if (before.x.status === "CANCELLED" && d.status !== "CANCELLED") throw new ValidationError("الجلسة الملغاة لا يُعاد تفعيلها؛ أنشئي جلسة جديدة", "status");
    const after = await updateVersioned(tx, s.activitySessions, id, d.version, { status: d.status, notes: d.notes });
    await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "activity_session", entityId: id, before: before.x, after });
    return after;
  });
}

export async function listSessions(db: DB, ctx: AuthContext, from: string, to: string) {
  const scope = stageScope(ctx, "activities.read");
  if (scope.kind === "none") throw new ForbiddenError();
  const rows = await db
    .select({ x: s.activitySessions, name: s.activities.name, stageId: s.activities.stageId, stageName: s.stages.nameAr, supervisor: s.employees.fullName, room: s.rooms.name, grade: s.grades.nameAr, section: s.classSections.name })
    .from(s.activitySessions)
    .innerJoin(s.activities, eq(s.activities.id, s.activitySessions.activityId))
    .innerJoin(s.employees, eq(s.employees.id, s.activitySessions.supervisorId))
    .leftJoin(s.stages, eq(s.stages.id, s.activities.stageId))
    .leftJoin(s.rooms, eq(s.rooms.id, s.activitySessions.roomId))
    .leftJoin(s.classSections, eq(s.classSections.id, s.activitySessions.sectionId))
    .leftJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .where(between(s.activitySessions.date, from, to))
    .orderBy(asc(s.activitySessions.date), asc(s.activitySessions.startMinute));
  return rows
    .filter((r) => (r.stageId ? can(ctx, "activities.read", r.stageId) : true))
    .map((r) => ({ ...r.x, name: r.name, stageName: r.stageName, supervisor: r.supervisor, room: r.room, section: r.grade ? `${r.grade} / ${r.section}` : null, canWrite: can(ctx, "activities.write", r.stageId) }));
}
