/**
 * المرحلة 6: الغياب والتأخر والاستئذان والانقطاع والنقل (مع الاعتماد والتصحيح دون فقدان الأثر)، ومراقبة الأدوار.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { db, freshSeed, closeDb } from "./helpers";
import type { SeedResult } from "@/db/seed";
import * as s from "@/db/schema";
import { ForbiddenError, loadAuthContext } from "@/auth/rbac";
import { ConflictError, StaleRecordError } from "@/domain/conflicts";
import { ValidationError } from "@/server/forms";
import { approveEvent, cancelEvent, correctEvent, dailyLog, recordAbsences, recordLate, sectionRoster, studentAttendanceHistory } from "@/server/services/attendance";
import { cancelLeave, createLeave, decideLeave, listLeaves, recordLeaveExit } from "@/server/services/leaves";
import { createStatusChange, decideStatusChange, listStatusChanges } from "@/server/services/status-changes";
import { createArea, createAssignment, createFloor, dailySupervision, updateAssignment, weeklySupervision } from "@/server/services/supervision";
import { createSubstitute } from "@/server/services/substitutes";

let seed: SeedResult;
const ctxOf = (k: string) => loadAuthContext(db, seed.userIds[k] ?? k);
const SUN = "2026-11-22";
const P1 = () => seed.sectionIds["PRIMARY:1:1"]; // الطالبات 0،1،4
const enrollmentStatus = async (studentId: string) => (await db.select().from(s.studentEnrollments).where(and(eq(s.studentEnrollments.studentId, studentId), eq(s.studentEnrollments.yearId, seed.yearId))))[0].status;

beforeAll(async () => {
  seed = await freshSeed();
});
afterAll(closeDb);

describe("الغياب", () => {
  it("تسجيل غياب جماعي لفصل، وتخطّي المسجّل مسبقًا دون تكرار", async () => {
    const ctx = await ctxOf("vp_students");
    expect(await recordAbsences(db, ctx, { sectionId: P1(), date: SUN, studentIds: [seed.studentIds[0], seed.studentIds[1]] })).toEqual({ created: 2, skipped: 0 });
    expect(await recordAbsences(db, ctx, { sectionId: P1(), date: SUN, studentIds: seed.studentIds[0] })).toEqual({ created: 0, skipped: 1 });
    const roster = await sectionRoster(db, ctx, P1(), SUN);
    expect(roster.rows.filter((r) => r.absence).length).toBe(2);
    expect(roster.defaultStart).toBe(420);
  });

  it("رفض: تاريخ مستقبلي، الجمعة، طالبة من فصل آخر، بلا اختيار، وبلا صلاحية أو خارج المرحلة", async () => {
    const ctx = await ctxOf("vp_students");
    await expect(recordAbsences(db, ctx, { sectionId: P1(), date: "2027-01-03", studentIds: seed.studentIds[4] })).rejects.toThrow(/المستقبل/);
    await expect(recordAbsences(db, ctx, { sectionId: P1(), date: "2026-11-20", studentIds: seed.studentIds[4] })).rejects.toThrow(/ليس يوم دراسة/);
    await expect(recordAbsences(db, ctx, { sectionId: P1(), date: SUN, studentIds: seed.studentIds[3] })).rejects.toThrow(/ليست منتظمة/);
    await expect(recordAbsences(db, ctx, { sectionId: P1(), date: SUN })).rejects.toBeInstanceOf(ZodError);
    await expect(recordAbsences(db, await ctxOf("vp_academic"), { sectionId: P1(), date: SUN, studentIds: seed.studentIds[4] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordAbsences(db, await ctxOf("primary_only"), { sectionId: seed.sectionIds["INTERMEDIATE:1:1"], date: SUN, studentIds: seed.studentIds[3] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("التصحيح سجل جديد يشير للقديم ويصبح القديم «مصحّحًا»، مع القفل التفاؤلي", async () => {
    const ctx = await ctxOf("vp_students");
    const [old] = await db.select().from(s.studentAttendanceEvents).where(and(eq(s.studentAttendanceEvents.studentId, seed.studentIds[0]), eq(s.studentAttendanceEvents.date, SUN)));
    const fixed = await correctEvent(db, ctx, old.id, { version: old.version, absenceKind: "EXCUSED", notes: "عذر طبي" });
    expect(fixed.supersedesId).toBe(old.id);
    expect(fixed.absenceKind).toBe("EXCUSED");
    const [o2] = await db.select().from(s.studentAttendanceEvents).where(eq(s.studentAttendanceEvents.id, old.id));
    expect(o2.status).toBe("CORRECTED");
    await expect(correctEvent(db, ctx, old.id, { version: old.version, absenceKind: "UNEXCUSED" })).rejects.toBeInstanceOf(StaleRecordError);
    const hist = await studentAttendanceHistory(db, ctx, seed.studentIds[0]);
    expect(hist.map((h) => h.e.status).sort()).toEqual(["CORRECTED", "RECORDED"]);
  });

  it("الاعتماد بصلاحية الاعتماد فقط، والإلغاء بالحالة دون حذف ثم يمكن التسجيل مجددًا", async () => {
    const [ev] = await db.select().from(s.studentAttendanceEvents).where(and(eq(s.studentAttendanceEvents.studentId, seed.studentIds[1]), eq(s.studentAttendanceEvents.date, SUN)));
    await expect(approveEvent(db, await ctxOf("directory"), ev.id, { version: ev.version })).rejects.toBeInstanceOf(ForbiddenError);
    const ap = await approveEvent(db, await ctxOf("vp_students"), ev.id, { version: ev.version });
    expect(ap.status).toBe("APPROVED");
    const c = await cancelEvent(db, await ctxOf("vp_students"), ev.id, { version: ap.version, notes: "سُجّل بالخطأ" });
    expect(c.status).toBe("CANCELLED");
    expect(await recordAbsences(db, await ctxOf("vp_students"), { sectionId: P1(), date: SUN, studentIds: seed.studentIds[1] })).toEqual({ created: 1, skipped: 0 });
    expect((await db.select().from(s.studentAttendanceEvents).where(eq(s.studentAttendanceEvents.id, ev.id)))).toHaveLength(1);
  });

  it("لا تحويل آلي إلى «منقطعة» مهما تكرر الغياب", async () => {
    const ctx = await ctxOf("vp_students");
    for (const d of ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]) {
      await recordAbsences(db, ctx, { sectionId: P1(), date: d, studentIds: seed.studentIds[1], absenceKind: "UNEXCUSED" });
    }
    expect(await enrollmentStatus(seed.studentIds[1])).toBe("ACTIVE");
  });
});

describe("التأخر", () => {
  it("يحسب مدة التأخر تلقائيًا من بداية الدوام المُعدّة، ويمنع التكرار والتعارض مع الغياب", async () => {
    const ctx = await ctxOf("vp_students");
    const late = await recordLate(db, ctx, { sectionId: P1(), studentId: seed.studentIds[4], date: SUN, arrival: "07:20" });
    expect(late).toMatchObject({ schoolStartMinute: 420, arrivalMinute: 440, lateMinutes: 20 });
    await expect(recordLate(db, ctx, { sectionId: P1(), studentId: seed.studentIds[4], date: SUN, arrival: "07:25" })).rejects.toBeInstanceOf(ConflictError);
    await expect(recordLate(db, ctx, { sectionId: P1(), studentId: seed.studentIds[0], date: SUN, arrival: "07:25" })).rejects.toThrow(/غياب مسجّل/);
    await expect(recordAbsences(db, ctx, { sectionId: P1(), date: SUN, studentIds: seed.studentIds[4] })).rejects.toThrow(/تأخرها/);
    await expect(recordLate(db, ctx, { sectionId: P1(), studentId: seed.studentIds[4], date: "2026-11-23", arrival: "06:50" })).rejects.toThrow(/ليس بعد بداية الدوام/);
    const fixed = await correctEvent(db, ctx, late.id, { version: late.version, arrival: "07:30" });
    expect(fixed.lateMinutes).toBe(30);
  });

  it("مرحلة بلا أوقات حصص: يُطلب وقت بداية الدوام يدويًا ولا يُفترض", async () => {
    const ctx = await ctxOf("vp_students");
    await expect(recordLate(db, ctx, { sectionId: seed.sectionIds["INTERMEDIATE:1:1"], studentId: seed.studentIds[3], date: SUN, arrival: "07:20" })).rejects.toThrow(/يدويًا/);
    const r = await recordLate(db, ctx, { sectionId: seed.sectionIds["INTERMEDIATE:1:1"], studentId: seed.studentIds[3], date: SUN, arrival: "07:20", schoolStart: "07:00" });
    expect(r.lateMinutes).toBe(20);
    expect((await dailyLog(db, ctx, SUN)).length).toBeGreaterThanOrEqual(4);
  });
});

describe("الاستئذان", () => {
  it("طلب → اعتماد → خروج، مع منع التكرار والتحقق من الأوقات والصلاحيات", async () => {
    const ctx = await ctxOf("vp_students");
    const l = await createLeave(db, ctx, { sectionId: P1(), studentId: seed.studentIds[4], date: SUN, requestTime: "10:00", reason: "موعد طبي" });
    expect(l.status).toBe("PENDING");
    await expect(createLeave(db, ctx, { sectionId: P1(), studentId: seed.studentIds[4], date: SUN, requestTime: "11:00", reason: "x" })).rejects.toBeInstanceOf(ConflictError);
    await expect(createLeave(db, ctx, { sectionId: P1(), studentId: seed.studentIds[4], date: SUN, requestTime: "11:00", reason: "" })).rejects.toBeInstanceOf(ZodError);
    await expect(decideLeave(db, await ctxOf("vp_academic"), l.id, { version: l.version, decision: "APPROVED" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordLeaveExit(db, ctx, l.id, { version: l.version, exitTime: "10:10" })).rejects.toThrow(/بعد اعتماد/);
    const ap = await decideLeave(db, ctx, l.id, { version: l.version, decision: "APPROVED" });
    expect(ap.approvedById).toBe(seed.userIds.vp_students);
    await expect(recordLeaveExit(db, ctx, l.id, { version: ap.version, exitTime: "09:00" })).rejects.toThrow(/قبل وقت الاستئذان/);
    const done = await recordLeaveExit(db, ctx, l.id, { version: ap.version, exitTime: "10:15" });
    expect(done).toMatchObject({ status: "COMPLETED", exitMinute: 615 });
    await expect(cancelLeave(db, ctx, l.id, { version: done.version })).rejects.toBeInstanceOf(ValidationError);
    expect((await listLeaves(db, ctx, SUN)).map((x) => x.l.id)).toContain(l.id);
  });
});

describe("الانقطاع والنقل", () => {
  it("لا تتغير حالة القيد إلا بالاعتماد؛ النقل يحفظ الطالبة وقيدها، وإعادة القيد ممكنة", async () => {
    const ctx = await ctxOf("vp_students");
    const st = seed.studentIds[5];
    await expect(createStatusChange(db, ctx, { studentId: st, type: "DROPOUT", effectiveDate: SUN })).rejects.toThrow(/المرجع الإداري/);
    await expect(createStatusChange(db, ctx, { studentId: st, type: "TRANSFER_OUT", effectiveDate: SUN })).rejects.toThrow(/المنقول إليها/);
    const req = await createStatusChange(db, ctx, { studentId: st, type: "TRANSFER_OUT", effectiveDate: SUN, destinationSchool: "مدرسة تجريبية أخرى", reference: "خطاب تجريبي 1" });
    expect(await enrollmentStatus(st)).toBe("ACTIVE");
    await expect(createStatusChange(db, ctx, { studentId: st, type: "WITHDRAWAL", effectiveDate: SUN })).rejects.toBeInstanceOf(ConflictError);
    await expect(decideStatusChange(db, await ctxOf("vp_academic"), req.id, { version: req.version, decision: "APPROVED" })).rejects.toBeInstanceOf(ForbiddenError);
    await decideStatusChange(db, ctx, req.id, { version: req.version, decision: "APPROVED" });
    expect(await enrollmentStatus(st)).toBe("TRANSFERRED_OUT");
    expect(await db.select().from(s.students).where(eq(s.students.id, st))).toHaveLength(1);
    await expect(decideStatusChange(db, ctx, req.id, { version: req.version + 1, decision: "REJECTED" })).rejects.toThrow(/قيد الاعتماد/);
    const back = await createStatusChange(db, ctx, { studentId: st, type: "REINSTATEMENT", effectiveDate: "2026-11-23", reference: "خطاب تجريبي 2" });
    await decideStatusChange(db, ctx, back.id, { version: back.version, decision: "APPROVED" });
    expect(await enrollmentStatus(st)).toBe("ACTIVE");
  });

  it("رفض طلب الانقطاع لا يغيّر القيد، والمقيّدة بالمرحلة لا تطلب لمرحلة أخرى", async () => {
    const ctx = await ctxOf("vp_students");
    const d = await createStatusChange(db, ctx, { studentId: seed.studentIds[2], type: "DROPOUT", effectiveDate: SUN, reference: "محضر تجريبي" });
    await decideStatusChange(db, ctx, d.id, { version: d.version, decision: "REJECTED", notes: "لم تستوف الإجراءات" });
    expect(await enrollmentStatus(seed.studentIds[2])).toBe("ACTIVE");
    await expect(createStatusChange(db, await ctxOf("primary_only"), { studentId: seed.studentIds[3], type: "WITHDRAWAL", effectiveDate: SUN })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listStatusChanges(db, ctx)).length).toBe(3);
  });
});

describe("مراقبة الأدوار", () => {
  let areaId = "";
  it("تعريف المبنى والدور والمنطقة بصلاحية فقط", async () => {
    await expect(createFloor(db, await ctxOf("vp_students"), { building: "x", name: "y" })).rejects.toBeInstanceOf(ForbiddenError);
    const ctx = await ctxOf("vp_academic");
    const f = await createFloor(db, ctx, { building: "مبنى تجريبي", name: "الدور الثاني", order: 2 });
    areaId = (await createArea(db, ctx, { floorId: f.id, name: "ممر تجريبي" })).id;
  });

  it("تكليف أسبوعي ويومي مع منع التعارض مع الحصص والمراقبة الأخرى والتحقق من المدخلات", async () => {
    const ctx = await ctxOf("vp_academic");
    const base = { areaId, employeeId: seed.teacherIds[0], mode: "WEEKLY", dayOfWeek: "0", periodType: "BREAK" };
    const lesson = await createAssignment(db, ctx, { ...base, periodType: "BEFORE_SCHOOL", start: "07:10", end: "07:30" }).catch((e) => e);
    expect(lesson).toBeInstanceOf(ConflictError);
    expect(lesson.message).toContain("حصة أساسية");
    const ok = await createAssignment(db, ctx, { ...base, start: "09:15", end: "09:40" });
    expect(ok).toMatchObject({ dayOfWeek: 0, date: null, startMinute: 555 });
    await expect(createAssignment(db, ctx, { ...base, start: "09:20", end: "09:30" })).rejects.toThrow(/مراقبة أدوار/);
    await expect(createAssignment(db, ctx, { ...base, dayOfWeek: "", start: "09:15", end: "09:40" })).rejects.toBeInstanceOf(ZodError);
    await expect(createAssignment(db, ctx, { ...base, start: "10:00", end: "09:00" })).rejects.toBeInstanceOf(ZodError);
    const daily = await createAssignment(db, ctx, { areaId, employeeId: seed.teacherIds[3], mode: "DATE", date: "2026-11-24", periodType: "DISMISSAL", start: "12:00", end: "12:30" });
    expect(daily.dayOfWeek).toBeNull();
    // جدول يوم الأحد يعرض التكليف الأسبوعي، والجدول الأسبوعي لا يعرض الخاص بتاريخ
    expect((await dailySupervision(db, ctx, SUN))!.rows.map((r) => r.a.id)).toContain(ok.id);
    expect((await dailySupervision(db, ctx, "2026-11-24"))!.rows.map((r) => r.a.id)).toContain(daily.id);
    expect((await weeklySupervision(db, ctx, SUN))!.rows.map((r) => r.a.id)).not.toContain(daily.id);
    // تكليف المراقبة يمنع تكليف المعلمة بانتظار في الوقت نفسه... والفسحة ليست حصة، فنختبر مع التكليف اليومي
    await expect(createSubstitute(db, ctx, { date: "2026-11-24", sectionId: P1(), periodNumber: 1, substituteTeacherId: seed.teacherIds[3] })).resolves.toBeTruthy();
    const cancelled = await updateAssignment(db, ctx, ok.id, { version: ok.version, status: "CANCELLED" });
    expect(cancelled.status).toBe("CANCELLED");
    await expect(updateAssignment(db, ctx, ok.id, { version: ok.version, status: "CONFIRMED" })).rejects.toBeInstanceOf(StaleRecordError);
    await expect(updateAssignment(db, await ctxOf("vp_students"), ok.id, { version: cancelled.version, status: "CANCELLED" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
