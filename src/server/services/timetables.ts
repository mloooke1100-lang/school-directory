/**
 * أوقات الحصص والجداول الأسبوعية.
 * - أوقات الحصص تُعدّ لكل مرحلة وفصل دراسي (ويمكن تعريف يوم مختلف كالخميس)؛ لا أوقات مفترضة.
 * - الجدول يُبنى مسودةً، ثم يُعتمد؛ عند الاعتماد يصبح المعتمد السابق «مستبدلًا» ولا يُحذف.
 * - الجدول المعتمد لا يُعدَّل مباشرة: يُنسخ إلى مسودة جديدة ثم تُعتمد.
 * - التعارض داخل الجدول تمنعه قيود قاعدة البيانات، وبين المراحل يُفحص بالوقت الفعلي.
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { can, requirePermission, stageScope, type AuthContext } from "@/auth/rbac";
import { ConflictError } from "@/domain/conflicts";
import { validatePeriods, type PeriodDef } from "@/domain/periods";
import { describeCommitments, overlapping, slotTime } from "@/domain/schedule";
import { hhmmToMinutes, riyadhNow } from "@/domain/time";
import { writeAudit } from "../audit";
import { updateVersioned } from "../versioned";
import { stageFilter } from "../scope-sql";
import { optText, optUuid, reqText, reqUuid, ValidationError, versionField } from "../forms";
import { loadPeriodDefs, roomWeeklyUse, weeklyCommitments } from "./schedule";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const hhmm = (label: string) =>
  z
    .string({ error: `${label} مطلوب` })
    .regex(/^\d{1,2}:\d{2}$/, { error: `${label} بصيغة ساعة:دقيقة مثل 07:15` })
    .transform((v, c) => {
      try {
        return hhmmToMinutes(v);
      } catch {
        c.addIssue({ code: "custom", message: `${label} غير صالح` });
        return z.NEVER;
      }
    });

const dayField = z
  .union([z.literal(""), z.coerce.number().int().min(0).max(6)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

export const periodSchema = z.object({
  termId: reqUuid("الفصل الدراسي"),
  stageId: reqUuid("المرحلة"),
  dayOfWeek: dayField,
  number: z.coerce.number({ error: "رقم الفترة مطلوب" }).int().min(1, { error: "رقم الفترة من 1 فأكثر" }).max(99),
  kind: z.enum(s.periodKind.enumValues, { error: "نوع الفترة غير صالح" }),
  label: optText(60),
  start: hhmm("وقت البداية"),
  end: hhmm("وقت النهاية"),
});
export const periodUpdateSchema = periodSchema.omit({ termId: true, stageId: true }).extend({ version: versionField });

export const timetableCreateSchema = z.object({ termId: reqUuid("الفصل الدراسي"), stageId: reqUuid("المرحلة"), name: reqText("اسم الجدول", 120) });

export const entrySchema = z.object({
  dayOfWeek: z.coerce.number({ error: "اختاري اليوم" }).int().min(0).max(4, { error: "أيام الدراسة من الأحد إلى الخميس" }),
  periodNumber: z.coerce.number({ error: "اختاري الحصة" }).int().min(1),
  kind: z.enum(s.entryKind.enumValues, { error: "نوع الخانة غير صالح" }).default("LESSON"),
  sectionId: optUuid(),
  subjectId: optUuid(),
  teacherId: reqUuid("المعلمة"),
  roomId: optUuid(),
  notes: optText(300),
});

// ───── أوقات الحصص ─────

async function checkPeriodSet(tx: Tx, termId: string, stageId: string, dayOfWeek: number | null, candidate: PeriodDef, excludeId?: string) {
  const rows = await tx
    .select()
    .from(s.periodDefinitions)
    .where(and(eq(s.periodDefinitions.termId, termId), eq(s.periodDefinitions.stageId, stageId), dayOfWeek === null ? sql`${s.periodDefinitions.dayOfWeek} IS NULL` : eq(s.periodDefinitions.dayOfWeek, dayOfWeek)));
  const set = rows.filter((r) => r.id !== excludeId).map((r) => ({ number: r.number, kind: r.kind, label: r.label, startMinute: r.startMinute, endMinute: r.endMinute }));
  const errs = validatePeriods([...set, candidate]);
  if (errs.length) throw new ConflictError(`تعارض في أوقات الحصص: ${errs.join("، ")}`, errs);
}

export async function listPeriods(db: DB, ctx: AuthContext, termId: string, stageId: string) {
  requirePermission(ctx, "timetable.read", stageId);
  return db
    .select()
    .from(s.periodDefinitions)
    .where(and(eq(s.periodDefinitions.termId, termId), eq(s.periodDefinitions.stageId, stageId)))
    .orderBy(sql`coalesce(${s.periodDefinitions.dayOfWeek}, -1)`, asc(s.periodDefinitions.startMinute));
}

export async function createPeriod(db: DB, ctx: AuthContext, raw: unknown) {
  const d = periodSchema.parse(raw);
  requirePermission(ctx, "timetable.write", d.stageId);
  if (d.end <= d.start) throw new ValidationError("وقت النهاية يجب أن يكون بعد وقت البداية", "end");
  if (d.dayOfWeek !== null && d.dayOfWeek > 4) throw new ValidationError("أيام الدراسة من الأحد إلى الخميس", "dayOfWeek");
  return db.transaction(async (tx) => {
    await checkPeriodSet(tx, d.termId, d.stageId, d.dayOfWeek, { number: d.number, kind: d.kind, label: d.label, startMinute: d.start, endMinute: d.end });
    const [row] = await tx
      .insert(s.periodDefinitions)
      .values({ termId: d.termId, stageId: d.stageId, dayOfWeek: d.dayOfWeek, number: d.number, kind: d.kind, label: d.label, startMinute: d.start, endMinute: d.end, updatedById: ctx.userId })
      .returning();
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "period", entityId: row.id, after: row });
    return row;
  });
}

export async function updatePeriod(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  const d = periodUpdateSchema.parse(raw);
  if (d.end <= d.start) throw new ValidationError("وقت النهاية يجب أن يكون بعد وقت البداية", "end");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.periodDefinitions).where(eq(s.periodDefinitions.id, id));
    if (!before) throw new ValidationError("الفترة غير موجودة");
    requirePermission(ctx, "timetable.write", before.stageId);
    await checkPeriodSet(tx, before.termId, before.stageId, d.dayOfWeek, { number: d.number, kind: d.kind, label: d.label, startMinute: d.start, endMinute: d.end }, id);
    const after = await updateVersioned(tx, s.periodDefinitions, id, d.version, { dayOfWeek: d.dayOfWeek, number: d.number, kind: d.kind, label: d.label, startMinute: d.start, endMinute: d.end, updatedById: ctx.userId });
    await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "period", entityId: id, before, after });
    return after;
  });
}

/** حذف تعريف فترة: مسموح فقط إن لم تستخدم رقمَها خاناتُ جدول معتمد أو مسودة لتلك المرحلة */
export async function deletePeriod(db: DB, ctx: AuthContext, id: string) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.periodDefinitions).where(eq(s.periodDefinitions.id, id));
    if (!before) throw new ValidationError("الفترة غير موجودة");
    requirePermission(ctx, "timetable.write", before.stageId);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(s.timetableEntries)
      .innerJoin(s.weeklyTimetables, eq(s.weeklyTimetables.id, s.timetableEntries.timetableId))
      .where(and(eq(s.weeklyTimetables.termId, before.termId), eq(s.weeklyTimetables.stageId, before.stageId), ne(s.weeklyTimetables.status, "SUPERSEDED"), eq(s.timetableEntries.periodNumber, before.number), before.dayOfWeek === null ? sql`true` : eq(s.timetableEntries.dayOfWeek, before.dayOfWeek)));
    if (n > 0) throw new ValidationError(`لا يمكن حذف الفترة ${before.number}: تستخدمها ${n} خانة في الجداول الحالية. عدّلي وقتها بدل حذفها.`);
    await tx.delete(s.periodDefinitions).where(eq(s.periodDefinitions.id, id));
    await writeAudit(tx, { actorId: ctx.userId, action: "delete", entityType: "period", entityId: id, before });
  });
}

