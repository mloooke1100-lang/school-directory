import { and, asc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { stageScope, type AuthContext } from "@/auth/rbac";
import type { Permission } from "@/auth/permissions";
import { stageFilter } from "../scope-sql";
import { getActiveYear } from "../school";

/** شعب السنة النشطة ضمن نطاق صلاحية معيّنة (لقوائم الاختيار) */
export async function sectionOptions(db: DB, ctx: AuthContext, perm: Permission) {
  const year = await getActiveYear(db);
  if (!year) return [];
  return db
    .select({ id: s.classSections.id, name: s.classSections.name, grade: s.grades.nameAr, stage: s.stages.nameAr })
    .from(s.classSections)
    .innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId))
    .innerJoin(s.stages, eq(s.stages.id, s.grades.stageId))
    .where(and(eq(s.classSections.yearId, year.id), eq(s.classSections.isActive, true), stageFilter(stageScope(ctx, perm), s.stages.id)))
    .orderBy(asc(s.stages.order), asc(s.grades.order), asc(s.classSections.name));
}
