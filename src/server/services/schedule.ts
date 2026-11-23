/**
 * قراءات الجدولة المشتركة: أوقات الحصص، التزامات الموظفة والقاعة (لكشف التعارض)، وعروض الجدول الأسبوعي واليومي.
 * الجدول الأسبوعي المعتمد لا يُعدَّل أبدًا بسبب انتظار أو نشاط أو إلغاء؛ هذه طبقات تُركَّب فوقه عند العرض.
 */
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { requirePermission, type AuthContext } from "@/auth/rbac";
import type { PeriodDef } from "@/domain/periods";
import { periodsForDay } from "@/domain/periods";
import { slotTime, type Commitment } from "@/domain/schedule";
import { getActiveYear, getTermForDate, isHoliday } from "../school";

type Reader = Pick<DB, "select">;

export async function loadPeriodDefs(db: Reader, termId: string, stageId: string): Promise<PeriodDef[]> {
  return db
    .select({ number: s.periodDefinitions.number, kind: s.periodDefinitions.kind, label: s.periodDefinitions.label, startMinute: s.periodDefinitions.startMinute, endMinute: s.periodDefinitions.endMinute, dayOfWeek: s.periodDefinitions.dayOfWeek })
    .from(s.periodDefinitions)
    .where(and(eq(s.periodDefinitions.termId, termId), eq(s.periodDefinitions.stageId, stageId)));
}

/** ذاكرة مؤقتة لتعريفات الحصص لكل مرحلة خلال عملية واحدة */
function defsCache(db: Reader, termId: string) {
  const m = new Map<string, Promise<PeriodDef[]>>();
  return (stageId: string) => {
    if (!m.has(stageId)) m.set(stageId, loadPeriodDefs(db, termId, stageId));
    return m.get(stageId)!;
  };
}

const sectionLabel = (grade: string | null, name: string | null) => (grade ? `${grade} / ${name}` : "");

/**
 * التزامات الموظفة الأسبوعية في يوم معيّن من الجداول المعتمدة (كل المراحل) ومراقبة الأدوار الأسبوعية.
 * excludeTimetableId: يُستثنى (مثل الجدول المعتمد الذي ستحل محله المسودة).
 */
export async function weeklyCommitments(db: Reader, termId: string, employeeId: string, day: number, excludeTimetableIds: string[] = []): Promise<Commitment[]> {
  const defs = defsCache(db, termId);
  const entries = await db
    .select({ id: s.timetableEntries.id, timetableId: s.timetableEntries.timetableId, stageId: s.weeklyTimetables.stageId, periodNumber: s.timetableEntries.periodNumber, kind: s.timetableEntries.kind, grade: s.grades.nameAr, section: s.classSections.name, stageName: s.stages.nameAr })
    .from(s.timetableEntries)
    .innerJoin(s.weeklyTimetables, eq(s.weeklyTimetables.id, s.timetableEntries.timetableId))
    .innerJoin(s.stages, eq(s.stages.id, s.weeklyTimetables.stageId))
    .leftJoin(s.classSections, eq(s.classSections.id, s.timetableEntries.sectionId))
    .leftJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .where(and(eq(s.weeklyTimetables.termId, termId), eq(s.weeklyTimetables.status, "APPROVED"), eq(s.timetableEntries.teacherId, employeeId), eq(s.timetableEntries.dayOfWeek, day)));
  const out: Commitment[] = [];
  for (const e of entries) {
    if (excludeTimetableIds.includes(e.timetableId)) continue;
    const t = slotTime(await defs(e.stageId), day, e.periodNumber);
    if (!t) continue; // مرحلة بلا أوقات مُعدّة: لا يمكن حساب التداخل الزمني
    out.push({ ...t, kind: e.kind === "LESSON" ? "LESSON" : e.kind === "STANDBY" ? "STANDBY" : "ACTIVITY_PERIOD", refId: e.id, description: `${e.stageName} الحصة ${e.periodNumber} ${sectionLabel(e.grade, e.section)}`.trim() });
  }
  const sup = await db
    .select({ id: s.supervisionAssignments.id, startMinute: s.supervisionAssignments.startMinute, endMinute: s.supervisionAssignments.endMinute, area: s.supervisionAreas.name })
    .from(s.supervisionAssignments)
    .innerJoin(s.supervisionAreas, eq(s.supervisionAreas.id, s.supervisionAssignments.areaId))
    .where(and(eq(s.supervisionAssignments.termId, termId), eq(s.supervisionAssignments.employeeId, employeeId), eq(s.supervisionAssignments.dayOfWeek, day), ne(s.supervisionAssignments.status, "CANCELLED")));
  for (const x of sup) out.push({ startMinute: x.startMinute, endMinute: x.endMinute, kind: "SUPERVISION", refId: x.id, description: x.area });
  return out;
}