// ───── الجداول ─────

export async function listTimetables(db: DB, ctx: AuthContext, termId: string) {
  const scope = stageScope(ctx, "timetable.read");
  const rows = await db
    .select({ t: s.weeklyTimetables, stageName: s.stages.nameAr, stageOrder: s.stages.order, entries: sql<number>`(SELECT count(*)::int FROM ${s.timetableEntries} WHERE ${s.timetableEntries.timetableId} = ${s.weeklyTimetables.id})` })
    .from(s.weeklyTimetables)
    .innerJoin(s.stages, eq(s.stages.id, s.weeklyTimetables.stageId))
    .where(and(eq(s.weeklyTimetables.termId, termId), stageFilter(scope, s.stages.id)))
    .orderBy(asc(s.stages.order), asc(s.weeklyTimetables.createdAt));
  return rows.map((r) => ({ ...r.t, stageName: r.stageName, entries: r.entries, canWrite: can(ctx, "timetable.write", r.t.stageId), canApprove: can(ctx, "timetable.approve", r.t.stageId) }));
}

export async function createTimetable(db: DB, ctx: AuthContext, raw: unknown) {
  const d = timetableCreateSchema.parse(raw);
  requirePermission(ctx, "timetable.write", d.stageId);
  return db.transaction(async (tx) => {
    const [t] = await tx.insert(s.weeklyTimetables).values({ ...d, status: "DRAFT", createdById: ctx.userId }).returning();
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "timetable", entityId: t.id, after: t });
    return t;
  });
}

