/**
 * حصص الانتظار: سجلات منفصلة لتاريخ محدد، لا تعدّل الجدول الأسبوعي، وتظهر في جدول ذلك اليوم فقط.
 * تمنع: تكليف البديلة في وقت التزام آخر (حصة/انتظار/نشاط/مراقبة)، وتكرار الانتظار للحصة نفسها.
 * الإلغاء يغيّر الحالة إلى «ملغاة» ولا يحذف السجل.
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { can, requirePermission, stageScope, type AuthContext } from "@/auth/rbac";
import { ConflictError, StaleRecordError } from "@/domain/conflicts";
import { dayOfWeekOf, describeCommitments, overlapping, slotTime } from "@/domain/schedule";
import { periodsForDay } from "@/domain/periods";
import { writeAudit } from "../audit";
import { updateVersioned } from "../versioned";
import { stageFilter } from "../scope-sql";
import { isoDate, optText, reqUuid, ValidationError, versionField } from "../forms";
import { getTermForDate, isHoliday } from "../school";
import { commitmentsOnDate, loadPeriodDefs } from "./schedule";

export const substituteSchema = z.object({
  date: isoDate("التاريخ"),
  sectionId: reqUuid("الفصل"),
  periodNumber: z.coerce.number({ error: "اختاري الحصة" }).int().min(1),
  substituteTeacherId: reqUuid("المعلمة البديلة"),
  status: z.enum(["PLANNED", "CONFIRMED"], { error: "حالة التكليف غير صالحة" }).default("PLANNED"),
  notes: optText(500),
});
export const substituteUpdateSchema = z.object({
  version: versionField,
  status: z.enum(s.assignmentStatus.enumValues, { error: "حالة التكليف غير صالحة" }),
  notes: optText(500),
});

/** يحلّل خانة (تاريخ، فصل، حصة): المرحلة، الفصل الدراسي، الوقت، والحصة الأصلية في الجدول المعتمد */
export async function resolveSlot(db: Pick<DB, "select">, date: string, sectionId: string, periodNumber: number) {
  const [sec] = await db
    .select({ stageId: s.grades.stageId, yearId: s.classSections.yearId, label: sql<string>`${s.grades.nameAr} || ' / ' || ${s.classSections.name}` })
    .from(s.classSections)
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .where(eq(s.classSections.id, sectionId));
  if (!sec) throw new ValidationError("الفصل غير موجود", "sectionId");
  const term = await getTermForDate(db as DB, date);
  if (!term) throw new ValidationError("التاريخ خارج الفصول الدراسية للسنة النشطة", "date");
  const day = dayOfWeekOf(date);
  if (day > 4) throw new ValidationError("التاريخ ليس يوم دراسة (الجمعة أو السبت)", "date");
  if (await isHoliday(db as DB, term.id, sec.stageId, date)) throw new ValidationError("التاريخ إجازة رسمية لهذه المرحلة", "date");
  const defs = await loadPeriodDefs(db, term.id, sec.stageId);
  if (defs.length === 0) throw new ValidationError("أوقات الحصص غير مكتملة لهذه المرحلة", "periodNumber");
  const def = periodsForDay(defs, day).find((d) => d.number === periodNumber);
  const slot = slotTime(defs, day, periodNumber);
  if (!def || !slot || def.kind !== "LESSON") throw new ValidationError("رقم الحصة غير معرّف كحصة دراسية في هذا اليوم", "periodNumber");
  const [entry] = await db
    .select({ id: s.timetableEntries.id, teacherId: s.timetableEntries.teacherId, teacher: s.employees.fullName, subject: s.subjects.nameAr })
    .from(s.timetableEntries)
    .innerJoin(s.weeklyTimetables, eq(s.weeklyTimetables.id, s.timetableEntries.timetableId))
    .innerJoin(s.employees, eq(s.employees.id, s.timetableEntries.teacherId))
    .leftJoin(s.subjects, eq(s.subjects.id, s.timetableEntries.subjectId))
    .where(and(eq(s.weeklyTimetables.termId, term.id), eq(s.weeklyTimetables.status, "APPROVED"), eq(s.timetableEntries.sectionId, sectionId), eq(s.timetableEntries.dayOfWeek, day), eq(s.timetableEntries.periodNumber, periodNumber)));
  return { stageId: sec.stageId, sectionLabel: sec.label, term, day, slot, entry: entry ?? null, periods: periodsForDay(defs, day).filter((d) => d.kind === "LESSON") };
}

