/**
 * الغياب والتأخر (أحداث يومية منفصلة عن حالة القيد).
 * - لا تحويل آلي إلى «منقطعة» مهما بلغ عدد أيام الغياب.
 * - لا تعديل ولا حذف: التصحيح سجل جديد يشير إلى القديم (supersedesId) ويصبح القديم «مصحّحًا»، والإلغاء بالحالة.
 * - سجل نشط واحد لكل (طالبة، تاريخ، نوع)، ولا تُسجَّل طالبة غائبة ومتأخرة في اليوم نفسه.
 * - هذه السجلات ليست تسجيلًا رسميًا في نظام نور.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { can, requirePermission, stageScope, type AuthContext } from "@/auth/rbac";
import { ConflictError, StaleRecordError } from "@/domain/conflicts";
import { computeLateMinutes } from "@/domain/attendance";
import { periodsForDay } from "@/domain/periods";
import { dayOfWeekOf } from "@/domain/schedule";
import { hhmmToMinutes, riyadhNow } from "@/domain/time";
import { writeAudit } from "../audit";
import { updateVersioned } from "../versioned";
import { stageFilter } from "../scope-sql";
import { isoDate, optText, reqUuid, stringArray, ValidationError, versionField } from "../forms";
import { getTermForDate, isHoliday } from "../school";
import { loadPeriodDefs } from "./schedule";
import { dbConstraint, sectionStage } from "./affairs-common";

const ACTIVE = ["RECORDED", "APPROVED"] as const;
const timeField = (label: string) =>
  z.string({ error: `${label} مطلوب` }).regex(/^\d{1,2}:\d{2}$/, { error: `${label} بصيغة ساعة:دقيقة` }).transform((v, c) => {
    try {
      return hhmmToMinutes(v);
    } catch {
      c.addIssue({ code: "custom", message: `${label} غير صالح` });
      return z.NEVER;
    }
  });
const optTime = (label: string) => z.union([z.literal(""), timeField(label)]).optional().transform((v) => (v === "" || v === undefined ? null : v));

export const absenceSchema = z.object({
  sectionId: reqUuid("الفصل"),
  date: isoDate("التاريخ"),
  studentIds: stringArray.pipe(z.array(z.uuid()).min(1, { error: "اختاري طالبة واحدة على الأقل" })),
  absenceKind: z.enum(s.absenceKind.enumValues, { error: "نوع الغياب غير صالح" }).default("UNKNOWN"),
  notes: optText(300),
});
export const lateSchema = z.object({
  sectionId: reqUuid("الفصل"),
  studentId: reqUuid("الطالبة"),
  date: isoDate("التاريخ"),
  arrival: timeField("وقت الوصول"),
  schoolStart: optTime("وقت بداية الدوام"),
  notes: optText(300),
});
export const correctionSchema = z.object({
  version: versionField,
  absenceKind: z.enum(s.absenceKind.enumValues).optional(),
  arrival: optTime("وقت الوصول"),
  schoolStart: optTime("وقت بداية الدوام"),
  notes: optText(300),
});

/** يتحقق من التاريخ: داخل فصل دراسي، يوم دراسة، ليس إجازة، وليس في المستقبل */
async function checkSchoolDate(db: DB, stageId: string, date: string) {
  if (date > riyadhNow().date) throw new ValidationError("لا يُسجَّل غياب أو تأخر لتاريخ في المستقبل", "date");
  const term = await getTermForDate(db, date);
  if (!term) throw new ValidationError("التاريخ خارج الفصول الدراسية للسنة النشطة", "date");
  if (dayOfWeekOf(date) > 4) throw new ValidationError("التاريخ ليس يوم دراسة", "date");
  if (await isHoliday(db, term.id, stageId, date)) throw new ValidationError("التاريخ إجازة رسمية", "date");
  return term;
}

