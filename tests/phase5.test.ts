/**
 * المرحلة 5: أوقات الحصص، الجداول الأسبوعية (مسودة → اعتماد → استبدال)، حصص الانتظار، الأنشطة، ومنع التعارضات.
 * البيانات الوهمية: الابتدائية لها أوقات (1: 07:00–07:45 ...) وجدول معتمد؛ المتوسطة بلا أوقات ولا جدول.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { db, freshSeed, closeDb } from "./helpers";
import type { SeedResult } from "@/db/seed";
import * as s from "@/db/schema";
import { ForbiddenError, loadAuthContext } from "@/auth/rbac";
import { ConflictError, StaleRecordError } from "@/domain/conflicts";
import { dayOfWeekOf, slotTime } from "@/domain/schedule";
import { errorToState, ValidationError } from "@/server/forms";
import { addEntry, approveTimetable, copyToDraft, createPeriod, createTimetable, deleteEntry, deletePeriod, getTimetable } from "@/server/services/timetables";
import { availableSubstitutes, createSubstitute, listSubstitutes, updateSubstitute } from "@/server/services/substitutes";
import { createActivity, createSession, listSessions, updateSession } from "@/server/services/activities";
import { sectionDay, sectionWeek } from "@/server/services/schedule";
import { createUser } from "@/server/services/users";

let seed: SeedResult;
const ctxOf = (k: string) => loadAuthContext(db, seed.userIds[k] ?? k);
const SUN = "2026-11-22";
const MON = "2026-11-23";
const TUE = "2026-11-24";
const FRI = "2026-11-20";

beforeAll(async () => {
  seed = await freshSeed();
});
afterAll(closeDb);

describe("أدوات الجدولة النقية", () => {
  it("يوم الأسبوع ووقت الخانة من التعريفات فقط", () => {
    expect(dayOfWeekOf(SUN)).toBe(0);
    expect(dayOfWeekOf(FRI)).toBe(5);
    const defs = [
      { number: 1, kind: "LESSON" as const, startMinute: 420, endMinute: 465, dayOfWeek: null },
      { number: 1, kind: "LESSON" as const, startMinute: 450, endMinute: 490, dayOfWeek: 4 },
    ];
    expect(slotTime(defs, 0, 1)).toEqual({ startMinute: 420, endMinute: 465 });
    expect(slotTime(defs, 4, 1)).toEqual({ startMinute: 450, endMinute: 490 }); // الخميس بتوقيت مختلف
    expect(slotTime(defs, 0, 2)).toBeNull(); // لا أوقات مفترضة
  });
});

describe("أوقات الحصص لكل مرحلة", () => {
  it("إضافة أوقات المتوسطة ومنع التداخل والصيغ الخاطئة والصلاحية", async () => {
    const ctx = await ctxOf("vp_academic");
    const base = { termId: seed.termId, stageId: seed.stageIds.INTERMEDIATE, kind: "LESSON" };
    await createPeriod(db, ctx, { ...base, number: 1, start: "07:00", end: "07:50" });
    await createPeriod(db, ctx, { ...base, number: 2, start: "07:50", end: "08:40" });
    await expect(createPeriod(db, ctx, { ...base, number: 3, start: "07:30", end: "08:00" })).rejects.toBeInstanceOf(ConflictError);
    await expect(createPeriod(db, ctx, { ...base, number: 3, start: "09:00", end: "08:50" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createPeriod(db, ctx, { ...base, number: 3, start: "9am", end: "10:00" })).rejects.toBeInstanceOf(ZodError);
    await expect(createPeriod(db, await ctxOf("vp_students"), { ...base, number: 3, start: "09:00", end: "09:45" })).rejects.toBeInstanceOf(ForbiddenError);
    // تعريف خاص بيوم الخميس لا يتعارض مع العام
    await createPeriod(db, ctx, { ...base, dayOfWeek: "4", number: 1, start: "07:15", end: "08:00" });
    const dup = await createPeriod(db, ctx, { ...base, number: 1, start: "12:00", end: "12:40" }).catch((e) => e);
    expect(errorToState(dup).error).toContain("رقم الفترة مستخدم");
  });

  it("لا تُحذف فترة يستخدمها جدول حالي", async () => {
    const ctx = await ctxOf("vp_academic");
    const [p1] = await db.select().from(s.periodDefinitions).where(and(eq(s.periodDefinitions.stageId, seed.stageIds.PRIMARY), eq(s.periodDefinitions.number, 1)));
    await expect(deletePeriod(db, ctx, p1.id)).rejects.toThrow(/تستخدمها/);
  });
});

describe("الجدول الأسبوعي: مسودة → اعتماد → استبدال، ومنع التعارضات", () => {
  let draftId = "";
  const I1 = () => seed.sectionIds["INTERMEDIATE:1:1"];
  const I2 = () => seed.sectionIds["INTERMEDIATE:2:1"];
  let subjectId = "";

  it("إنشاء مسودة واحدة فقط لكل مرحلة وفصل دراسي", async () => {
    const ctx = await ctxOf("vp_academic");
    draftId = (await createTimetable(db, ctx, { termId: seed.termId, stageId: seed.stageIds.INTERMEDIATE, name: "جدول المتوسطة (تجريبي)" })).id;
    const dup = await createTimetable(db, ctx, { termId: seed.termId, stageId: seed.stageIds.INTERMEDIATE, name: "ثانٍ" }).catch((e) => e);
    expect(errorToState(dup).error).toContain("توجد مسودة");
    [{ id: subjectId }] = await db.select().from(s.subjects).where(eq(s.subjects.stageId, seed.stageIds.INTERMEDIATE));
  });

  it("إضافة حصة صحيحة، ورفض: حصة بلا مادة، حصة غير معرّفة، فصل من مرحلة أخرى", async () => {
    const ctx = await ctxOf("vp_academic");
    const e = await addEntry(db, ctx, draftId, { dayOfWeek: 0, periodNumber: 2, kind: "LESSON", sectionId: I1(), subjectId, teacherId: seed.teacherIds[3] });
    expect(e?.id).toBeTruthy();
    await expect(addEntry(db, ctx, draftId, { dayOfWeek: 0, periodNumber: 1, sectionId: I1(), teacherId: seed.teacherIds[3] })).rejects.toThrow(/المادة/);
    await expect(addEntry(db, ctx, draftId, { dayOfWeek: 0, periodNumber: 5, sectionId: I1(), subjectId, teacherId: seed.teacherIds[3] })).rejects.toThrow(/غير معرّفة/);
    await expect(addEntry(db, ctx, draftId, { dayOfWeek: 0, periodNumber: 1, sectionId: seed.sectionIds["PRIMARY:1:1"], subjectId, teacherId: seed.teacherIds[3] })).rejects.toThrow(/لا يتبع/);
  });

  it("منع تعارض المعلمة والفصل داخل الجدول برسالة واضحة", async () => {
    const ctx = await ctxOf("vp_academic");
    const teacherDup = await addEntry(db, ctx, draftId, { dayOfWeek: 0, periodNumber: 2, sectionId: I2(), subjectId, teacherId: seed.teacherIds[3] }).catch((e) => e);
    expect(teacherDup).toBeInstanceOf(ConflictError);
    expect(teacherDup.message).toContain("المعلمة مكلفة");
    const sectionDup = await addEntry(db, ctx, draftId, { dayOfWeek: 0, periodNumber: 2, sectionId: I1(), subjectId, teacherId: seed.teacherIds[4] }).catch((e) => e);
    expect(sectionDup.message).toContain("الفصل مسند");
  });

  it("منع تعارض معلمة وقاعة بين المراحل بالوقت الفعلي (07:00–07:50 يتداخل مع حصة الابتدائية 07:00–07:45)", async () => {
    const ctx = await ctxOf("vp_academic");
    const t = await addEntry(db, ctx, draftId, { dayOfWeek: 0, periodNumber: 1, sectionId: I1(), subjectId, teacherId: seed.teacherIds[0] }).catch((e) => e);
    expect(t).toBeInstanceOf(ConflictError);
    expect(t.message).toContain("الابتدائية الرابعة الحصة 1");
    const [room101] = await db.select().from(s.rooms).where(eq(s.rooms.name, "قاعة 101"));
    const r = await addEntry(db, ctx, draftId, { dayOfWeek: 0, periodNumber: 1, sectionId: I1(), subjectId, teacherId: seed.teacherIds[4], roomId: room101.id }).catch((e) => e);
    expect(r.message).toContain("القاعة محجوزة");
    // بلا القاعة تُقبل
    expect((await addEntry(db, ctx, draftId, { dayOfWeek: 0, periodNumber: 1, sectionId: I1(), subjectId, teacherId: seed.teacherIds[4] }))?.id).toBeTruthy();
  });

  it("الاعتماد بصلاحية الاعتماد فقط؛ المعتمد لا يُعدّل، والنسخة الجديدة تستبدله دون حذف", async () => {
    const t0 = await getTimetable(db, await ctxOf("vp_academic"), draftId);
    await expect(approveTimetable(db, await ctxOf("directory"), draftId, { version: t0!.version })).rejects.toBeInstanceOf(ForbiddenError);
    const ctx = await ctxOf("vp_academic");
    const approved = await approveTimetable(db, ctx, draftId, { version: t0!.version });
    expect(approved.status).toBe("APPROVED");
    await expect(addEntry(db, ctx, draftId, { dayOfWeek: 1, periodNumber: 1, sectionId: I1(), subjectId, teacherId: seed.teacherIds[3] })).rejects.toThrow(/لا يُعدَّل مباشرة/);
    const copy = await copyToDraft(db, ctx, draftId);
    const copyFull = await getTimetable(db, ctx, copy.id);
    expect(copyFull!.entries).toHaveLength(2);
    await deleteEntry(db, ctx, copyFull!.entries[0].e.id);
    await addEntry(db, ctx, copy.id, { dayOfWeek: 1, periodNumber: 1, sectionId: I1(), subjectId, teacherId: seed.teacherIds[3] });
    await expect(approveTimetable(db, ctx, copy.id, { version: copyFull!.version + 5 })).rejects.toBeInstanceOf(StaleRecordError);
    await approveTimetable(db, ctx, copy.id, { version: copyFull!.version });
    const [old] = await db.select().from(s.weeklyTimetables).where(eq(s.weeklyTimetables.id, draftId));
    expect(old.status).toBe("SUPERSEDED");
    expect(await db.select().from(s.timetableEntries).where(eq(s.timetableEntries.timetableId, draftId))).toHaveLength(2); // الأثر باقٍ
  });

  it("تقييد المرحلة: وكيلة مقيّدة بالابتدائية لا تعدّل جدول المتوسطة", async () => {
    const principal = await ctxOf("principal");
    const u = await createUser(db, principal, { username: "test.vpa.primary", displayName: "وكيلة تعليمية للابتدائية", role_VP_ACADEMIC: "on", stage_VP_ACADEMIC: seed.stageIds.PRIMARY });
    const ctx = await loadAuthContext(db, u.user.id);
    await expect(createTimetable(db, ctx, { termId: seed.termId, stageId: seed.stageIds.INTERMEDIATE, name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createPeriod(db, ctx, { termId: seed.termId, stageId: seed.stageIds.INTERMEDIATE, number: 9, kind: "LESSON", start: "12:00", end: "12:30" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("عرض الجدول الأسبوعي للشعبة من الجدول المعتمد", async () => {
    const w = await sectionWeek(db, await ctxOf("principal"), seed.sectionIds["PRIMARY:1:1"], SUN);
    expect(w?.status).toBe("OK");
    if (w?.status !== "OK") return;
    expect(w.cells.get("0:1")).toMatchObject({ subject: "لغة عربية", teacher: "معلمة تجريبية - سارة أحمد" });
    expect(w.cells.get("3:2")).toMatchObject({ subject: "رياضيات" });
  });
});

describe("حصص الانتظار", () => {
  const P1 = () => seed.sectionIds["PRIMARY:1:1"];
  const P2 = () => seed.sectionIds["PRIMARY:2:1"];
  let subId = "";

  it("إضافة حصة انتظار تأخذ المعلمة الأصلية والوقت من الجدول ولا تعدّل الأسبوعي", async () => {
    const ctx = await ctxOf("vp_academic");
    const before = await db.select().from(s.timetableEntries).where(eq(s.timetableEntries.timetableId, seed.timetableId));
    const sub = await createSubstitute(db, ctx, { date: SUN, sectionId: P1(), periodNumber: 1, substituteTeacherId: seed.teacherIds[2] });
    subId = sub.id;
    expect(sub).toMatchObject({ originalTeacherId: seed.teacherIds[0], startMinute: 420, endMinute: 465, status: "PLANNED" });
    const after = await db.select().from(s.timetableEntries).where(eq(s.timetableEntries.timetableId, seed.timetableId));
    expect(after).toEqual(before);
    // يظهر في جدول ذلك اليوم فقط
    const day = await sectionDay(db, ctx, P1(), SUN);
    expect(day?.status === "OK" && day.slots.find((x) => x.number === 1)?.lesson?.substitute).toBe("معلمة تجريبية - نورة سالم");
    const nextWeek = await sectionDay(db, ctx, P1(), "2026-11-29");
    expect(nextWeek?.status === "OK" && nextWeek.slots.find((x) => x.number === 1)?.lesson?.substitute).toBeNull();
    expect((await listSubstitutes(db, ctx, SUN)).map((x) => x.id)).toContain(subId);
  });

  it("حصة انتظار تتعارض مع جدول البديلة تُرفض", async () => {
    const ctx = await ctxOf("vp_academic");
    const e = await createSubstitute(db, ctx, { date: SUN, sectionId: P2(), periodNumber: 2, substituteTeacherId: seed.teacherIds[1] }).catch((x) => x); // هيا لديها حصة الثانية مع الأول/1
    expect(e).toBeInstanceOf(ConflictError);
    expect(e.message).toContain("حصة أساسية");
  });

  it("تكرار الانتظار لنفس الفصل والحصة يُرفض برسالة واضحة", async () => {
    const e = await createSubstitute(db, await ctxOf("vp_academic"), { date: SUN, sectionId: P1(), periodNumber: 1, substituteTeacherId: seed.teacherIds[4] }).catch((x) => x);
    expect(errorToState(e).error).toContain("توجد حصة انتظار مسجلة");
  });

  it("أيام وحصص غير صالحة: الجمعة، الفسحة، خانة بلا حصة، ومعلمة الحصة نفسها", async () => {
    const ctx = await ctxOf("vp_academic");
    await expect(createSubstitute(db, ctx, { date: FRI, sectionId: P1(), periodNumber: 1, substituteTeacherId: seed.teacherIds[4] })).rejects.toThrow(/ليس يوم دراسة/);
    await expect(createSubstitute(db, ctx, { date: MON, sectionId: P1(), periodNumber: 90, substituteTeacherId: seed.teacherIds[4] })).rejects.toThrow(/غير معرّف كحصة/);
    await expect(createSubstitute(db, ctx, { date: MON, sectionId: P1(), periodNumber: 4, substituteTeacherId: seed.teacherIds[4] })).rejects.toThrow(/لا توجد حصة/);
    await expect(createSubstitute(db, ctx, { date: MON, sectionId: P1(), periodNumber: 1, substituteTeacherId: seed.teacherIds[0] })).rejects.toThrow(/نفسها/);
    await expect(createSubstitute(db, await ctxOf("vp_students"), { date: MON, sectionId: P1(), periodNumber: 1, substituteTeacherId: seed.teacherIds[4] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("اقتراح البديلات: المعلمة الغائبة المغطاة تصبح متاحة، والمكلّفة بانتظار تصبح مشغولة", async () => {
    const r = await availableSubstitutes(db, await ctxOf("vp_academic"), SUN, P2(), 1); // حصة هيا (الثاني/1)
    const byName = (n: string) => r.teachers.find((t) => t.fullName.includes(n))!;
    expect(byName("سارة").free).toBe(true); // غُطّيت حصتها بالانتظار
    expect(byName("نورة").free).toBe(false);
    expect(byName("نورة").reason).toContain("حصة انتظار");
  });

  it("مراقبة أدوار تتعارض مع الانتظار، والإلغاء يغيّر الحالة دون حذف ويقبل القفل التفاؤلي", async () => {
    const ctx = await ctxOf("vp_academic");
    const [area] = await db.select().from(s.supervisionAreas).limit(1);
    await db.insert(s.supervisionAssignments).values({ termId: seed.termId, areaId: area.id, employeeId: seed.teacherIds[4], dayOfWeek: 2, periodType: "BEFORE_SCHOOL", startMinute: 410, endMinute: 440, assignedById: seed.userIds.vp_academic });
    const e = await createSubstitute(db, ctx, { date: TUE, sectionId: P1(), periodNumber: 1, substituteTeacherId: seed.teacherIds[4] }).catch((x) => x);
    expect(e.message).toContain("مراقبة أدوار");
    const [row] = await db.select().from(s.substituteAssignments).where(eq(s.substituteAssignments.id, subId));
    const cancelled = await updateSubstitute(db, ctx, subId, { version: row.version, status: "CANCELLED" });
    expect(cancelled.status).toBe("CANCELLED");
    await expect(updateSubstitute(db, ctx, subId, { version: row.version, status: "CONFIRMED" })).rejects.toBeInstanceOf(StaleRecordError);
    await expect(updateSubstitute(db, ctx, subId, { version: cancelled.version, status: "CONFIRMED" })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.select().from(s.substituteAssignments).where(eq(s.substituteAssignments.id, subId))).toHaveLength(1);
  });
});

describe("الأنشطة", () => {
  let actId = "";
  const P3 = () => seed.sectionIds["PRIMARY:3:1"];
  it("إضافة نشاط بصلاحية فقط", async () => {
    await expect(createActivity(db, await ctxOf("vp_students"), { name: "x", stageId: seed.stageIds.PRIMARY })).rejects.toBeInstanceOf(ForbiddenError);
    actId = (await createActivity(db, await ctxOf("vp_academic"), { name: "نشاط تجريبي - الكشافة", stageId: seed.stageIds.PRIMARY })).id;
  });

  it("منع التعارضات: المشرفة لديها حصة، القاعة محجوزة لحصة، القاعة أو الفصل محجوزان لنشاط آخر", async () => {
    const ctx = await ctxOf("vp_academic");
    const base = { activityId: actId, date: MON, start: "07:10", end: "07:40", sectionId: P3() };
    const sup = await createSession(db, ctx, { ...base, supervisorId: seed.teacherIds[0] }).catch((x) => x);
    expect(sup.message).toContain("المشرفة مكلفة");
    const [room101] = await db.select().from(s.rooms).where(eq(s.rooms.name, "قاعة 101"));
    const room = await createSession(db, ctx, { ...base, supervisorId: seed.teacherIds[4], roomId: room101.id }).catch((x) => x);
    expect(room.message).toContain("القاعة محجوزة لحصة");
    const ok = await createSession(db, ctx, { ...base, supervisorId: seed.teacherIds[4], location: "الساحة" });
    expect(ok.status).toBe("PLANNED");
    const sameSection = await createSession(db, ctx, { ...base, start: "07:20", end: "07:50", supervisorId: seed.teacherIds[3] }).catch((x) => x);
    expect(sameSection.message).toContain("للفصل نشاط");
    const [room201] = await db.select().from(s.rooms).where(eq(s.rooms.name, "قاعة 201"));
    await createSession(db, ctx, { activityId: actId, date: MON, start: "10:00", end: "11:00", groupName: "مجموعة أ", supervisorId: seed.teacherIds[4], roomId: room201.id });
    const r2 = await createSession(db, ctx, { activityId: actId, date: MON, start: "10:30", end: "11:30", groupName: "مجموعة ب", supervisorId: seed.teacherIds[3], roomId: room201.id }).catch((x) => x);
    expect(r2.message).toContain("القاعة محجوزة لنشاط");
    await expect(createSession(db, ctx, { ...base, start: "12:00", end: "11:00", supervisorId: seed.teacherIds[3] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSession(db, ctx, { activityId: actId, date: MON, start: "12:00", end: "12:30", supervisorId: seed.teacherIds[3] })).rejects.toThrow(/المجموعة/);
  });

  it("النشاط يمنع تكليف المشرفة بانتظار في الوقت نفسه، ويظهر في جدول يوم الفصل، والإلغاء بالحالة", async () => {
    const ctx = await ctxOf("vp_academic");
    const e = await createSubstitute(db, ctx, { date: MON, sectionId: seed.sectionIds["PRIMARY:1:1"], periodNumber: 1, substituteTeacherId: seed.teacherIds[4] }).catch((x) => x);
    expect(e.message).toContain("نشاط");
    const day = await sectionDay(db, ctx, P3(), MON);
    expect(day?.status === "OK" && day.activities.map((a) => a.name)).toContain("نشاط تجريبي - الكشافة");
    const list = await listSessions(db, ctx, MON, MON);
    expect(list.length).toBe(2);
    const s0 = list[0];
    await updateSession(db, ctx, s0.id, { version: s0.version, status: "CANCELLED" });
    expect((await listSessions(db, ctx, MON, MON)).find((x) => x.id === s0.id)?.status).toBe("CANCELLED");
  });
});

describe("المواد والقاعات", () => {
  it("إضافة مادة وقاعة بصلاحية، ومنع التكرار، وتقييد المادة بالمرحلة", async () => {
    const { createSubject, createRoom } = await import("@/server/services/catalog");
    const ctx = await ctxOf("vp_academic");
    await createSubject(db, ctx, { nameAr: "مادة تجريبية", stageId: seed.stageIds.KINDERGARTEN });
    const dup = await createSubject(db, ctx, { nameAr: "مادة تجريبية", stageId: seed.stageIds.KINDERGARTEN }).catch((e) => e);
    expect(errorToState(dup).error).toContain("موجودة مسبقًا");
    await createRoom(db, ctx, { name: "قاعة تجريبية", capacity: "30" });
    expect(errorToState(await createRoom(db, ctx, { name: "قاعة تجريبية" }).catch((e) => e)).error).toBe("توجد قاعة بالاسم نفسه.");
    await expect(createSubject(db, await ctxOf("vp_students"), { nameAr: "س", stageId: seed.stageIds.PRIMARY })).rejects.toBeInstanceOf(ForbiddenError);
    const prim = await loadAuthContext(db, (await db.select().from(s.users).where(eq(s.users.username, "test.vpa.primary")))[0].id);
    await expect(createSubject(db, prim, { nameAr: "س", stageId: seed.stageIds.INTERMEDIATE })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
