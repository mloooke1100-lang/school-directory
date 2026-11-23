import { and, eq, gte, lte } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";

export async function getSchool(db: DB) {
  const [school] = await db.select().from(s.schools).limit(1);
  return school ?? null;
}

export async function getActiveYear(db: DB) {
  const [y] = await db.select().from(s.academicYears).where(eq(s.academicYears.status, "ACTIVE"));
  return y ?? null;
}

/** الفصل الدراسي الذي يقع فيه التاريخ ضمن السنة النشطة */
export async function getTermForDate(db: DB, isoDate: string) {
  const [t] = await db
    .select({ term: s.academicTerms })
    .from(s.academicTerms)
    .innerJoin(s.academicYears, eq(s.academicYears.id, s.academicTerms.yearId))
    .where(and(eq(s.academicYears.status, "ACTIVE"), lte(s.academicTerms.startDate, isoDate), gte(s.academicTerms.endDate, isoDate)));
  return t?.term ?? null;
}

export async function isHoliday(db: DB, termId: string, stageId: string, isoDate: string) {
  const rows = await db
    .select()
    .from(s.calendarExceptions)
    .where(and(eq(s.calendarExceptions.termId, termId), eq(s.calendarExceptions.type, "HOLIDAY"), lte(s.calendarExceptions.startDate, isoDate), gte(s.calendarExceptions.endDate, isoDate)));
  return rows.some((r) => r.stageId === null || r.stageId === stageId);
}