/** نسخ جدول (عادة المعتمد) إلى مسودة جديدة لتعديله دون المساس بالمعتمد */
export async function copyToDraft(db: DB, ctx: AuthContext, sourceId: string) {
  return db.transaction(async (tx) => {
    const [src] = await tx.select().from(s.weeklyTimetables).where(eq(s.weeklyTimetables.id, sourceId));
    if (!src) throw new ValidationError("الجدول غير موجود");
    requirePermission(ctx, "timetable.write", src.stageId);
    const [t] = await tx
      .insert(s.weeklyTimetables)
      .values({ termId: src.termId, stageId: src.stageId, name: `${src.name.replace(/ \(مسودة\)$/, "")} (مسودة)`, status: "DRAFT", sourceTimetableId: src.id, createdById: ctx.userId })
      .returning();
    const entries = await tx.select().from(s.timetableEntries).where(eq(s.timetableEntries.timetableId, sourceId));
    if (entries.length)
      await tx.insert(s.timetableEntries).values(entries.map((e) => ({ timetableId: t.id, dayOfWeek: e.dayOfWeek, periodNumber: e.periodNumber, kind: e.kind, sectionId: e.sectionId, subjectId: e.subjectId, teacherId: e.teacherId, roomId: e.roomId, notes: e.notes, updatedById: ctx.userId })));
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "timetable", entityId: t.id, after: { ...t, copiedFrom: sourceId, entries: entries.length } });
    return t;
  });
}

async function requireDraft(tx: Pick<DB, "select">, ctx: AuthContext, timetableId: string) {
  const [t] = await tx.select().from(s.weeklyTimetables).where(eq(s.weeklyTimetables.id, timetableId));
  if (!t) throw new ValidationError("الجدول غير موجود");
  requirePermission(ctx, "timetable.write", t.stageId);
  if (t.status !== "DRAFT") throw new ValidationError("الجدول المعتمد لا يُعدَّل مباشرة؛ انسخيه إلى مسودة ثم اعتمديها");
  return t;
}

