import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, freshSeed, closeDb, expectDbViolation } from "./helpers";
import type { SeedResult } from "@/db/seed";
import * as s from "@/db/schema";
import { updateVersioned } from "@/server/versioned";
import { StaleRecordError } from "@/domain/conflicts";

let seed: SeedResult;
let enrollmentId: string;
beforeAll(async () => {
  seed = await freshSeed();
  const [e] = await db.select().from(s.studentEnrollments).where(eq(s.studentEnrollments.studentId, seed.studentIds[2]));
  enrollmentId = e.id;
});
afterAll(closeDb);

describe("قيود قاعدة البيانات ضد التعارض والتكرار", () => {
  it("يمنع إسناد معلمة لحصتين في الوقت نفسه", async () => {
    const c = await expectDbViolation(
      db.insert(s.timetableEntries).values({ timetableId: seed.timetableId, dayOfWeek: 0, periodNumber: 1, kind: "LESSON", sectionId: seed.sectionIds["PRIMARY:3:1"], teacherId: seed.teacherIds[0] }),
    );
    expect(c).toBe("tt_teacher_slot_uq");
  });

  it("يمنع إسناد فصل لحصتين متعارضتين", async () => {
    const c = await expectDbViolation(
      db.insert(s.timetableEntries).values({ timetableId: seed.timetableId, dayOfWeek: 0, periodNumber: 1, kind: "LESSON", sectionId: seed.sectionIds["PRIMARY:1:1"], teacherId: seed.teacherIds[3] }),
    );
    expect(c).toBe("tt_section_slot_uq");
  });

  it("يمنع حجز القاعة نفسها لحصتين", async () => {
    const [entry] = await db.select().from(s.timetableEntries).where(and(eq(s.timetableEntries.dayOfWeek, 0), eq(s.timetableEntries.periodNumber, 1)));
    const c = await expectDbViolation(
      db.insert(s.timetableEntries).values({ timetableId: seed.timetableId, dayOfWeek: 0, periodNumber: 1, kind: "LESSON", sectionId: seed.sectionIds["PRIMARY:4:1"], teacherId: seed.teacherIds[4], roomId: entry.roomId }),
    );
    expect(c).toBe("tt_room_slot_uq");
  });

  it("الحصة الأساسية تتطلب فصلًا، والانتظار الثابت لا يتطلبه", async () => {
    expect(await expectDbViolation(db.insert(s.timetableEntries).values({ timetableId: seed.timetableId, dayOfWeek: 1, periodNumber: 6, kind: "LESSON", teacherId: seed.teacherIds[4] }))).toBe("tt_lesson_needs_section_ck");
    await db.insert(s.timetableEntries).values({ timetableId: seed.timetableId, dayOfWeek: 1, periodNumber: 6, kind: "STANDBY", teacherId: seed.teacherIds[4] });
  });

  it("حصة الانتظار: لا بديلة لنفسها، ولا بديلة بحصتين في الوقت نفسه، ولا فصل بانتظارين", async () => {
    const base = { termId: seed.termId, date: "2026-11-24", periodNumber: 4, createdById: seed.userIds.vp_academic };
    expect(
      await expectDbViolation(db.insert(s.substituteAssignments).values({ ...base, sectionId: seed.sectionIds["PRIMARY:1:1"], originalTeacherId: seed.teacherIds[0], substituteTeacherId: seed.teacherIds[0] })),
    ).toBe("sub_not_self_ck");
    await db.insert(s.substituteAssignments).values({ ...base, sectionId: seed.sectionIds["PRIMARY:1:1"], originalTeacherId: seed.teacherIds[0], substituteTeacherId: seed.teacherIds[2] });
    expect(
      await expectDbViolation(db.insert(s.substituteAssignments).values({ ...base, sectionId: seed.sectionIds["PRIMARY:2:1"], substituteTeacherId: seed.teacherIds[2] })),
    ).toBe("sub_teacher_slot_uq");
    expect(
      await expectDbViolation(db.insert(s.substituteAssignments).values({ ...base, sectionId: seed.sectionIds["PRIMARY:1:1"], substituteTeacherId: seed.teacherIds[1] })),
    ).toBe("sub_section_slot_uq");
  });

  it("الانتظار لا يعدّل الجدول الأسبوعي الأصلي", async () => {
    const entries = await db.select().from(s.timetableEntries).where(and(eq(s.timetableEntries.dayOfWeek, 2), eq(s.timetableEntries.periodNumber, 1)));
    expect(entries.find((e) => e.sectionId === seed.sectionIds["PRIMARY:1:1"])?.teacherId).toBe(seed.teacherIds[0]);
  });

  it("يمنع تسجيل غياب مكرر لنفس الطالبة في نفس اليوم، ويسمح بالتصحيح مع حفظ الأثر", async () => {
    const v = { studentId: seed.studentIds[2], enrollmentId, date: "2026-11-23", type: "ABSENCE" as const, recordedById: seed.userIds.vp_students };
    const [first] = await db.insert(s.studentAttendanceEvents).values(v).returning();
    expect(await expectDbViolation(db.insert(s.studentAttendanceEvents).values(v))).toBe("attendance_active_uq");
    // التصحيح: السجل الأصلي يصبح CORRECTED ويُنشأ سجل جديد يشير إليه
    await db.transaction(async (tx) => {
      await tx.update(s.studentAttendanceEvents).set({ status: "CORRECTED" }).where(eq(s.studentAttendanceEvents.id, first.id));
      await tx.insert(s.studentAttendanceEvents).values({ ...v, absenceKind: "EXCUSED", supersedesId: first.id });
    });
    const all = await db.select().from(s.studentAttendanceEvents).where(eq(s.studentAttendanceEvents.studentId, seed.studentIds[2]));
    expect(all).toHaveLength(2);
    expect(all.find((a) => a.id === first.id)?.status).toBe("CORRECTED");
  });

  it("التأخر يتطلب وقت البداية ووقت الوصول", async () => {
    expect(
      await expectDbViolation(db.insert(s.studentAttendanceEvents).values({ studentId: seed.studentIds[2], enrollmentId, date: "2026-11-25", type: "LATE", recordedById: seed.userIds.vp_students })),
    ).toBe("attendance_late_fields_ck");
  });

  it("تاريخا المباشرة (الوزارة/المدرسة) يُحفظان منفصلين ولا يُكرّر أي منهما", async () => {
    const emp = seed.teacherIds[0];
    await db.update(s.employeeServiceDates).set({ date: "2010-09-01", originalCalendar: "GREGORIAN", originalText: "2010-09-01", verification: "COMPLETE" }).where(and(eq(s.employeeServiceDates.employeeId, emp), eq(s.employeeServiceDates.kind, "MINISTRY")));
    await db.update(s.employeeServiceDates).set({ date: "2024-07-07", originalCalendar: "HIJRI", originalText: "1446/01/01", verification: "COMPLETE" }).where(and(eq(s.employeeServiceDates.employeeId, emp), eq(s.employeeServiceDates.kind, "SCHOOL")));
    const rows = await db.select().from(s.employeeServiceDates).where(eq(s.employeeServiceDates.employeeId, emp));
    const m = rows.find((r) => r.kind === "MINISTRY")!;
    const sc = rows.find((r) => r.kind === "SCHOOL")!;
    expect(m.date).toBe("2010-09-01");
    expect(sc.date).toBe("2024-07-07");
    expect(sc.originalCalendar).toBe("HIJRI");
    expect(sc.originalText).toBe("1446/01/01");
    expect(await expectDbViolation(db.insert(s.employeeServiceDates).values({ employeeId: emp, kind: "SCHOOL" }))).toBe("service_dates_emp_kind_uq");
  });

  it("الموظفة غير الموثقة تبقى «بانتظار التحقق» دون تاريخ مخترع", async () => {
    const rows = await db.select().from(s.employeeServiceDates).where(eq(s.employeeServiceDates.employeeId, seed.teacherIds[1]));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.date).toBeNull();
      expect(r.verification).toBe("PENDING_VERIFICATION");
    }
  });

  it("سنة دراسية نشطة واحدة فقط", async () => {
    expect(
      await expectDbViolation(db.insert(s.academicYears).values({ schoolId: seed.schoolId, name: "سنة أخرى", startDate: "2027-08-01", endDate: "2028-06-01", status: "ACTIVE" })),
    ).toBe("years_one_active_uq");
  });

  it("قيد واحد لكل طالبة في السنة، مع بقاء قيود السنوات السابقة للأرشيف", async () => {
    const enr = await db.select().from(s.studentEnrollments).where(eq(s.studentEnrollments.studentId, seed.studentIds[0]));
    expect(enr).toHaveLength(2);
    expect(
      await expectDbViolation(db.insert(s.studentEnrollments).values({ studentId: seed.studentIds[0], yearId: seed.yearId, sectionId: seed.sectionIds["PRIMARY:2:1"], enrolledAt: "2026-09-01" })),
    ).toBe("enrollment_student_year_uq");
  });

  it("الأسماء المتشابهة طالبات مختلفات بمعرّفات مختلفة", async () => {
    const rows = await db.select().from(s.students);
    const f = rows.filter((r) => r.nameNormalized === rows.find((x) => x.id === seed.studentIds[0])!.nameNormalized);
    expect(f).toHaveLength(2);
    expect(f[0].id).not.toBe(f[1].id);
  });

  it("مراقبة الأدوار: يجب تحديد يوم أسبوعي أو تاريخ (أحدهما فقط)", async () => {
    const [area] = await db.select().from(s.supervisionAreas);
    const base = { termId: seed.termId, areaId: area.id, employeeId: seed.teacherIds[0], periodType: "BREAK" as const, startMinute: 555, endMinute: 580, assignedById: seed.userIds.vp_academic };
    expect(await expectDbViolation(db.insert(s.supervisionAssignments).values(base))).toBe("supervision_day_or_date_ck");
    expect(await expectDbViolation(db.insert(s.supervisionAssignments).values({ ...base, dayOfWeek: 0, date: "2026-11-23" }))).toBe("supervision_day_or_date_ck");
    await db.insert(s.supervisionAssignments).values({ ...base, dayOfWeek: 0 });
  });

  it("القفل التفاؤلي: تعديل مستخدمتين لنفس السجل — الثانية تُرفض ولا يضيع تعديل الأولى", async () => {
    const id = seed.studentIds[3];
    const [before] = await db.select().from(s.students).where(eq(s.students.id, id));
    const a = await updateVersioned(db, s.students, id, before.version, { notes: "تعديل المستخدمة الأولى" });
    expect(a.version).toBe(before.version + 1);
    await expect(updateVersioned(db, s.students, id, before.version, { notes: "تعديل المستخدمة الثانية" })).rejects.toThrow(StaleRecordError);
    const [after] = await db.select().from(s.students).where(eq(s.students.id, id));
    expect(after.notes).toBe("تعديل المستخدمة الأولى");
  });

  it("لا يوجد أي عمود لرقم السجل المدني في المخطط", async () => {
    const { rows } = await db.execute<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public'` as any,
    );
    const bad = rows.filter((r) => /national|civil|iqama|ssn|id_number/i.test(r.column_name));
    expect(bad).toEqual([]);
  });
});
