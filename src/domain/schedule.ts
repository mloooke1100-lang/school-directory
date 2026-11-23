/**
 * أدوات الجدولة النقية: وقت خانة الحصة من التعريفات المُعدّة، ويوم الأسبوع لتاريخ، وكشف التداخل مع الالتزامات.
 * لا أوقات مفترضة: خانة بلا تعريف → null.
 */
import { periodsForDay, type PeriodDef } from "./periods";
import { overlaps, type TimeRange } from "./conflicts";

export function slotTime(defs: PeriodDef[], dayOfWeek: number, periodNumber: number): TimeRange | null {
  const p = periodsForDay(defs, dayOfWeek).find((d) => d.number === periodNumber);
  return p ? { startMinute: p.startMinute, endMinute: p.endMinute } : null;
}

/** يوم الأسبوع (0=الأحد) لتاريخ ميلادي YYYY-MM-DD دون تأثر بالمنطقة الزمنية */
export function dayOfWeekOf(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

export interface Commitment extends TimeRange {
  kind: "LESSON" | "STANDBY" | "ACTIVITY_PERIOD" | "SUBSTITUTE" | "ACTIVITY" | "SUPERVISION";
  description: string;
  /** معرّف السجل المصدر (لاستثنائه عند تعديل السجل نفسه) */
  refId: string;
}

export const COMMITMENT_AR: Record<Commitment["kind"], string> = {
  LESSON: "حصة أساسية",
  STANDBY: "انتظار ثابت",
  ACTIVITY_PERIOD: "حصة نشاط في الجدول",
  SUBSTITUTE: "حصة انتظار",
  ACTIVITY: "نشاط",
  SUPERVISION: "مراقبة أدوار",
};

/** الالتزامات المتداخلة مع نطاق زمني (باستثناء سجلات محددة) */
export function overlapping(list: Commitment[], range: TimeRange, excludeRefIds: string[] = []): Commitment[] {
  return list.filter((c) => !excludeRefIds.includes(c.refId) && overlaps(c, range));
}

export function describeCommitments(list: Commitment[]): string[] {
  return list.map((c) => `${COMMITMENT_AR[c.kind]}: ${c.description} (${fmt(c.startMinute)}–${fmt(c.endMinute)})`);
}

const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