/** يفحص خانة مقابل: أوقات المرحلة، صحة الفصل والمادة، وتعارض المعلمة والقاعة مع الجداول المعتمدة لمراحل أخرى */
async function validateEntry(tx: Tx, t: typeof s.weeklyTimetables.$inferSelect, d: z.infer<typeof entrySchema>) {
  const defs = await loadPeriodDefs(tx, t.termId, t.stageId);
  if (defs.length === 0) throw new ValidationError("أوقات الحصص غير مكتملة لهذه المرحلة؛ أعدّيها أولًا من «أوقات الحصص»");
  const slot = slotTime(defs, d.dayOfWeek, d.periodNumber);
  if (!slot) throw new ValidationError(`الحصة ${d.periodNumber} غير معرّفة في أوقات هذه المرحلة لهذا اليوم`, "periodNumber");
  if (d.kind === "LESSON" && (!d.sectionId || !d.subjectId)) throw new ValidationError("الحصة الأساسية تتطلب الفصل والمادة", d.sectionId ? "subjectId" : "sectionId");
  if (d.sectionId) {
    const [sec] = await tx
      .select({ stageId: s.grades.stageId, yearId: s.classSections.yearId })
      .from(s.classSections)
      .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
      .where(eq(s.classSections.id, d.sectionId));
    const [term] = await tx.select().from(s.academicTerms).where(eq(s.academicTerms.id, t.termId));
    if (!sec || sec.stageId !== t.stageId || sec.yearId !== term.yearId) throw new ValidationError("الفصل لا يتبع مرحلة الجدول وسنته", "sectionId");
  }
  if (d.subjectId) {
    const [sub] = await tx.select().from(s.subjects).where(eq(s.subjects.id, d.subjectId));
    if (!sub || (sub.stageId && sub.stageId !== t.stageId)) throw new ValidationError("المادة لا تتبع مرحلة الجدول", "subjectId");
  }
  const [teacher] = await tx.select().from(s.employees).where(eq(s.employees.id, d.teacherId));
  if (!teacher || teacher.status !== "ACTIVE") throw new ValidationError("المعلمة غير موجودة أو ليست على رأس العمل", "teacherId");
  // التعارض بين المراحل بالوقت الفعلي (الجداول المعتمدة الأخرى + مراقبة الأدوار)
  const [approved] = await tx.select({ id: s.weeklyTimetables.id }).from(s.weeklyTimetables).where(and(eq(s.weeklyTimetables.termId, t.termId), eq(s.weeklyTimetables.stageId, t.stageId), eq(s.weeklyTimetables.status, "APPROVED")));
  const exclude = [t.id, ...(approved ? [approved.id] : [])]; // المسودة ستحل محل المعتمد لنفس المرحلة
  const busy = overlapping(await weeklyCommitments(tx, t.termId, d.teacherId, d.dayOfWeek, exclude), slot);
  if (busy.length) throw new ConflictError(`تعارض: المعلمة مكلفة في الوقت نفسه — ${describeCommitments(busy).join("؛ ")}`);
  if (d.roomId) {
    const roomBusy = overlapping(await roomWeeklyUse(tx, t.termId, d.roomId, d.dayOfWeek, exclude), slot);
    if (roomBusy.length) throw new ConflictError(`تعارض: القاعة محجوزة في الوقت نفسه — ${describeCommitments(roomBusy).join("؛ ")}`);
  }
}

const ENTRY_CONSTRAINT_AR: Record<string, string> = {
  tt_teacher_slot_uq: "تعارض: المعلمة مكلفة بحصة أخرى في اليوم والحصة نفسيهما في هذا الجدول.",
  tt_section_slot_uq: "تعارض: الفصل مسند لحصة أخرى في اليوم والحصة نفسيهما.",
  tt_room_slot_uq: "تعارض: القاعة محجوزة لحصة أخرى في اليوم والحصة نفسيهما.",
};
/** يحوّل انتهاك قيود التعارض في قاعدة البيانات إلى رسالة واضحة */
function mapEntryConflict(e: unknown): never {
  const c = (e as { cause?: { code?: string; constraint?: string } })?.cause ?? (e as { code?: string; constraint?: string });
  if (c?.code === "23505" && c.constraint && ENTRY_CONSTRAINT_AR[c.constraint]) throw new ConflictError(ENTRY_CONSTRAINT_AR[c.constraint]);
  throw e;
}

