/**
 * حساب الحصة الحالية من تعريفات الحصص المُعدّة — دون أي أوقات مفترضة.
 */
export interface PeriodDef {
  number: number;
  kind: "LESSON" | "BREAK" | "PRAYER" | "ASSEMBLY" | "OTHER";
  label?: string | null;
  startMinute: number;
  endMinute: number;
  dayOfWeek?: number | null;
}

export type CurrentPeriod =
  | { status: "NOT_CONFIGURED" } // أوقات الحصص غير مكتملة
  | { status: "NON_SCHOOL_DAY"; reason: "WEEKEND" | "HOLIDAY" | "OUTSIDE_TERM" }
  | { status: "BEFORE_SCHOOL"; next: PeriodDef }
  | { status: "IN_PERIOD"; period: PeriodDef }
  | { status: "BETWEEN"; next: PeriodDef }
  | { status: "AFTER_SCHOOL" };

export const WORK_DAYS = [0, 1, 2, 3, 4]; // الأحد–الخميس

/** يختار التعريفات السارية ليوم معين: تعريفات اليوم المحدد تحل محل العامة إن وُجدت */
export function periodsForDay(defs: PeriodDef[], dayOfWeek: number): PeriodDef[] {
  const specific = defs.filter((d) => d.dayOfWeek === dayOfWeek);
  const chosen = specific.length > 0 ? specific : defs.filter((d) => d.dayOfWeek == null);
  return [...chosen].sort((a, b) => a.startMinute - b.startMinute);
}

export function validatePeriods(defs: PeriodDef[]): string[] {
  const errors: string[] = [];
  const sorted = [...defs].sort((a, b) => a.startMinute - b.startMinute);
  for (const d of sorted) {
    if (d.endMinute <= d.startMinute) errors.push(`الفترة ${d.label ?? d.number}: وقت النهاية قبل البداية`);
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMinute < sorted[i - 1].endMinute)
      errors.push(`تداخل بين ${sorted[i - 1].label ?? sorted[i - 1].number} و${sorted[i].label ?? sorted[i].number}`);
  }
  return errors;
}

export function currentPeriod(
  defs: PeriodDef[],
  minuteOfDay: number,
  opts: { dayOfWeek: number; isHoliday?: boolean; inTerm?: boolean },
): CurrentPeriod {
  if (opts.inTerm === false) return { status: "NON_SCHOOL_DAY", reason: "OUTSIDE_TERM" };
  if (!WORK_DAYS.includes(opts.dayOfWeek)) return { status: "NON_SCHOOL_DAY", reason: "WEEKEND" };
  if (opts.isHoliday) return { status: "NON_SCHOOL_DAY", reason: "HOLIDAY" };
  const day = periodsForDay(defs, opts.dayOfWeek);
  if (day.length === 0) return { status: "NOT_CONFIGURED" };
  if (minuteOfDay < day[0].startMinute) return { status: "BEFORE_SCHOOL", next: day[0] };
  for (const p of day) {
    if (minuteOfDay >= p.startMinute && minuteOfDay < p.endMinute) return { status: "IN_PERIOD", period: p };
    if (minuteOfDay < p.startMinute) return { status: "BETWEEN", next: p };
  }
  return { status: "AFTER_SCHOOL" };
}
