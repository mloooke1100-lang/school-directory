import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, freshSeed, closeDb } from "./helpers";
import type { SeedResult } from "@/db/seed";
import * as s from "@/db/schema";
import { loadAuthContext, ForbiddenError } from "@/auth/rbac";
import { searchDirectory } from "@/server/search";
import { getStudentNow } from "@/server/student-location";
import { getDashboard } from "@/server/dashboard";

let seed: SeedResult;
beforeAll(async () => {
  seed = await freshSeed();
});
afterAll(closeDb);

// الأحد 2026-11-22 الساعة 07:10 بالرياض = 04:10Z (داخل الحصة 1 التجريبية 07:00–07:45)
const SUN_P1 = new Date("2026-11-22T04:10:00Z");
const SUN_P2 = new Date("2026-11-22T04:50:00Z"); // 07:50 → الحصة 2
const SUN_BREAK = new Date("2026-11-22T06:20:00Z"); // 09:20 → الفسحة
const FRIDAY = new Date("2026-11-20T04:10:00Z");

describe("البحث الشامل", () => {
  it("يطابق اختلافات الكتابة (فاطمة/فاطمه) ويُرجع الطالبتين منفصلتين بالاسم الأصلي", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.principal);
    const r = await searchDirectory(db, ctx, "فاطمة علي");
    expect(r.students).toHaveLength(2);
    expect(new Set(r.students.map((x) => x.id)).size).toBe(2);
    expect(r.students.map((x) => x.fullName).sort()).toEqual(["طالبة تجريبية - فاطمة علي", "طالبة تجريبية - فاطمه علي"].sort());
  });

  it("يبحث بالرقم المدرسي", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.principal);
    const r = await searchDirectory(db, ctx, "T-1003");
    expect(r.students).toHaveLength(1);
  });

  it("يبحث عن المعلمات بالاسم أو التخصص", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.vp_academic);
    expect((await searchDirectory(db, ctx, "ريم")).employees).toHaveLength(1);
    expect((await searchDirectory(db, ctx, "رياضيات")).employees).toHaveLength(2);
  });

  it("الحساب المقيّد بالابتدائية لا يرى طالبات المتوسطة في البحث", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.primary_only);
    const all = await searchDirectory(db, ctx, "طالبة تجريبية", { limit: 100 });
    expect(all.students.length).toBeGreaterThan(0);
    expect(all.students.every((x) => x.stageName === "الابتدائية الرابعة")).toBe(true);
    const principal = await searchDirectory(db, await loadAuthContext(db, seed.userIds.principal), "طالبة تجريبية", { limit: 100 });
    expect(principal.students.length).toBeGreaterThan(all.students.length);
  });

  it("يتجاهل الاستعلامات القصيرة جدًا ويهرّب رموز LIKE", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.principal);
    expect((await searchDirectory(db, ctx, "ف")).students).toHaveLength(0);
    expect((await searchDirectory(db, ctx, "%%")).students).toHaveLength(0);
  });
});

describe("الموقع المتوقع للطالبة حسب الجدول", () => {
  it("يعرض الفصل والحصة الحالية والمعلمة", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.principal);
    const r = await getStudentNow(db, ctx, seed.studentIds[0], SUN_P1); // الأول الابتدائي/1
    expect(r.enrollment?.gradeName).toBe("الأول");
    expect(r.period).toMatchObject({ status: "IN_PERIOD", period: { number: 1 } });
    expect(r.lesson).toMatchObject({ subject: "لغة عربية", teacherName: "معلمة تجريبية - سارة أحمد", room: "قاعة 101", isSubstitute: false });
    const r2 = await getStudentNow(db, ctx, seed.studentIds[0], SUN_P2);
    expect(r2.lesson?.subject).toBe("رياضيات");
  });

  it("الفسحة والجمعة لا تُظهر حصة", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.principal);
    expect((await getStudentNow(db, ctx, seed.studentIds[0], SUN_BREAK)).lesson).toBeNull();
    expect((await getStudentNow(db, ctx, seed.studentIds[0], FRIDAY)).period).toMatchObject({ reason: "WEEKEND" });
  });

  it("مرحلة بلا أوقات حصص مُعدّة → «غير مكتملة» بدل حصة غير دقيقة", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.principal);
    const r = await getStudentNow(db, ctx, seed.studentIds[3], SUN_P1); // طالبة متوسطة
    expect(r.period).toEqual({ status: "NOT_CONFIGURED" });
    expect(r.lesson).toBeNull();
  });

  it("حصة الانتظار تظهر للطالبة في يومها دون تعديل الجدول الأسبوعي", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.principal);
    await db.insert(s.substituteAssignments).values({ termId: seed.termId, date: "2026-11-22", sectionId: seed.sectionIds["PRIMARY:1:1"], periodNumber: 1, originalTeacherId: seed.teacherIds[0], substituteTeacherId: seed.teacherIds[2], createdById: seed.userIds.vp_academic });
    const r = await getStudentNow(db, ctx, seed.studentIds[0], SUN_P1);
    expect(r.lesson).toMatchObject({ isSubstitute: true, teacherName: "معلمة تجريبية - نورة سالم", originalTeacherName: "معلمة تجريبية - سارة أحمد" });
    // الأحد التالي يعود للجدول الأساسي
    const next = await getStudentNow(db, ctx, seed.studentIds[0], new Date("2026-11-29T04:10:00Z"));
    expect(next.lesson).toMatchObject({ isSubstitute: false, teacherName: "معلمة تجريبية - سارة أحمد" });
  });

  it("الحساب المقيّد بالابتدائية يُمنع من الاطلاع على طالبة متوسطة (على الخادم)", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.primary_only);
    await expect(getStudentNow(db, ctx, seed.studentIds[3], SUN_P1)).rejects.toThrow(ForbiddenError);
  });
});

describe("لوحة التحكم", () => {
  it("الإحصاءات من قاعدة البيانات ومقيدة بالصلاحية", async () => {
    const at = new Date("2026-11-23T05:00:00Z");
    const [enr] = await db.select().from(s.studentEnrollments).where(and(eq(s.studentEnrollments.studentId, seed.studentIds[3]), eq(s.studentEnrollments.yearId, seed.yearId)));
    await db.insert(s.studentAttendanceEvents).values({ studentId: seed.studentIds[3], enrollmentId: enr.id, date: "2026-11-23", type: "ABSENCE", recordedById: seed.userIds.vp_students });

    const p = await getDashboard(db, await loadAuthContext(db, seed.userIds.principal), at);
    expect(p.counts.students).toBe(8);
    expect(p.counts.teachers).toBe(7); // 5 وهميات + معلمتا الروضة (عنصران نائبان)
    expect(p.todayCounts.absences).toBe(1);
    expect(p.alerts.some((a) => a.includes("أوقات الحصص غير مكتملة — الروضة الثانية"))).toBe(true);
    expect(p.alerts.some((a) => a.includes("الابتدائية الرابعة"))).toBe(false);
    expect(p.recent.length).toBeGreaterThanOrEqual(0);

    const limited = await getDashboard(db, await loadAuthContext(db, seed.userIds.primary_only), at);
    expect(limited.counts.students).toBe(5);
    expect(limited.todayCounts.absences).toBe(0); // غياب طالبة المتوسطة لا يظهر لها
    expect(limited.recent).toEqual([]); // لا صلاحية لسجل التدقيق
  });
});