export async function addEntry(db: DB, ctx: AuthContext, timetableId: string, raw: unknown) {
  const d = entrySchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const t = await requireDraft(tx, ctx, timetableId);
      await validateEntry(tx, t, d);
      const [row] = await tx.insert(s.timetableEntries).values({ timetableId, ...d, updatedById: ctx.userId }).returning();
      await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "timetable_entry", entityId: row.id, after: row });
      return row;
    });
  } catch (e) {
    mapEntryConflict(e);
  }
}

export async function updateEntry(db: DB, ctx: AuthContext, entryId: string, raw: unknown) {
  const d = entrySchema.extend({ version: versionField }).parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(s.timetableEntries).where(eq(s.timetableEntries.id, entryId));
      if (!before) throw new ValidationError("الخانة غير موجودة");
      const t = await requireDraft(tx, ctx, before.timetableId);
      await validateEntry(tx, t, d);
      const { version, ...vals } = d;
      const after = await updateVersioned(tx, s.timetableEntries, entryId, version, { ...vals, updatedById: ctx.userId });
      await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "timetable_entry", entityId: entryId, before, after });
      return after;
    });
  } catch (e) {
    mapEntryConflict(e);
  }
}

/** حذف خانة من مسودة فقط (الجداول المعتمدة والمستبدلة تبقى كما هي للأثر) */
export async function deleteEntry(db: DB, ctx: AuthContext, entryId: string) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.timetableEntries).where(eq(s.timetableEntries.id, entryId));
    if (!before) throw new ValidationError("الخانة غير موجودة");
    await requireDraft(tx, ctx, before.timetableId);
    await tx.delete(s.timetableEntries).where(eq(s.timetableEntries.id, entryId));
    await writeAudit(tx, { actorId: ctx.userId, action: "delete", entityType: "timetable_entry", entityId: entryId, before });
  });
}

/** اعتماد مسودة: فحص شامل للتعارض بين المراحل، ثم استبدال المعتمد السابق دون حذفه */
export async function approveTimetable(db: DB, ctx: AuthContext, timetableId: string, raw: unknown) {
  const { version } = z.object({ version: versionField }).parse(raw);
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(s.weeklyTimetables).where(eq(s.weeklyTimetables.id, timetableId));
    if (!t) throw new ValidationError("الجدول غير موجود");
    requirePermission(ctx, "timetable.approve", t.stageId);
    if (t.status !== "DRAFT") throw new ValidationError("يُعتمد الجدول وهو مسودة فقط");
    const entries = await tx.select().from(s.timetableEntries).where(eq(s.timetableEntries.timetableId, timetableId));
    if (entries.length === 0) throw new ValidationError("لا يمكن اعتماد جدول فارغ");
    const defs = await loadPeriodDefs(tx, t.termId, t.stageId);
    const [prev] = await tx.select().from(s.weeklyTimetables).where(and(eq(s.weeklyTimetables.termId, t.termId), eq(s.weeklyTimetables.stageId, t.stageId), eq(s.weeklyTimetables.status, "APPROVED")));
    const exclude = [t.id, ...(prev ? [prev.id] : [])];
    const problems: string[] = [];
    for (const e of entries) {
      const slot = slotTime(defs, e.dayOfWeek, e.periodNumber);
      if (!slot) {
        problems.push(`خانة اليوم ${e.dayOfWeek + 1} الحصة ${e.periodNumber}: الحصة غير معرّفة في الأوقات`);
        continue;
      }
      const busy = overlapping(await weeklyCommitments(tx, t.termId, e.teacherId, e.dayOfWeek, exclude), slot);
      if (busy.length) problems.push(...describeCommitments(busy).map((b) => `معلمة خانة الحصة ${e.periodNumber}: ${b}`));
    }
    if (problems.length) throw new ConflictError(`لا يمكن الاعتماد بسبب ${problems.length} تعارض: ${problems.slice(0, 3).join("؛ ")}`, problems);
    if (prev) await tx.update(s.weeklyTimetables).set({ status: "SUPERSEDED", version: sql`${s.weeklyTimetables.version} + 1` }).where(eq(s.weeklyTimetables.id, prev.id));
    const after = await updateVersioned(tx, s.weeklyTimetables, timetableId, version, { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date(), effectiveFrom: riyadhNow().date });
    await writeAudit(tx, { actorId: ctx.userId, action: "approve", entityType: "timetable", entityId: timetableId, before: { status: "DRAFT", superseded: prev?.id ?? null }, after });
    return after;
  });
}