/**
 * التزامات الموظفة في تاريخ محدد: الجدول المعتمد (إلا الحصص التي غطّتها بديلة أو أُلغيت ذلك اليوم)
 * + حصص الانتظار المكلفة بها + الأنشطة التي تشرف عليها + مراقبة الأدوار (الأسبوعية وذلك التاريخ).
 */
export async function commitmentsOnDate(db: Reader, termId: string, employeeId: string, date: string, day: number): Promise<Commitment[]> {
  const weekly = await weeklyCommitments(db, termId, employeeId, day);
  const entryIds = weekly.filter((c) => c.kind !== "SUPERVISION").map((c) => c.refId);
  const freed = new Set<string>();
  if (entryIds.length) {
    const covered = await db
      .select({ id: s.substituteAssignments.originalEntryId })
      .from(s.substituteAssignments)
      .where(and(eq(s.substituteAssignments.date, date), inArray(s.substituteAssignments.originalEntryId, entryIds), ne(s.substituteAssignments.status, "CANCELLED")));
    covered.forEach((c) => c.id && freed.add(c.id));
    const cancelled = await db
      .select({ id: s.timetableOverrides.entryId })
      .from(s.timetableOverrides)
      .where(and(eq(s.timetableOverrides.date, date), inArray(s.timetableOverrides.entryId, entryIds), eq(s.timetableOverrides.type, "CANCELLED")));
    cancelled.forEach((c) => freed.add(c.id));
  }
  const out = weekly.filter((c) => !freed.has(c.refId));

  const subs = await db
    .select({ id: s.substituteAssignments.id, startMinute: s.substituteAssignments.startMinute, endMinute: s.substituteAssignments.endMinute, periodNumber: s.substituteAssignments.periodNumber, grade: s.grades.nameAr, section: s.classSections.name })
    .from(s.substituteAssignments)
    .innerJoin(s.classSections, eq(s.classSections.id, s.substituteAssignments.sectionId))
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .where(and(eq(s.substituteAssignments.date, date), eq(s.substituteAssignments.substituteTeacherId, employeeId), ne(s.substituteAssignments.status, "CANCELLED")));
  for (const x of subs) if (x.startMinute != null && x.endMinute != null) out.push({ startMinute: x.startMinute, endMinute: x.endMinute, kind: "SUBSTITUTE", refId: x.id, description: `الحصة ${x.periodNumber} ${sectionLabel(x.grade, x.section)}` });

  const acts = await db
    .select({ id: s.activitySessions.id, startMinute: s.activitySessions.startMinute, endMinute: s.activitySessions.endMinute, name: s.activities.name })
    .from(s.activitySessions)
    .innerJoin(s.activities, eq(s.activities.id, s.activitySessions.activityId))
    .where(and(eq(s.activitySessions.date, date), eq(s.activitySessions.supervisorId, employeeId), ne(s.activitySessions.status, "CANCELLED")));
  for (const x of acts) out.push({ startMinute: x.startMinute, endMinute: x.endMinute, kind: "ACTIVITY", refId: x.id, description: x.name });

  const sup = await db
    .select({ id: s.supervisionAssignments.id, startMinute: s.supervisionAssignments.startMinute, endMinute: s.supervisionAssignments.endMinute, area: s.supervisionAreas.name })
    .from(s.supervisionAssignments)
    .innerJoin(s.supervisionAreas, eq(s.supervisionAreas.id, s.supervisionAssignments.areaId))
    .where(and(eq(s.supervisionAssignments.termId, termId), eq(s.supervisionAssignments.employeeId, employeeId), eq(s.supervisionAssignments.date, date), ne(s.supervisionAssignments.status, "CANCELLED")));
  for (const x of sup) out.push({ startMinute: x.startMinute, endMinute: x.endMinute, kind: "SUPERVISION", refId: x.id, description: x.area });
  return out;
}

