/**
 * البحث الشامل — يطبّع النص العربي، ويحترم نطاق صلاحيات المستخدمة على الخادم.
 * لا تُرجع أي نتيجة خارج صلاحية الاطلاع.
 */
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { can, stageScope, type AuthContext } from "@/auth/rbac";
import { normalizeArabic, toLikePattern } from "@/domain/arabic";
import { stageFilter } from "./scope-sql";

export interface SearchFilters {
  stageId?: string;
  category?: (typeof s.employeeCategory.enumValues)[number];
  limit?: number;
}

export interface SearchResults {
  students: Array<{ id: string; fullName: string; schoolNumber: string | null; stageName: string; gradeName: string; sectionName: string; status: string }>;
  employees: Array<{ id: string; fullName: string; jobTitle: string; category: string; specialization: string | null; dataStatus: string }>;
  sections: Array<{ id: string; label: string; stageName: string }>;
}

export async function searchDirectory(db: DB, ctx: AuthContext, query: string, f: SearchFilters = {}): Promise<SearchResults> {
  const q = normalizeArabic(query);
  const limit = Math.min(Math.max(f.limit ?? 25, 1), 100);
  const out: SearchResults = { students: [], employees: [], sections: [] };
  if (q.length < 2) return out;
  const pattern = toLikePattern(q);

  const studentScope = stageScope(ctx, "students.read");
  if (studentScope.kind !== "none") {
    out.students = await db
      .select({
        id: s.students.id,
        fullName: s.students.fullName,
        schoolNumber: s.students.schoolNumber,
        stageName: s.stages.nameAr,
        gradeName: s.grades.nameAr,
        sectionName: s.classSections.name,
        status: s.studentEnrollments.status,
      })
      .from(s.students)
      .innerJoin(s.studentEnrollments, eq(s.studentEnrollments.studentId, s.students.id))
      .innerJoin(s.academicYears, eq(s.academicYears.id, s.studentEnrollments.yearId))
      .innerJoin(s.classSections, eq(s.classSections.id, s.studentEnrollments.sectionId))
      .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
      .innerJoin(s.stages, eq(s.stages.id, s.grades.stageId))
      .where(
        and(
          eq(s.academicYears.status, "ACTIVE"),
          stageFilter(studentScope, s.stages.id),
          f.stageId ? eq(s.stages.id, f.stageId) : sql`true`,
          or(ilike(s.students.nameNormalized, pattern), ilike(s.students.schoolNumber, pattern)),
        ),
      )
      .orderBy(s.students.fullName)
      .limit(limit);
  }

  if (can(ctx, "employees.read")) {
    out.employees = await db
      .select({ id: s.employees.id, fullName: s.employees.fullName, jobTitle: s.employees.jobTitle, category: s.employees.category, specialization: s.employees.specialization, dataStatus: s.employees.dataStatus })
      .from(s.employees)
      .where(
        and(
          f.category ? eq(s.employees.category, f.category) : sql`true`,
          f.stageId
            ? inArray(s.employees.id, db.select({ id: s.employeeAssignments.employeeId }).from(s.employeeAssignments).where(eq(s.employeeAssignments.stageId, f.stageId)))
            : sql`true`,
          or(ilike(s.employees.nameNormalized, pattern), ilike(s.employees.jobTitle, pattern), ilike(s.employees.specialization, pattern)),
        ),
      )
      .orderBy(s.employees.fullName)
      .limit(limit);
  }

  if (studentScope.kind !== "none") {
    const rows = await db
      .select({ id: s.classSections.id, grade: s.grades.nameAr, name: s.classSections.name, stageName: s.stages.nameAr })
      .from(s.classSections)
      .innerJoin(s.academicYears, eq(s.academicYears.id, s.classSections.yearId))
      .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
      .innerJoin(s.stages, eq(s.stages.id, s.grades.stageId))
      .where(and(eq(s.academicYears.status, "ACTIVE"), stageFilter(studentScope, s.stages.id), f.stageId ? eq(s.stages.id, f.stageId) : sql`true`))
      .limit(200);
    out.sections = rows
      .map((r) => ({ id: r.id, label: `${r.grade} / ${r.name}`, stageName: r.stageName }))
      .filter((r) => normalizeArabic(`${r.label} ${r.stageName}`).includes(q))
      .slice(0, limit);
  }
  return out;
}