/** وقت بداية الدوام الافتراضي = بداية أول حصة دراسية ذلك اليوم (من الأوقات المُعدّة فقط) */
export async function defaultSchoolStart(db: DB, termId: string, stageId: string, date: string): Promise<number | null> {
  const first = periodsForDay(await loadPeriodDefs(db, termId, stageId), dayOfWeekOf(date))[0];
  return first ? first.startMinute : null;
}

export async function sectionRoster(db: DB, ctx: AuthContext, sectionId: string, date: string) {
  const sec = await sectionStage(db, sectionId);
  requirePermission(ctx, "attendance.read", sec.stageId);
  const students = await db
    .select({ studentId: s.students.id, fullName: s.students.fullName, schoolNumber: s.students.schoolNumber, enrollmentId: s.studentEnrollments.id })
    .from(s.studentEnrollments)
    .innerJoin(s.students, eq(s.students.id, s.studentEnrollments.studentId))
    .where(and(eq(s.studentEnrollments.sectionId, sectionId), eq(s.studentEnrollments.status, "ACTIVE")))
    .orderBy(asc(s.students.fullName));
  const events = students.length
    ? await db.select().from(s.studentAttendanceEvents).where(and(eq(s.studentAttendanceEvents.date, date), inArray(s.studentAttendanceEvents.studentId, students.map((x) => x.studentId)), inArray(s.studentAttendanceEvents.status, [...ACTIVE])))
    : [];
  const term = await getTermForDate(db, date);
  return {
    stageId: sec.stageId,
    defaultStart: term ? await defaultSchoolStart(db, term.id, sec.stageId, date) : null,
    canWrite: can(ctx, "attendance.write", sec.stageId),
    canApprove: can(ctx, "attendance.approve", sec.stageId),
    rows: students.map((x) => ({ ...x, absence: events.find((e) => e.studentId === x.studentId && e.type === "ABSENCE") ?? null, late: events.find((e) => e.studentId === x.studentId && e.type === "LATE") ?? null })),
  };
}

async function enrollmentsInSection(db: Pick<DB, "select">, sectionId: string, studentIds: string[]) {
  const rows = await db
    .select({ id: s.studentEnrollments.id, studentId: s.studentEnrollments.studentId })
    .from(s.studentEnrollments)
    .where(and(eq(s.studentEnrollments.sectionId, sectionId), eq(s.studentEnrollments.status, "ACTIVE"), inArray(s.studentEnrollments.studentId, studentIds)));
  if (rows.length !== new Set(studentIds).size) throw new ValidationError("إحدى الطالبات ليست منتظمة في هذا الفصل");
  return rows;
}

/** تسجيل غياب جماعي لفصل؛ من لها غياب نشط تُتخطّى، ومن لها تأخر نشط في اليوم نفسه تُرفض */
export async function recordAbsences(db: DB, ctx: AuthContext, raw: unknown) {
  const d = absenceSchema.parse(raw);
  const sec = await sectionStage(db, d.sectionId);
  requirePermission(ctx, "attendance.write", sec.stageId);
  await checkSchoolDate(db, sec.stageId, d.date);
  const enr = await enrollmentsInSection(db, d.sectionId, d.studentIds);
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(s.studentAttendanceEvents).where(and(eq(s.studentAttendanceEvents.date, d.date), inArray(s.studentAttendanceEvents.studentId, d.studentIds), inArray(s.studentAttendanceEvents.status, [...ACTIVE])));
    const late = existing.filter((e) => e.type === "LATE");
    if (late.length) throw new ConflictError("لا تُسجَّل طالبة غائبة وقد سُجّل تأخرها في اليوم نفسه؛ صحّحي سجل التأخر أولًا");
    let created = 0;
    let skipped = 0;
    for (const e of enr) {
      if (existing.some((x) => x.studentId === e.studentId && x.type === "ABSENCE")) {
        skipped++;
        continue;
      }
      const [row] = await tx.insert(s.studentAttendanceEvents).values({ studentId: e.studentId, enrollmentId: e.id, date: d.date, type: "ABSENCE", absenceKind: d.absenceKind, notes: d.notes, recordedById: ctx.userId }).returning();
      await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "attendance", entityId: row.id, after: row });
      created++;
    }
    return { created, skipped };
  });
}