/** إشغال القاعة في يوم أسبوعي من الجداول المعتمدة (كل المراحل) */
export async function roomWeeklyUse(db: Reader, termId: string, roomId: string, day: number, excludeTimetableIds: string[] = []): Promise<Commitment[]> {
  const defs = defsCache(db, termId);
  const rows = await db
    .select({ id: s.timetableEntries.id, timetableId: s.timetableEntries.timetableId, stageId: s.weeklyTimetables.stageId, periodNumber: s.timetableEntries.periodNumber, stageName: s.stages.nameAr, teacher: s.employees.fullName })
    .from(s.timetableEntries)
    .innerJoin(s.weeklyTimetables, eq(s.weeklyTimetables.id, s.timetableEntries.timetableId))
    .innerJoin(s.stages, eq(s.stages.id, s.weeklyTimetables.stageId))
    .innerJoin(s.employees, eq(s.employees.id, s.timetableEntries.teacherId))
    .where(and(eq(s.weeklyTimetables.termId, termId), eq(s.weeklyTimetables.status, "APPROVED"), eq(s.timetableEntries.roomId, roomId), eq(s.timetableEntries.dayOfWeek, day)));
  const out: Commitment[] = [];
  for (const r of rows) {
    if (excludeTimetableIds.includes(r.timetableId)) continue;
    const t = slotTime(await defs(r.stageId), day, r.periodNumber);
    if (t) out.push({ ...t, kind: "LESSON", refId: r.id, description: `${r.stageName} الحصة ${r.periodNumber} — ${r.teacher}` });
  }
  return out;
}

// ───── العروض ─────

export interface WeekCell {
  subject: string | null;
  teacher: string;
  room: string | null;
  section: string | null;
  kind: string;
}

/** الجدول الأسبوعي المعتمد لشعبة في الفصل الدراسي الحالي */
export async function sectionWeek(db: DB, ctx: AuthContext, sectionId: string, date: string) {
  const [sec] = await db.select({ stageId: s.grades.stageId }).from(s.classSections).innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId)).where(eq(s.classSections.id, sectionId));
  if (!sec) return null;
  requirePermission(ctx, "timetable.read", sec.stageId);
  const term = await getTermForDate(db, date);
  if (!term) return { status: "NO_TERM" as const };
  const defs = await loadPeriodDefs(db, term.id, sec.stageId);
  const rows = await db
    .select({ day: s.timetableEntries.dayOfWeek, period: s.timetableEntries.periodNumber, kind: s.timetableEntries.kind, subject: s.subjects.nameAr, teacher: s.employees.fullName, room: s.rooms.name })
    .from(s.timetableEntries)
    .innerJoin(s.weeklyTimetables, eq(s.weeklyTimetables.id, s.timetableEntries.timetableId))
    .innerJoin(s.employees, eq(s.employees.id, s.timetableEntries.teacherId))
    .leftJoin(s.subjects, eq(s.subjects.id, s.timetableEntries.subjectId))
    .leftJoin(s.rooms, eq(s.rooms.id, s.timetableEntries.roomId))
    .where(and(eq(s.weeklyTimetables.termId, term.id), eq(s.weeklyTimetables.status, "APPROVED"), eq(s.timetableEntries.sectionId, sectionId)));
  const cells = new Map<string, WeekCell>();
  for (const r of rows) cells.set(`${r.day}:${r.period}`, { subject: r.subject, teacher: r.teacher, room: r.room, section: null, kind: r.kind });
  return { status: "OK" as const, termName: term.name, defs, cells };
}

/** جدول معلمة الأسبوعي المعتمد (كل المراحل) — بأرقام الحصص لكل مرحلة */
export async function teacherWeek(db: DB, ctx: AuthContext, employeeId: string, date: string) {
  requirePermission(ctx, "timetable.read");
  const term = await getTermForDate(db, date);
  if (!term) return null;
  const rows = await db
    .select({ day: s.timetableEntries.dayOfWeek, period: s.timetableEntries.periodNumber, kind: s.timetableEntries.kind, subject: s.subjects.nameAr, room: s.rooms.name, grade: s.grades.nameAr, section: s.classSections.name, stageId: s.weeklyTimetables.stageId, stageName: s.stages.nameAr })
    .from(s.timetableEntries)
    .innerJoin(s.weeklyTimetables, eq(s.weeklyTimetables.id, s.timetableEntries.timetableId))
    .innerJoin(s.stages, eq(s.stages.id, s.weeklyTimetables.stageId))
    .leftJoin(s.subjects, eq(s.subjects.id, s.timetableEntries.subjectId))
    .leftJoin(s.rooms, eq(s.rooms.id, s.timetableEntries.roomId))
    .leftJoin(s.classSections, eq(s.classSections.id, s.timetableEntries.sectionId))
    .leftJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .where(and(eq(s.weeklyTimetables.termId, term.id), eq(s.weeklyTimetables.status, "APPROVED"), eq(s.timetableEntries.teacherId, employeeId)))
    .orderBy(asc(s.timetableEntries.dayOfWeek), asc(s.timetableEntries.periodNumber));
  return { termName: term.name, rows };
}