export async function getTimetable(db: DB, ctx: AuthContext, id: string) {
  const [t] = await db.select({ t: s.weeklyTimetables, stageName: s.stages.nameAr, termName: s.academicTerms.name, yearId: s.academicTerms.yearId }).from(s.weeklyTimetables).innerJoin(s.stages, eq(s.stages.id, s.weeklyTimetables.stageId)).innerJoin(s.academicTerms, eq(s.academicTerms.id, s.weeklyTimetables.termId)).where(eq(s.weeklyTimetables.id, id));
  if (!t) return null;
  requirePermission(ctx, "timetable.read", t.t.stageId);
  const entries = await db
    .select({ e: s.timetableEntries, subject: s.subjects.nameAr, teacher: s.employees.fullName, room: s.rooms.name, grade: s.grades.nameAr, section: s.classSections.name })
    .from(s.timetableEntries)
    .innerJoin(s.employees, eq(s.employees.id, s.timetableEntries.teacherId))
    .leftJoin(s.subjects, eq(s.subjects.id, s.timetableEntries.subjectId))
    .leftJoin(s.rooms, eq(s.rooms.id, s.timetableEntries.roomId))
    .leftJoin(s.classSections, eq(s.classSections.id, s.timetableEntries.sectionId))
    .leftJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .where(eq(s.timetableEntries.timetableId, id))
    .orderBy(asc(s.timetableEntries.dayOfWeek), asc(s.timetableEntries.periodNumber), asc(s.grades.order));
  const defs = await loadPeriodDefs(db, t.t.termId, t.t.stageId);
  return { ...t.t, stageName: t.stageName, termName: t.termName, yearId: t.yearId, entries, defs, canWrite: t.t.status === "DRAFT" && can(ctx, "timetable.write", t.t.stageId), canApprove: t.t.status === "DRAFT" && can(ctx, "timetable.approve", t.t.stageId), canCopy: t.t.status !== "DRAFT" && can(ctx, "timetable.write", t.t.stageId) };
}

/** خيارات نموذج الخانة لمرحلة الجدول */
export async function entryFormOptions(db: DB, stageId: string, yearId: string) {
  const [sections, subjects, teachers, rooms] = await Promise.all([
    db.select({ id: s.classSections.id, name: s.classSections.name, grade: s.grades.nameAr }).from(s.classSections).innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId)).where(and(eq(s.grades.stageId, stageId), eq(s.classSections.yearId, yearId), eq(s.classSections.isActive, true))).orderBy(asc(s.grades.order), asc(s.classSections.name)),
    db.select().from(s.subjects).where(sql`${s.subjects.stageId} = ${stageId} OR ${s.subjects.stageId} IS NULL`).orderBy(asc(s.subjects.nameAr)),
    db.select({ id: s.employees.id, fullName: s.employees.fullName }).from(s.employees).where(and(eq(s.employees.category, "TEACHER"), eq(s.employees.status, "ACTIVE"))).orderBy(asc(s.employees.fullName)),
    db.select().from(s.rooms).where(eq(s.rooms.isActive, true)).orderBy(asc(s.rooms.name)),
  ]);
  return { sections, subjects, teachers, rooms };
}
