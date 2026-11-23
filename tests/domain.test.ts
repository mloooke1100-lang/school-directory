import { describe, expect, it } from "vitest";
import { normalizeArabic, toLikePattern } from "@/domain/arabic";
import { riyadhNow, hijriToGregorian, formatHijri, parseSourceDate, hhmmToMinutes, minutesToHHMM } from "@/domain/time";
import { currentPeriod, validatePeriods, type PeriodDef } from "@/domain/periods";
import { computeLateMinutes } from "@/domain/attendance";
import { overlaps } from "@/domain/conflicts";

describe("تطبيع البحث العربي", () => {
  it("يوحّد الهمزات والتاء المربوطة والألف المقصورة ويحذف التشكيل والتطويل", () => {
    expect(normalizeArabic("فاطمة")).toBe(normalizeArabic("فاطمه"));
    expect(normalizeArabic("أمل")).toBe(normalizeArabic("امل"));
    expect(normalizeArabic("إيمان")).toBe("ايمان");
    expect(normalizeArabic("منى")).toBe("مني");
    expect(normalizeArabic("مُحَمَّد")).toBe("محمد");
    expect(normalizeArabic("نـــورة")).toBe("نوره");
    expect(normalizeArabic("  رؤى   سعد ")).toBe("روي سعد");
    expect(normalizeArabic("١٢٣")).toBe("123");
  });
  it("يهرّب رموز LIKE لمنع حقن الأنماط", () => {
    expect(toLikePattern("50%_x")).toBe("%50\\%\\_x%");
  });
});

describe("الوقت بتوقيت الرياض والتقويم الهجري", () => {
  it("يحسب اليوم والدقيقة بتوقيت الرياض (UTC+3) لا بتوقيت الخادم", () => {
    // 2026-11-22T21:30Z = الإثنين 00:30 بالرياض
    const n = riyadhNow(new Date("2026-11-22T21:30:00Z"));
    expect(n).toEqual({ date: "2026-11-23", dayOfWeek: 1, minuteOfDay: 30 });
  });
  it("تحويل هجري ← ميلادي (أم القرى): 1 محرم 1446 = 2024-07-07", () => {
    expect(hijriToGregorian(1446, 1, 1)).toBe("2024-07-07");
  });
  it("التحويل متسق ذهابًا وإيابًا مع العرض", () => {
    const g = hijriToGregorian(1440, 5, 12);
    expect(formatHijri(g)).toContain("١٤٤٠");
  });
  it("يرفض التواريخ الهجرية غير الموجودة", () => {
    expect(() => hijriToGregorian(1440, 13, 1)).toThrow();
  });
  it("يقرأ تواريخ المستندات ويحفظ نوع التقويم، ويرفض غير المفهوم دون تخمين", () => {
    expect(parseSourceDate("1446/01/01")).toEqual({ calendar: "HIJRI", gregorian: "2024-07-07" });
    expect(parseSourceDate("١٤٤٦/١/١هـ")).toEqual({ calendar: "HIJRI", gregorian: "2024-07-07" });
    expect(parseSourceDate("2019-01-18")).toEqual({ calendar: "GREGORIAN", gregorian: "2019-01-18" });
    expect(parseSourceDate("18/01/2019")).toEqual({ calendar: "GREGORIAN", gregorian: "2019-01-18" });
    expect(parseSourceDate("2019-02-30")).toBeNull();
    expect(parseSourceDate("14?0/05/1")).toBeNull();
    expect(parseSourceDate("")).toBeNull();
  });
  it("تحويل HH:MM", () => {
    expect(hhmmToMinutes("07:15")).toBe(435);
    expect(minutesToHHMM(435)).toBe("07:15");
    expect(() => hhmmToMinutes("25:00")).toThrow();
  });
});

describe("الحصة الحالية", () => {
  const defs: PeriodDef[] = [
    { number: 1, kind: "LESSON", startMinute: 420, endMinute: 465 },
    { number: 2, kind: "LESSON", startMinute: 470, endMinute: 515 },
    { number: 90, kind: "BREAK", startMinute: 515, endMinute: 540 },
  ];
  it("بدون أوقات مُعدّة → غير مكتملة (لا حصة مفترضة)", () => {
    expect(currentPeriod([], 450, { dayOfWeek: 0 })).toEqual({ status: "NOT_CONFIGURED" });
  });
  it("داخل حصة / بين حصتين / فسحة / قبل وبعد الدوام", () => {
    expect(currentPeriod(defs, 430, { dayOfWeek: 0 })).toMatchObject({ status: "IN_PERIOD", period: { number: 1 } });
    expect(currentPeriod(defs, 467, { dayOfWeek: 0 })).toMatchObject({ status: "BETWEEN", next: { number: 2 } });
    expect(currentPeriod(defs, 520, { dayOfWeek: 0 })).toMatchObject({ status: "IN_PERIOD", period: { kind: "BREAK" } });
    expect(currentPeriod(defs, 400, { dayOfWeek: 0 })).toMatchObject({ status: "BEFORE_SCHOOL" });
    expect(currentPeriod(defs, 600, { dayOfWeek: 0 })).toEqual({ status: "AFTER_SCHOOL" });
    expect(currentPeriod(defs, 465, { dayOfWeek: 0 })).toMatchObject({ status: "BETWEEN" }); // نهاية الحصة غير مشمولة
  });
  it("الجمعة والسبت والعطل وخارج الفصل", () => {
    expect(currentPeriod(defs, 430, { dayOfWeek: 5 })).toMatchObject({ reason: "WEEKEND" });
    expect(currentPeriod(defs, 430, { dayOfWeek: 1, isHoliday: true })).toMatchObject({ reason: "HOLIDAY" });
    expect(currentPeriod(defs, 430, { dayOfWeek: 1, inTerm: false })).toMatchObject({ reason: "OUTSIDE_TERM" });
  });
  it("تعريف خاص بيوم (مثل الخميس) يحل محل العام", () => {
    const thu: PeriodDef[] = [...defs, { number: 1, kind: "LESSON", startMinute: 450, endMinute: 480, dayOfWeek: 4 }];
    expect(currentPeriod(thu, 430, { dayOfWeek: 4 })).toMatchObject({ status: "BEFORE_SCHOOL" });
    expect(currentPeriod(thu, 430, { dayOfWeek: 3 })).toMatchObject({ status: "IN_PERIOD" });
  });
  it("كشف تداخل أوقات الحصص عند الإعداد", () => {
    expect(validatePeriods(defs)).toEqual([]);
    expect(validatePeriods([...defs, { number: 3, kind: "LESSON", startMinute: 460, endMinute: 480 }]).length).toBeGreaterThan(0);
  });
});

describe("التأخر والتعارض", () => {
  it("حساب مدة التأخر تلقائيًا", () => {
    expect(computeLateMinutes(420, 437)).toBe(17);
    expect(() => computeLateMinutes(420, 420)).toThrow();
    expect(() => computeLateMinutes(420, 2000)).toThrow();
  });
  it("تداخل الفترات الزمنية نصف المفتوحة", () => {
    expect(overlaps({ startMinute: 420, endMinute: 465 }, { startMinute: 460, endMinute: 480 })).toBe(true);
    expect(overlaps({ startMinute: 420, endMinute: 465 }, { startMinute: 465, endMinute: 480 })).toBe(false);
  });
});
