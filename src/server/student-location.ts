/**
 * «الموقع المتوقع حسب الجدول» — وليس تتبعًا فعليًا للطالبة.
 * يجمع: القيد النشط → الفصل → المرحلة → أوقات الحصص → الجدول المعتمد → استثناءات اليوم (انتظار/إلغاء).
 */
import { and, eq, ne } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { requirePermission, type AuthContext } from "@/auth/rbac";
import { riyadhNow } from "@/domain/time";
import { currentPeriod, type CurrentPeriod, type PeriodDef } from "@/domain/periods";
import { getTermForDate, isHoliday } from "./school";

export interface StudentNow {
  student: { id: string; fullName: string; schoolNumber: string | null };
  enrollment: { stageId: string; stageName: string; gradeName: string; sectionName: string; sectionId: string } | null;
  period: CurrentPeriod | { status: "NO_ENROLLMENT" };
  lesson: null | {
    subject: string | null;
    teacherName: string;
    teacherId: string;
    room: string | null;
    isSubstitute: boolean;
    originalTeacherName?: string | null;
    cancelled?: boolean;
  };
}

export async function getStudentNow(db: DB, ctx: AuthContext, studentId: string, at: Date = new Date()): Promise<StudentNow> {
  const now = riyadhNow(at);
  const [student] = await db
    .select({ id: s.students.id, fullName: s.students.fullName, schoolNumber: s.students.schoolNumber })
    .from(s.students)
    .where(eq(s.students.id, studentId));
  if (!student) throw new Error("الطالبة غير موجودة");

  const [enr] = await db
    .select({
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
    .where(and(eq(s.studentEnrollments.studentId, studentId), eq(s.academicYears.status, "ACTIVE"), eq(s.studentEnrollments.status, "ACTIVE")));

  if (!enr) {
    // بدون قيد نشط لا نعرف المرحلة؛ نتطلب صلاحية عامة على كل المراحل
    requirePermission(ctx, "students.read", null);
    return { student, enrollment: null, period: { status: "NO_ENROLLMENT" }, lesson: null };
  }
  requirePermission(ctx, "students.read", enr.stageId); // التحقق على الخادم قبل إرجاع أي بيانات

  const term = await getTermForDate(db, now.date);
  if (!term) return { student, enrollment: enr, period: { status: "NON_SCHOOL_DAY", reason: "OUTSIDE_TERM" }, lesson: null };

  const defs: PeriodDef[] = await db
    .select({ number: s.periodDefinitions.number, kind: s.periodDefinitions.kind, label: s.periodDefinitions.label, startMinute: s.periodDefinitions.startMinute, endMinute: s.periodDefinitions.endMinute, dayOfWeek: s.periodDefinitions.dayOfWeek })
    .from(s.periodDefinitions)
    .where(and(eq(s.periodDefinitions.termId, term.id), eq(s.periodDefinitions.stageId, enr.stageId)));

  const holiday = await isHoliday(db, term.id, enr.stageId, now.date);
  const period = currentPeriod(defs, now.minuteOfDay, { dayOfWeek: now.dayOfWeek, isHoliday: holiday });
  if (period.status !== "IN_PERIOD" || period.period.kind !== "LESSON") return { student, enrollment: enr, period, lesson: null };

  const pn = period.period.number;
  const [entry] = await db
    .select({ id: s.timetableEntries.id, teacherId: s.timetableEntries.teacherId, teacherName: s.employees.fullName, subject: s.subjects.nameAr, room: s.rooms.name })
    .from(s.timetableEntries)
    .innerJoin(s.weeklyTimetables, eq(s.weeklyTimetables.id, s.timetableEntries.timetableId))
    .innerJoin(s.employees, eq(s.employees.id, s.timetableEntries.teacherId))
    .leftJoin(s.subjects, eq(s.subjects.id, s.timetableEntries.subjectId))
    .leftJoin(s.rooms, eq(s.rooms.id, s.timetableEntries.roomId))
    .where(and(eq(s.weeklyTimetables.termId, term.id), eq(s.weeklyTimetables.status, "APPROVED"), eq(s.timetableEntries.sectionId, enr.sectionId), eq(s.timetableEntries.dayOfWeek, now.dayOfWeek), eq(s.timetableEntries.periodNumber, pn)));

  // حصة انتظار مسجلة لهذا اليوم تتقدّم على الجدول الأساسي (دون تعديله)
  const [sub] = await db
    .select({ teacherId: s.substituteAssignments.substituteTeacherId, teacherName: s.employees.fullName })
    .from(s.substituteAssignments)
    .innerJoin(s.employees, eq(s.employees.id, s.substituteAssignments.substituteTeacherId))
    .where(and(eq(s.substituteAssignments.date, now.date), eq(s.substituteAssignments.sectionId, enr.sectionId), eq(s.substituteAssignments.periodNumber, pn), ne(s.substituteAssignments.status, "CANCELLED")));

  if (sub) {
    return { student, enrollment: enr, period, lesson: { subject: entry?.subject ?? null, teacherName: sub.teacherName, teacherId: sub.teacherId, room: entry?.room ?? null, isSubstitute: true, originalTeacherName: entry?.teacherName ?? null } };
  }
  if (!entry) return { student, enrollment: enr, period, lesson: null };

  const overrides = await db.select().from(s.timetableOverrides).where(and(eq(s.timetableOverrides.entryId, entry.id), eq(s.timetableOverrides.date, now.date)));
  const cancelled = overrides.some((o) => o.type === "CANCELLED");
  let room = entry.room;
  const roomChange = overrides.find((o) => o.type === "ROOM_CHANGE" && o.newRoomId);
  if (roomChange) {
    const [r] = await db.select().from(s.rooms).where(eq(s.rooms.id, roomChange.newRoomId!));
    room = r?.name ?? room;
  }
  return { student, enrollment: enr, period, lesson: { subject: entry.subject, teacherName: entry.teacherName, teacherId: entry.teacherId, room, isSubstitute: false, cancelled } };
}
