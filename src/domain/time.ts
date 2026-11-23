/**
 * الوقت والتاريخ بتوقيت Asia/Riyadh، والتحويل الهجري بتقويم أم القرى.
 */
export const SCHOOL_TZ = "Asia/Riyadh";

export interface LocalNow {
  date: string; // YYYY-MM-DD ميلادي
  dayOfWeek: number; // 0=الأحد
  minuteOfDay: number;
}

export function riyadhNow(at: Date = new Date()): LocalNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHOOL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    dayOfWeek: days.indexOf(get("weekday")),
    minuteOfDay: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export const DAY_NAMES_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function hhmmToMinutes(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`صيغة وقت غير صحيحة: ${s}`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) throw new Error(`وقت خارج النطاق: ${s}`);
  return h * 60 + mi;
}

/** يعرض تاريخًا ميلاديًا (YYYY-MM-DD) بالهجري (أم القرى) */
export function formatHijri(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-arab", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

export function formatGregorian(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-arab", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

function hijriParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
    timeZone: "UTC",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(d);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value.replace(/\D/g, ""));
  return { y: n("year"), m: n("month"), d: n("day") };
}

/**
 * تحويل تاريخ هجري (أم القرى) إلى ميلادي YYYY-MM-DD.
 * يعتمد على جداول Intl نفسها (بحث عكسي) لضمان الاتساق مع العرض. يرمي خطأ إن كان التاريخ غير موجود.
 */
export function hijriToGregorian(hy: number, hm: number, hd: number): string {
  if (hm < 1 || hm > 12 || hd < 1 || hd > 30) throw new Error("تاريخ هجري غير صالح");
  // تقدير أولي: 1 محرم 1 هـ ≈ 622-07-16 وطول السنة ≈ 354.367 يومًا
  const approx = Date.UTC(622, 6, 16) + ((hy - 1) * 354.367 + (hm - 1) * 29.53 + (hd - 1)) * 86400_000;
  for (let offset = -20; offset <= 20; offset++) {
    const d = new Date(approx + offset * 86400_000);
    const p = hijriParts(d);
    if (p.y === hy && p.m === hm && p.d === hd) return d.toISOString().slice(0, 10);
  }
  throw new Error("تاريخ هجري غير موجود في تقويم أم القرى");
}

/**
 * يقرأ تاريخًا كما ورد في المستندات. يدعم: 1440/05/12 أو 1440-5-12 (هجري إن كانت السنة < 1600)
 * و2019-01-18 أو 18/01/2019 (ميلادي). أي صيغة أخرى → null (يُترك «بانتظار التحقق» دون تخمين).
 */
export function parseSourceDate(
  text: string,
): { calendar: "HIJRI" | "GREGORIAN"; gregorian: string } | null {
  const t = text.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/هـ?$/, "").trim();
  let m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(t);
  let y: number, mo: number, d: number;
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else return null;
  try {
    if (y < 1600) return { calendar: "HIJRI", gregorian: hijriToGregorian(y, mo, d) };
    const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dt = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null;
    return { calendar: "GREGORIAN", gregorian: iso };
  } catch {
    return null;
  }
}
