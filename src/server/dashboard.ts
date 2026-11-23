import { and, count, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { can, stageScope, type AuthContext } from "@/auth/rbac";
import { riyadhNow } from "@/domain/time";
import { stageFilter } from "./scope-sql";
import { getActiveYear, getSchool, getTermForDate } from "./school";

export interface DashboardData {
  school: { nameAr: string; systemName: string; tagline: string | null; officialApproved: boolean } | null;
  yearName: string | null;
  termName: string | null;
  today: string;
  counts: { students: number | null; teachers: number | null; admins: number | null; sections: number | null };
  todayCounts: { absences: number | null; lates: number | null; leaves: number | null; substitutes: number | null; activities: number | null; supervision: number | null };
  alerts: string[];
  recent: Array<{ action: string; entityType: string; createdAt: Date; actor: string | null }>;
}

const num = (rows: { n: number }[]) => Number(rows[0]?.n ?? 0);

export async function getDashboard(db: DB, ctx: AuthContext, at = new Date()): Promise<DashboardData> {
  const now = riyadhNow(at);
  const [school, year, term] = await Promise.all([getSchool(db), getActiveYear(db), getTermForDate(db, now.date)]);
  const stuScope = stageScope(ctx, "students.read");
  const attScope = stageScope(ctx, "attendance.read");
  const leaveScope = stageScope(ctx, "leave.read");
  const subScope = stageScope(ctx, "substitutes.read");
  const actScope = stageScope(ctx, "activities.read");
  const alerts: string[] = [];

  const students = stuScope.kind === "none" || !year ? null : num(
    await db
      .select({ n: count() })
      .from(s.studentEnrollments)
      .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
      .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
      .where(and(eq(s.studentEnrollments.yearId, year.id), eq(s.studentEnrollments.status, "ACTIVE"), stageFilter(stuScope, s.grades.stageId))),
  );
  const sections = stuScope.kind === "none" || !year ? null : num(
    await db
      .select({ n: count() })
      .from(s.classSections)
      .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
      .where(and(eq(s.classSections.yearId, year.id), stageFilter(stuScope, s.grades.stageId))),
  );
  const canEmp = can(ctx, "employees.read");
  const teachers = canEmp ? num(await db.select({ n: count() }).from(s.employees).where(and(eq(s.employees.category, "TEACHER"), eq(s.employees.status, "ACTIVE")))) : null;
  const admins = canEmp ? num(await db.select({ n: count() }).from(s.employees).where(and(inArray(s.employees.category, ["ADMINISTRATIVE", "LEADERSHIP"]), eq(s.employees.status, "ACTIVE")))) : null;

  const attendanceCount = async (type: "ABSENCE" | "LATE") =>
    attScope.kind === "none" ? null : num(
      await db
        .select({ n: count() })
        .from(s.studentAttendanceEvents)
        .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.id, s.studentAttendanceEvents.enrollmentId))
        .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
        .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
        .where(and(eq(s.studentAttendanceEvents.date, now.date), eq(s.studentAttendanceEvents.type, type), inArray(s.studentAttendanceEvents.status, ["RECORDED", "APPROVED"]), stageFilter(attScope, s.grades.stageId))),
    );
  const leaves = leaveScope.kind === "none" ? null : num(
    await db
      .select({ n: count() })
      .from(s.studentLeaveRequests)
      .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.id, s.studentLeaveRequests.enrollmentId))
      .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
      .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
      .where(and(eq(s.studentLeaveRequests.date, now.date), ne(s.studentLeaveRequests.status, "CANCELLED"), stageFilter(leaveScope, s.grades.stageId))),
  );
  const substitutes = subScope.kind === "none" ? null : num(
    await db
      .select({ n: count() })
      .from(s.substituteAssignments)
      .innerJoin(s.classSections, eq(s.classSections.id, s.substituteAssignments.sectionId))
      .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
      .where(and(eq(s.substituteAssignments.date, now.date), ne(s.substituteAssignments.status, "CANCELLED"), stageFilter(subScope, s.grades.stageId))),
  );
  const activities = actScope.kind === "none" ? null : num(
    await db
      .select({ n: count() })
      .from(s.activitySessions)
      .innerJoin(s.activities, eq(s.activities.id, s.activitySessions.activityId))
      .where(and(eq(s.activitySessions.date, now.date), ne(s.activitySessions.status, "CANCELLED"), actScope.kind === "all" ? sql`true` : or(sql`${s.activities.stageId} IS NULL`, stageFilter(actScope, s.activities.stageId)))),
  );
  const supervision = !can(ctx, "supervision.read") || !term ? null : num(
    await db
      .select({ n: count() })
      .from(s.supervisionAssignments)
      .where(and(eq(s.supervisionAssignments.termId, term.id), ne(s.supervisionAssignments.status, "CANCELLED"), or(eq(s.supervisionAssignments.date, now.date), eq(s.supervisionAssignments.dayOfWeek, now.dayOfWeek)))),
  );

  // تنبيهات البيانات غير المكتملة
  if (!year) alerts.push("لا توجد سنة دراسية نشطة");
  if (year && !term) alerts.push("التاريخ الحالي خارج الفصول الدراسية المعرّفة");
  if (term && can(ctx, "settings.read")) {
    const allStages = await db.select().from(s.stages).orderBy(s.stages.order);
    for (const st of allStages) {
      const n = num(await db.select({ n: count() }).from(s.periodDefinitions).where(and(eq(s.periodDefinitions.termId, term.id), eq(s.periodDefinitions.stageId, st.id))));
      if (n === 0) alerts.push(`أوقات الحصص غير مكتملة — ${st.nameAr}`);
    }
  }
  if (canEmp) {
    const inc = num(await db.select({ n: count() }).from(s.employees).where(ne(s.employees.dataStatus, "COMPLETE")));
    if (inc > 0) alerts.push(`${inc} من سجلات الموظفات غير مكتملة أو بانتظار التحقق`);
  }
  if (can(ctx, "employees.read_sensitive")) {
    const pend = num(await db.select({ n: count() }).from(s.employeeServiceDates).where(eq(s.employeeServiceDates.verification, "PENDING_VERIFICATION")));
    if (pend > 0) alerts.push(`${pend} من تواريخ المباشرة بانتظار التحقق`);
  }

  const recent = can(ctx, "audit.read")
    ? await db
        .select({ action: s.auditLogs.action, entityType: s.auditLogs.entityType, createdAt: s.auditLogs.createdAt, actor: s.users.displayName })
        .from(s.auditLogs)
        .leftJoin(s.users, eq(s.users.id, s.auditLogs.actorId))
        .orderBy(desc(s.auditLogs.createdAt))
        .limit(8)
    : [];

  return {
    school: school ? { nameAr: school.nameAr, systemName: school.systemName, tagline: school.tagline, officialApproved: school.officialApproved } : null,
    yearName: year?.name ?? null,
    termName: term?.name ?? null,
    today: now.date,
    counts: { students, teachers, admins, sections },
    todayCounts: { absences: await attendanceCount("ABSENCE"), lates: await attendanceCount("LATE"), leaves, substitutes, activities, supervision },
    alerts,
    recent,
  };
}
