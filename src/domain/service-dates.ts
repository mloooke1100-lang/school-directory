/**
 * تواريخ المباشرة (الوزارة / المدرسة): يُحفظ النص الأصلي ونوع تقويمه، ويُحسب المكافئ الميلادي بتحويل أم القرى.
 * لا تخمين: صيغة غير مقروءة → خطأ واضح، وحقل فارغ → «بانتظار التحقق» بلا تاريخ.
 */
import { formatGregorian, formatHijri, parseSourceDate } from "./time";

export type Calendar = "HIJRI" | "GREGORIAN";
export type Verification = "COMPLETE" | "INCOMPLETE" | "PENDING_VERIFICATION";

export interface ServiceDateValue {
  date: string | null;
  originalCalendar: Calendar | null;
  originalText: string | null;
  verification: Verification;
}

export class ServiceDateError extends Error {}

export function resolveServiceDate(calendar: Calendar | null | undefined, text: string | null | undefined, verification: Verification): ServiceDateValue {
  const t = (text ?? "").trim();
  if (!t) return { date: null, originalCalendar: null, originalText: null, verification: verification === "COMPLETE" ? "PENDING_VERIFICATION" : verification };
  const parsed = parseSourceDate(t);
  if (!parsed) throw new ServiceDateError(`صيغة التاريخ «${t}» غير مقروءة. استخدمي مثلًا 1440/05/12 للهجري أو 2019-01-18 للميلادي.`);
  if (calendar && parsed.calendar !== calendar) {
    throw new ServiceDateError(`التاريخ «${t}» ${parsed.calendar === "HIJRI" ? "هجري" : "ميلادي"} بينما نوع التقويم المختار ${calendar === "HIJRI" ? "هجري" : "ميلادي"}.`);
  }
  return { date: parsed.gregorian, originalCalendar: parsed.calendar, originalText: t, verification };
}

/** عرض التاريخ بالهجري والميلادي معًا */
export function describeServiceDate(v: { date: string | null } | null | undefined): { hijri: string; gregorian: string } | null {
  if (!v?.date) return null;
  return { hijri: `${formatHijri(v.date)}`, gregorian: formatGregorian(v.date) };
}

export const VERIFICATION_AR: Record<Verification, string> = {
  COMPLETE: "مُتحقَّق منه",
  INCOMPLETE: "غير مكتمل",
  PENDING_VERIFICATION: "بانتظار التحقق",
};