export async function recordLate(db: DB, ctx: AuthContext, raw: unknown) {
  const d = lateSchema.parse(raw);
  const sec = await sectionStage(db, d.sectionId);
  requirePermission(ctx, "attendance.write", sec.stageId);
  const term = await checkSchoolDate(db, sec.stageId, d.date);
  const start = d.schoolStart ?? (await defaultSchoolStart(db, term.id, sec.stageId, d.date));
  if (start === null) throw new ValidationError("أوقات الحصص غير مكتملة لهذه المرحلة؛ أدخلي وقت بداية الدوام يدويًا", "schoolStart");
  let lateMinutes: number;
  try {
    lateMinutes = computeLateMinutes(start, d.arrival);
  } catch (e) {
    throw new ValidationError((e as Error).message, "arrival");
  }
  const [enr] = await enrollmentsInSection(db, d.sectionId, [d.studentId]);
  try {
    return await db.transaction(async (tx) => {
      const [abs] = await tx.select({ id: s.studentAttendanceEvents.id }).from(s.studentAttendanceEvents).where(and(eq(s.studentAttendanceEvents.studentId, d.studentId), eq(s.studentAttendanceEvents.date, d.date), eq(s.studentAttendanceEvents.type, "ABSENCE"), inArray(s.studentAttendanceEvents.status, [...ACTIVE])));
      if (abs) throw new ConflictError("للطالبة غياب مسجّل في هذا اليوم؛ صحّحي أو ألغي سجل الغياب قبل تسجيل التأخر");
      const [row] = await tx.insert(s.studentAttendanceEvents).values({ studentId: d.studentId, enrollmentId: enr.id, date: d.date, type: "LATE", schoolStartMinute: start, arrivalMinute: d.arrival, lateMinutes, notes: d.notes, recordedById: ctx.userId }).returning();
      await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "attendance", entityId: row.id, after: row });
      return row;
    });
  } catch (e) {
    if (dbConstraint(e) === "attendance_active_uq") throw new ConflictError("للطالبة تأخر مسجّل في هذا اليوم؛ استخدمي «تصحيح» بدل تسجيل جديد");
    throw e;
  }
}

async function loadEvent(tx: Pick<DB, "select">, id: string) {
  const [r] = await tx
    .select({ e: s.studentAttendanceEvents, stageId: s.grades.stageId })
    .from(s.studentAttendanceEvents)
    .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.id, s.studentAttendanceEvents.enrollmentId))
    .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .where(eq(s.studentAttendanceEvents.id, id));
  if (!r) throw new ValidationError("السجل غير موجود");
  return r;
}

/** تصحيح: يُنشأ سجل جديد يشير إلى القديم، ويصبح القديم «مصحّحًا» — دون فقدان أثر الإجراء السابق */
export async function correctEvent(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  const d = correctionSchema.parse(raw);
  return db.transaction(async (tx) => {
    const { e: old, stageId } = await loadEvent(tx, id);
    requirePermission(ctx, "attendance.write", stageId);
    if (old.version !== d.version) throw new StaleRecordError();
    if (!(ACTIVE as readonly string[]).includes(old.status)) throw new ValidationError("لا يُصحَّح إلا سجل نشط");
    let next: Partial<typeof s.studentAttendanceEvents.$inferInsert> = {};
    if (old.type === "ABSENCE") next = { absenceKind: d.absenceKind ?? old.absenceKind };
    else {
      const start = d.schoolStart ?? old.schoolStartMinute!;
      const arrival = d.arrival ?? old.arrivalMinute!;
      try {
        next = { schoolStartMinute: start, arrivalMinute: arrival, lateMinutes: computeLateMinutes(start, arrival) };
      } catch (err) {
        throw new ValidationError((err as Error).message, "arrival");
      }
    }
    await updateVersioned(tx, s.studentAttendanceEvents, id, d.version, { status: "CORRECTED" });
    const [row] = await tx
      .insert(s.studentAttendanceEvents)
      .values({ studentId: old.studentId, enrollmentId: old.enrollmentId, date: old.date, type: old.type, absenceKind: old.absenceKind, schoolStartMinute: old.schoolStartMinute, arrivalMinute: old.arrivalMinute, lateMinutes: old.lateMinutes, ...next, notes: d.notes ?? old.notes, supersedesId: old.id, recordedById: ctx.userId })
      .returning();
    await writeAudit(tx, { actorId: ctx.userId, action: "correct", entityType: "attendance", entityId: row.id, before: old, after: row });
    return row;
  });
}