export interface DaySlot {
  number: number;
  kind: string;
  label: string | null;
  startMinute: number;
  endMinute: number;
  lesson: null | { subject: string | null; teacher: string; room: string | null; cancelled: boolean; substitute: string | null };
}

/**
 * جدول يوم محدد لشعبة: الجدول الأسبوعي المعتمد + حصص الانتظار + الإلغاءات + الأنشطة — دون تعديل الأسبوعي.
 */
export async function sectionDay(db: DB, ctx: AuthContext, sectionId: string, date: string) {
  const [sec] = await db.select({ stageId: s.grades.stageId }).from(s.classSections).innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId)).where(eq(s.classSections.id, sectionId));
  if (!sec) return null;
  requirePermission(ctx, "timetable.read", sec.stageId);
  const term = await getTermForDate(db, date);
  if (!term) return { status: "NO_TERM" as const };
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (day > 4) return { status: "WEEKEND" as const };
  if (await isHoliday(db, term.id, sec.stageId, date)) return { status: "HOLIDAY" as const };
  const defs = periodsForDay(await loadPeriodDefs(db, term.id, sec.stageId), day);
  if (defs.length === 0) return { status: "NOT_CONFIGURED" as const };
  const entries = await db
    .select({ id: s.timetableEntries.id, period: s.timetableEntries.periodNumber, subject: s.subjects.nameAr, teacher: s.employees.fullName, room: s.rooms.name })
    .from(s.timetableEntries)
    .innerJoin(s.weeklyTimetables, eq(s.weeklyTimetables.id, s.timetableEntries.timetableId))
    .innerJoin(s.employees, eq(s.employees.id, s.timetableEntries.teacherId))
    .leftJoin(s.subjects, eq(s.subjects.id, s.timetableEntries.subjectId))
    .leftJoin(s.rooms, eq(s.rooms.id, s.timetableEntries.roomId))
    .where(and(eq(s.weeklyTimetables.termId, term.id), eq(s.weeklyTimetables.status, "APPROVED"), eq(s.timetableEntries.sectionId, sectionId), eq(s.timetableEntries.dayOfWeek, day)));
  const subs = await db
    .select({ period: s.substituteAssignments.periodNumber, teacher: s.employees.fullName })
    .from(s.substituteAssignments)
    .innerJoin(s.employees, eq(s.employees.id, s.substituteAssignments.substituteTeacherId))
    .where(and(eq(s.substituteAssignments.date, date), eq(s.substituteAssignments.sectionId, sectionId), ne(s.substituteAssignments.status, "CANCELLED")));
  const cancelled = entries.length
    ? new Set((await db.select({ id: s.timetableOverrides.entryId }).from(s.timetableOverrides).where(and(eq(s.timetableOverrides.date, date), eq(s.timetableOverrides.type, "CANCELLED"), inArray(s.timetableOverrides.entryId, entries.map((e) => e.id))))).map((r) => r.id))
    : new Set<string>();
  const activities = await db
    .select({ id: s.activitySessions.id, name: s.activities.name, startMinute: s.activitySessions.startMinute, endMinute: s.activitySessions.endMinute, supervisor: s.employees.fullName, location: s.activitySessions.location, room: s.rooms.name, status: s.activitySessions.status })
    .from(s.activitySessions)
    .innerJoin(s.activities, eq(s.activities.id, s.activitySessions.activityId))
    .innerJoin(s.employees, eq(s.employees.id, s.activitySessions.supervisorId))
    .leftJoin(s.rooms, eq(s.rooms.id, s.activitySessions.roomId))
    .where(and(eq(s.activitySessions.date, date), eq(s.activitySessions.sectionId, sectionId), ne(s.activitySessions.status, "CANCELLED")))
    .orderBy(asc(s.activitySessions.startMinute));
  const slots: DaySlot[] = defs.map((d) => {
    const e = entries.find((x) => x.period === d.number);
    const sub = subs.find((x) => x.period === d.number);
    return { number: d.number, kind: d.kind, label: d.label ?? null, startMinute: d.startMinute, endMinute: d.endMinute, lesson: e ? { subject: e.subject, teacher: e.teacher, room: e.room, cancelled: cancelled.has(e.id), substitute: sub?.teacher ?? null } : null };
  });
  return { status: "OK" as const, slots, activities };
}

/** الفصل الدراسي الحالي أو null، والسنة النشطة */
export async function currentTermContext(db: DB, date: string) {
  const [term, year] = await Promise.all([getTermForDate(db, date), getActiveYear(db)]);
  return { term, year };
}