export async function createSubstitute(db: DB, ctx: AuthContext, raw: unknown) {
  const d = substituteSchema.parse(raw);
  const r = await resolveSlot(db, d.date, d.sectionId, d.periodNumber);
  requirePermission(ctx, "substitutes.write", r.stageId);
  if (!r.entry) throw new ValidationError("لا توجد حصة في الجدول المعتمد لهذا الفصل في هذا اليوم والحصة؛ لا شيء يُغطّى بالانتظار", "periodNumber");
  if (r.entry.teacherId === d.substituteTeacherId) throw new ValidationError("البديلة هي معلمة الحصة الأصلية نفسها", "substituteTeacherId");
  const [sub] = await db.select().from(s.employees).where(eq(s.employees.id, d.substituteTeacherId));
  if (!sub || sub.category !== "TEACHER" || sub.status !== "ACTIVE") throw new ValidationError("البديلة يجب أن تكون معلمة على رأس العمل", "substituteTeacherId");
  const busy = overlapping(await commitmentsOnDate(db, r.term.id, d.substituteTeacherId, d.date, r.day), r.slot);
  if (busy.length) throw new ConflictError(`تعارض: البديلة مكلفة في الوقت نفسه — ${describeCommitments(busy).join("؛ ")}`);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(s.substituteAssignments)
        .values({ termId: r.term.id, date: d.date, sectionId: d.sectionId, periodNumber: d.periodNumber, originalTeacherId: r.entry!.teacherId, substituteTeacherId: d.substituteTeacherId, originalEntryId: r.entry!.id, startMinute: r.slot.startMinute, endMinute: r.slot.endMinute, status: d.status, notes: d.notes, createdById: ctx.userId })
        .returning();
      await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "substitute", entityId: row.id, after: row });
      return row;
    });
  } catch (e) {
    const c = (e as { cause?: { code?: string; constraint?: string } }).cause;
    if (c?.code === "23505" && c.constraint === "sub_section_slot_uq") throw new ConflictError("تعارض: توجد حصة انتظار مسجلة لهذا الفصل في الحصة نفسها من هذا اليوم.");
    if (c?.code === "23505" && c.constraint === "sub_teacher_slot_uq") throw new ConflictError("تعارض: البديلة مكلفة بانتظار آخر في الحصة نفسها من هذا اليوم.");
    throw e;
  }
}

export async function updateSubstitute(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  const d = substituteUpdateSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ a: s.substituteAssignments, stageId: s.grades.stageId }).from(s.substituteAssignments).innerJoin(s.classSections, eq(s.classSections.id, s.substituteAssignments.sectionId)).innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId)).where(eq(s.substituteAssignments.id, id));
    if (!before) throw new ValidationError("التكليف غير موجود");
    requirePermission(ctx, "substitutes.write", before.stageId);
    if (before.a.version !== d.version) throw new StaleRecordError(); // القديم أولًا: يجب تحديث الصفحة قبل أي قرار
    if (before.a.status === "CANCELLED" && d.status !== "CANCELLED") throw new ValidationError("التكليف الملغى لا يُعاد تفعيله؛ أنشئي تكليفًا جديدًا", "status");
    const after = await updateVersioned(tx, s.substituteAssignments, id, d.version, { status: d.status, notes: d.notes });
    await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "substitute", entityId: id, before: before.a, after });
    return after;
  });
}

export async function listSubstitutes(db: DB, ctx: AuthContext, date: string) {
  const scope = stageScope(ctx, "substitutes.read");
  if (scope.kind === "none") return [];
  const orig = sql<string | null>`(SELECT full_name FROM employees o WHERE o.id = ${s.substituteAssignments.originalTeacherId})`;
  const rows = await db
    .select({ a: s.substituteAssignments, stageId: s.grades.stageId, stageName: s.stages.nameAr, section: sql<string>`${s.grades.nameAr} || ' / ' || ${s.classSections.name}`, substitute: s.employees.fullName, original: orig })
    .from(s.substituteAssignments)
    .innerJoin(s.classSections, eq(s.classSections.id, s.substituteAssignments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .innerJoin(s.stages, eq(s.stages.id, s.grades.stageId))
    .innerJoin(s.employees, eq(s.employees.id, s.substituteAssignments.substituteTeacherId))
    .where(and(eq(s.substituteAssignments.date, date), stageFilter(scope, s.stages.id)))
    .orderBy(asc(s.stages.order), asc(s.substituteAssignments.periodNumber));
  return rows.map((r) => ({ ...r.a, stageName: r.stageName, section: r.section, substitute: r.substitute, original: r.original, canWrite: can(ctx, "substitutes.write", r.stageId) }));
}

/** المعلمات المتاحات (بلا أي التزام متداخل) لخانة محددة — لاقتراح البديلة */
export async function availableSubstitutes(db: DB, ctx: AuthContext, date: string, sectionId: string, periodNumber: number) {
  const r = await resolveSlot(db, date, sectionId, periodNumber);
  requirePermission(ctx, "substitutes.read", r.stageId);
  const teachers = await db.select({ id: s.employees.id, fullName: s.employees.fullName }).from(s.employees).where(and(eq(s.employees.category, "TEACHER"), eq(s.employees.status, "ACTIVE"), r.entry ? ne(s.employees.id, r.entry.teacherId) : sql`true`)).orderBy(asc(s.employees.fullName));
  const out: Array<{ id: string; fullName: string; free: boolean; reason: string | null }> = [];
  for (const t of teachers) {
    const busy = overlapping(await commitmentsOnDate(db, r.term.id, t.id, date, r.day), r.slot);
    out.push({ ...t, free: busy.length === 0, reason: busy.length ? describeCommitments(busy)[0] : null });
  }
  return { slot: r, teachers: out };
}