export async function cancelEvent(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  const { version, notes } = z.object({ version: versionField, notes: optText(300) }).parse(raw);
  return db.transaction(async (tx) => {
    const { e: old, stageId } = await loadEvent(tx, id);
    requirePermission(ctx, "attendance.write", stageId);
    if (old.version !== version) throw new StaleRecordError();
    if (!(ACTIVE as readonly string[]).includes(old.status)) throw new ValidationError("السجل غير نشط");
    const after = await updateVersioned(tx, s.studentAttendanceEvents, id, version, { status: "CANCELLED", notes: notes ?? old.notes });
    await writeAudit(tx, { actorId: ctx.userId, action: "cancel", entityType: "attendance", entityId: id, before: old, after });
    return after;
  });
}

export async function approveEvent(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  const { version } = z.object({ version: versionField }).parse(raw);
  return db.transaction(async (tx) => {
    const { e: old, stageId } = await loadEvent(tx, id);
    requirePermission(ctx, "attendance.approve", stageId);
    if (old.version !== version) throw new StaleRecordError();
    if (old.status !== "RECORDED") throw new ValidationError("يُعتمد السجل المسجَّل فقط");
    const after = await updateVersioned(tx, s.studentAttendanceEvents, id, version, { status: "APPROVED", approvedById: ctx.userId });
    await writeAudit(tx, { actorId: ctx.userId, action: "approve", entityType: "attendance", entityId: id, before: old, after });
    return after;
  });
}

/** سجل اليوم لكل المراحل المسموحة */
export async function dailyLog(db: DB, ctx: AuthContext, date: string) {
  const scope = stageScope(ctx, "attendance.read");
  if (scope.kind === "none") return [];
  return db
    .select({ e: s.studentAttendanceEvents, fullName: s.students.fullName, grade: s.grades.nameAr, section: s.classSections.name, sectionId: s.classSections.id, stageName: s.stages.nameAr })
    .from(s.studentAttendanceEvents)
    .innerJoin(s.students, eq(s.students.id, s.studentAttendanceEvents.studentId))
    .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.id, s.studentAttendanceEvents.enrollmentId))
    .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .innerJoin(s.stages, eq(s.stages.id, s.grades.stageId))
    .where(and(eq(s.studentAttendanceEvents.date, date), stageFilter(scope, s.stages.id)))
    .orderBy(asc(s.stages.order), asc(s.grades.order), asc(s.students.fullName), asc(s.studentAttendanceEvents.createdAt));
}

/** كل أحداث الطالبة (بما فيها المصحَّحة والملغاة) للسجل التاريخي */
export async function studentAttendanceHistory(db: DB, ctx: AuthContext, studentId: string) {
  const rows = await db
    .select({ e: s.studentAttendanceEvents, stageId: s.grades.stageId, recordedBy: s.users.displayName })
    .from(s.studentAttendanceEvents)
    .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.id, s.studentAttendanceEvents.enrollmentId))
    .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .innerJoin(s.users, eq(s.users.id, s.studentAttendanceEvents.recordedById))
    .where(eq(s.studentAttendanceEvents.studentId, studentId))
    .orderBy(desc(s.studentAttendanceEvents.date), asc(s.studentAttendanceEvents.createdAt));
  return rows.filter((r) => can(ctx, "attendance.read", r.stageId));
}
