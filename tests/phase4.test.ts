/**
 * المرحلة 4: دليل الطالبات والموظفات والفصول، الإعدادات والقيادة، الحسابات وكلمة المرور.
 * كل حالة تتحقق من: Zod + الصلاحية على الخادم مع تقييد المرحلة + القفل التفاؤلي + سجل التدقيق.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ZodError } from "zod";
import { db, freshSeed, closeDb } from "./helpers";
import type { SeedResult } from "@/db/seed";
import { DEV_PASSWORD } from "@/db/seed";
import * as s from "@/db/schema";
import { ForbiddenError, loadAuthContext } from "@/auth/rbac";
import { login, validateSession } from "@/auth/session";
import { StaleRecordError } from "@/domain/conflicts";
import { hijriToGregorian } from "@/domain/time";
import { resolveServiceDate } from "@/domain/service-dates";
import { errorToState, formToObject, ValidationError } from "@/server/forms";
import { addEnrollment, createStudent, getStudentRecord, listStudents, updateEnrollment, updateStudent } from "@/server/services/students";
import { createEmployee, getEmployeeRecord, listEmployees, updateEmployee } from "@/server/services/employees";
import { createSection, listSections, updateSection } from "@/server/services/sections";
import { getSettings, updateLeadership, updateSchoolSettings } from "@/server/services/settings";
import { changeOwnPassword, createUser, listUsers, resetUserPassword, updateUser } from "@/server/services/users";

let seed: SeedResult;
const ctxOf = (k: keyof SeedResult["userIds"] | string) => loadAuthContext(db, seed.userIds[k] ?? k);

async function lastAudit(entityType: string, entityId: string) {
  const [a] = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityType, entityType), eq(s.auditLogs.entityId, entityId))).orderBy(desc(s.auditLogs.createdAt)).limit(1);
  return a;
}
async function rejectsWith<T extends new (...a: never[]) => Error>(p: Promise<unknown>, cls: T) {
  await expect(p).rejects.toBeInstanceOf(cls);
}

beforeAll(async () => {
  seed = await freshSeed();
});
afterAll(closeDb);

describe("أدوات النماذج", () => {
  it("formToObject يحوّل المفاتيح المتكررة إلى مصفوفة ويتجاهل مفاتيح Next", () => {
    const fd = new FormData();
    fd.append("a", "1");
    fd.append("b", "x");
    fd.append("b", "y");
    fd.append("$ACTION_ID_123", "z");
    expect(formToObject(fd)).toEqual({ a: "1", b: ["x", "y"] });
  });
  it("errorToState يعطي رسائل عربية ولا يكشف تفاصيل داخلية", () => {
    expect(errorToState(new StaleRecordError()).error).toContain("مستخدمة أخرى");
    expect(errorToState({ cause: { code: "23505", constraint: "students_school_number_unique" } }).error).toBe("الرقم المدرسي مستخدم لطالبة أخرى.");
    const unknown = errorToState(new Error("connection refused 10.0.0.1"));
    expect(unknown.ok).toBe(false);
    expect(unknown.error).not.toContain("10.0.0.1");
  });
});

describe("تواريخ المباشرة (منطق نقي)", () => {
  it("الهجري يُحوَّل بأم القرى ويُحفظ النص الأصلي ونوع التقويم", () => {
    const v = resolveServiceDate("HIJRI", "1440/05/12", "COMPLETE");
    expect(v).toEqual({ date: hijriToGregorian(1440, 5, 12), originalCalendar: "HIJRI", originalText: "1440/05/12", verification: "COMPLETE" });
  });
  it("الحقل الفارغ → بانتظار التحقق بلا تاريخ حتى لو اختيرت «مكتمل»", () => {
    expect(resolveServiceDate(null, "", "COMPLETE")).toEqual({ date: null, originalCalendar: null, originalText: null, verification: "PENDING_VERIFICATION" });
  });
  it("صيغة غير مقروءة أو تقويم غير مطابق → خطأ دون تخمين", () => {
    expect(() => resolveServiceDate("HIJRI", "12 رجب", "COMPLETE")).toThrow(/غير مقروءة/);
    expect(() => resolveServiceDate("HIJRI", "2019-01-18", "COMPLETE")).toThrow(/ميلادي/);
    expect(() => resolveServiceDate(null, "1440/13/01", "COMPLETE")).toThrow();
  });
});

describe("دليل الطالبات", () => {
  const base = () => ({ fullName: "طالبة تجريبية - شهد اختبار", yearId: seed.yearId, sectionId: seed.sectionIds["PRIMARY:1:1"], enrolledAt: "2026-09-01", schoolNumber: "T-5001" });

  it("إضافة طالبة مع القيد والفصل والسنة + سجل تدقيق", async () => {
    const ctx = await ctxOf("principal");
    const st = await createStudent(db, ctx, base());
    const rec = await getStudentRecord(db, ctx, st.id);
    expect(rec?.enrollments).toHaveLength(1);
    expect(rec?.enrollments[0]).toMatchObject({ gradeName: "الأول", sectionName: "1", status: "ACTIVE", enrolledAt: "2026-09-01" });
    expect((await lastAudit("student", st.id))?.action).toBe("create");
    const list = await listStudents(db, ctx, { q: "شهد" });
    expect(list.rows.map((r) => r.id)).toContain(st.id);
  });

  it("Zod يرفض الاسم الفارغ والتاريخ غير الصالح والفصل غير الصالح", async () => {
    const ctx = await ctxOf("principal");
    await rejectsWith(createStudent(db, ctx, { ...base(), fullName: "  " }), ZodError);
    await rejectsWith(createStudent(db, ctx, { ...base(), enrolledAt: "2026-02-30" }), ZodError);
    await rejectsWith(createStudent(db, ctx, { ...base(), sectionId: "not-a-uuid" }), ZodError);
  });

  it("منع التكرار غير المقصود: الاسم نفسه في الفصل نفسه يتطلب تأكيدًا، والرقم المدرسي فريد", async () => {
    const ctx = await ctxOf("principal");
    await rejectsWith(createStudent(db, ctx, { ...base(), schoolNumber: "" }), ValidationError);
    const ok = await createStudent(db, ctx, { ...base(), schoolNumber: "", confirmDuplicate: "on" });
    expect(ok.id).toBeTruthy();
    const err = await createStudent(db, ctx, { ...base(), fullName: "طالبة تجريبية - أخرى", schoolNumber: "T-5001" }).catch((e) => e);
    expect(errorToState(err).error).toBe("الرقم المدرسي مستخدم لطالبة أخرى.");
  });

  it("تقييد المرحلة على الخادم: حساب الابتدائية لا يضيف في المتوسطة، والوكيلة التعليمية لا تملك الإضافة", async () => {
    const prim = await ctxOf("primary_only");
    await rejectsWith(createStudent(db, prim, { ...base(), fullName: "طالبة تجريبية - م", schoolNumber: "", sectionId: seed.sectionIds["INTERMEDIATE:1:1"] }), ForbiddenError);
    const okP = await createStudent(db, prim, { ...base(), fullName: "طالبة تجريبية - ابتدائي فقط", schoolNumber: "" });
    expect(okP.id).toBeTruthy();
    await rejectsWith(createStudent(db, await ctxOf("vp_academic"), { ...base(), fullName: "طالبة تجريبية - ع", schoolNumber: "" }), ForbiddenError);
    // ولا تفتح ملف طالبة المتوسطة
    await rejectsWith(getStudentRecord(db, prim, seed.studentIds[3]), ForbiddenError);
  });

  it("الفصل يجب أن يتبع السنة المختارة", async () => {
    const ctx = await ctxOf("principal");
    const [prev] = await db.select().from(s.academicYears).where(eq(s.academicYears.status, "ARCHIVED"));
    await rejectsWith(createStudent(db, ctx, { ...base(), fullName: "طالبة تجريبية - س", schoolNumber: "", yearId: prev.id }), ValidationError);
  });

  it("تعديل بقفل تفاؤلي: الإصدار القديم يُرفض ولا يُكتب شيء، والصحيح يزيد الإصدار ويُدقَّق", async () => {
    const ctx = await ctxOf("principal");
    const id = seed.studentIds[4];
    const [before] = await db.select().from(s.students).where(eq(s.students.id, id));
    const after = await updateStudent(db, ctx, id, { version: before.version, fullName: before.fullName, schoolNumber: before.schoolNumber ?? "", notes: "ملاحظة تجريبية", dataStatus: "COMPLETE" });
    expect(after.version).toBe(before.version + 1);
    expect(after.notes).toBe("ملاحظة تجريبية");
    // مستخدمة ثانية فتحت السجل قبل التعديل
    await rejectsWith(updateStudent(db, ctx, id, { version: before.version, fullName: "اسم من نسخة قديمة", dataStatus: "COMPLETE" }), StaleRecordError);
    const [now] = await db.select().from(s.students).where(eq(s.students.id, id));
    expect(now.fullName).toBe(before.fullName);
    const a = await lastAudit("student", id);
    expect(a?.action).toBe("update");
    expect((a?.after as { notes: string }).notes).toBe("ملاحظة تجريبية");
  });

  it("تعديل القيد: نقل لشعبة في السنة نفسها مسموح، والانقطاع/النقل لا يُضبطان مباشرة", async () => {
    const ctx = await ctxOf("principal");
    const [g1] = await db.select().from(s.classSections).where(eq(s.classSections.id, seed.sectionIds["PRIMARY:1:1"]));
    const sec2 = await createSection(db, ctx, { gradeId: g1.gradeId, yearId: seed.yearId, name: "2" });
    const [en] = await db.select().from(s.studentEnrollments).where(and(eq(s.studentEnrollments.studentId, seed.studentIds[0]), eq(s.studentEnrollments.yearId, seed.yearId)));
    const moved = await updateEnrollment(db, ctx, en.id, { version: en.version, sectionId: sec2.id, enrolledAt: en.enrolledAt, status: "ACTIVE" });
    expect(moved.sectionId).toBe(sec2.id);
    await rejectsWith(updateEnrollment(db, ctx, en.id, { version: moved.version, sectionId: sec2.id, enrolledAt: en.enrolledAt, status: "DROPPED_OUT" }), ValidationError);
    await rejectsWith(updateEnrollment(db, ctx, en.id, { version: en.version, sectionId: sec2.id, enrolledAt: en.enrolledAt, status: "ACTIVE" }), StaleRecordError);
    // حساب الابتدائية لا ينقل طالبة إلى المتوسطة
    const prim = await ctxOf("primary_only");
    await rejectsWith(updateEnrollment(db, prim, en.id, { version: moved.version, sectionId: seed.sectionIds["INTERMEDIATE:1:1"], enrolledAt: en.enrolledAt, status: "ACTIVE" }), ForbiddenError);
    expect((await lastAudit("enrollment", en.id))?.action).toBe("update");
  });

  it("قيد ثانٍ في السنة نفسها يُرفض بقيد قاعدة البيانات، والسنة المؤرشفة لا تقبل قيودًا", async () => {
    const ctx = await ctxOf("principal");
    const err = await addEnrollment(db, ctx, seed.studentIds[1], { yearId: seed.yearId, sectionId: seed.sectionIds["PRIMARY:2:1"], enrolledAt: "2026-09-01" }).catch((e) => e);
    expect(errorToState(err).error).toContain("قيد مسجّل في هذه السنة");
    const [prev] = await db.select().from(s.academicYears).where(eq(s.academicYears.status, "ARCHIVED"));
    const [oldSec] = await db.select().from(s.classSections).where(eq(s.classSections.yearId, prev.id));
    await rejectsWith(addEnrollment(db, ctx, seed.studentIds[1], { yearId: prev.id, sectionId: oldSec.id, enrolledAt: "2025-09-01" }), ValidationError);
  });
});

describe("دليل الموظفات وتاريخا المباشرة", () => {
  const emp = (over: Record<string, unknown> = {}) => ({
    fullName: "إدارية تجريبية - اختبار التواريخ",
    category: "ADMINISTRATIVE",
    jobTitle: "مساعدة إدارية",
    ministryCalendar: "HIJRI",
    ministryDate: "1440/05/12",
    ministryVerification: "COMPLETE",
    schoolCalendar: "GREGORIAN",
    schoolDate: "2023-09-03",
    schoolVerification: "COMPLETE",
    duties: "متابعة الملفات",
    ...over,
  });

  it("حفظ تاريخ المباشرة بالوزارة وتاريخ المباشرة بالمدرسة منفصلين (هجري وميلادي)", async () => {
    const ctx = await ctxOf("vp_academic");
    const e = await createEmployee(db, ctx, emp());
    const rec = await getEmployeeRecord(db, ctx, e.id);
    expect(rec?.ministry).toMatchObject({ kind: "MINISTRY", date: hijriToGregorian(1440, 5, 12), originalCalendar: "HIJRI", originalText: "1440/05/12", verification: "COMPLETE" });
    expect(rec?.school).toMatchObject({ kind: "SCHOOL", date: "2023-09-03", originalCalendar: "GREGORIAN", verification: "COMPLETE" });
    expect(rec?.ministry?.date).not.toBe(rec?.school?.date);
    expect((await lastAudit("employee", e.id))?.action).toBe("create");
  });

  it("تاريخ غير مقروء أو تقويم غير مطابق يُرفض برسالة على الحقل الصحيح", async () => {
    const ctx = await ctxOf("vp_academic");
    const e1 = await createEmployee(db, ctx, emp({ fullName: "إدارية تجريبية - خطأ", ministryDate: "١٢ رجب" })).catch((x) => x);
    expect(e1).toBeInstanceOf(ValidationError);
    expect(e1.field).toBe("ministryDate");
    const e2 = await createEmployee(db, ctx, emp({ fullName: "إدارية تجريبية - خطأ", schoolCalendar: "HIJRI" })).catch((x) => x);
    expect(e2.field).toBe("schoolDate");
  });

  it("بلا صلاحية الكتابة → مرفوض، وبلا الصلاحية الحساسة لا تظهر التواريخ والملاحظات", async () => {
    await rejectsWith(createEmployee(db, await ctxOf("vp_students"), emp({ fullName: "إدارية تجريبية - ممنوع" })), ForbiddenError);
    const vs = await ctxOf("vp_students"); // تملك employees.read فقط
    const r = await listEmployees(db, vs, "admin");
    expect(r.sensitive).toBe(false);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.ministry === null && x.school === null && x.notes === null && x.account === null)).toBe(true);
  });

  it("الأقسام مستقلة: الهيئة الإدارية لا تضم المستخدمات والحراس، والعكس", async () => {
    const ctx = await ctxOf("principal");
    const admin = await listEmployees(db, ctx, "admin");
    const service = await listEmployees(db, ctx, "service");
    expect(admin.rows.every((x) => ["LEADERSHIP", "ADMINISTRATIVE", "COUNSELOR"].includes(x.category))).toBe(true);
    expect(service.rows.map((x) => x.category).sort()).toEqual(["GUARD", "SERVICE"]);
    // الهيئة الإدارية تعرض صلاحيات النظام لمن لها حساب فقط
    const withAccount = admin.rows.filter((x) => x.account);
    expect(withAccount.length).toBe(3); // المديرة والوكيلتان
    expect(admin.rows.find((x) => x.jobTitle === "المرشدة الطلابية")?.account).toBeNull();
  });

  it("تعديل الموظفة: قفل تفاؤلي، ومزامنة المراحل تُنهي التكليف القديم دون حذفه", async () => {
    const ctx = await ctxOf("directory");
    const teacherId = seed.teacherIds[0]; // ابتدائية
    const [before] = await db.select().from(s.employees).where(eq(s.employees.id, teacherId));
    const updated = await updateEmployee(db, ctx, teacherId, {
      version: before.version,
      fullName: before.fullName,
      category: "TEACHER",
      jobTitle: "معلمة",
      specialization: "لغة عربية",
      stageIds: [seed.stageIds.INTERMEDIATE],
      ministryDate: "",
      schoolDate: "",
    });
    expect(updated.version).toBe(before.version + 1);
    const asg = await db.select().from(s.employeeAssignments).where(and(eq(s.employeeAssignments.employeeId, teacherId), eq(s.employeeAssignments.position, "OTHER")));
    expect(asg.find((a) => a.stageId === seed.stageIds.PRIMARY)).toMatchObject({ isActive: false });
    expect(asg.find((a) => a.stageId === seed.stageIds.INTERMEDIATE)).toMatchObject({ isActive: true });
    await rejectsWith(updateEmployee(db, ctx, teacherId, { version: before.version, fullName: "x", category: "TEACHER", jobTitle: "معلمة" }), StaleRecordError);
    // ملف المعلمة يعرض جدولها
    const rec = await getEmployeeRecord(db, ctx, teacherId);
    expect(rec?.timetable?.length).toBeGreaterThan(0);
  });
});

describe("الفصول والشعب", () => {
  it("إضافة شعبة، ومنع التكرار، وتقييد الصلاحية بالمرحلة", async () => {
    const ctx = await ctxOf("directory");
    const [g] = await db.select().from(s.grades).where(and(eq(s.grades.stageId, seed.stageIds.INTERMEDIATE), eq(s.grades.order, 2)));
    const sec = await createSection(db, ctx, { gradeId: g.id, yearId: seed.yearId, name: "3" });
    expect((await lastAudit("section", sec.id))?.action).toBe("create");
    const dup = await createSection(db, ctx, { gradeId: g.id, yearId: seed.yearId, name: "3" }).catch((e) => e);
    expect(errorToState(dup).error).toContain("شعبة بالاسم نفسه");
    await rejectsWith(createSection(db, await ctxOf("vp_students"), { gradeId: g.id, yearId: seed.yearId, name: "4" }), ForbiddenError);
    const list = await listSections(db, ctx);
    expect(list.find((x) => x.id === sec.id)).toMatchObject({ gradeName: "الثاني المتوسط", students: 0 });
  });

  it("لا تُعطَّل شعبة فيها طالبات منتظمات، والقفل التفاؤلي يعمل", async () => {
    const ctx = await ctxOf("principal");
    const id = seed.sectionIds["PRIMARY:2:1"];
    const [sec] = await db.select().from(s.classSections).where(eq(s.classSections.id, id));
    await rejectsWith(updateSection(db, ctx, id, { version: sec.version, name: sec.name }), ValidationError); // isActive غائب = تعطيل
    const ok = await updateSection(db, ctx, id, { version: sec.version, name: sec.name, isActive: "on", homeroomTeacherId: seed.teacherIds[1] });
    expect(ok.homeroomTeacherId).toBe(seed.teacherIds[1]);
    await rejectsWith(updateSection(db, ctx, id, { version: sec.version, name: "x", isActive: "on" }), StaleRecordError);
    // رائدة الفصل يجب أن تكون معلمة
    const [guard] = await db.select().from(s.employees).where(eq(s.employees.category, "GUARD"));
    await rejectsWith(updateSection(db, ctx, id, { version: ok.version, name: sec.name, isActive: "on", homeroomTeacherId: guard.id }), ValidationError);
  });
});

describe("إعدادات المدرسة والقيادة", () => {
  it("التعديل بصلاحية settings.write فقط، مع قفل تفاؤلي وتدقيق", async () => {
    const principal = await ctxOf("principal");
    const st = await getSettings(db, principal);
    const input = { version: st!.school.version, nameAr: st!.school.nameAr, educationOffice: st!.school.educationOffice, systemName: st!.school.systemName, tagline: "شعار تجريبي", creditLine: st!.school.creditLine, principalNameStatus: "COMPLETE" };
    await rejectsWith(updateSchoolSettings(db, await ctxOf("vp_academic"), input), ForbiddenError);
    const after = await updateSchoolSettings(db, principal, input);
    expect(after.tagline).toBe("شعار تجريبي");
    expect(after.officialApproved).toBe(false); // غياب المربع = غير معتمد
    expect((await getSettings(db, principal))!.principalNameStatus).toBe("COMPLETE");
    await rejectsWith(updateSchoolSettings(db, principal, input), StaleRecordError);
    expect((await lastAudit("school", st!.school.id))?.action).toBe("update");
  });

  it("تغيير شاغلة منصب ينهي التكليف السابق ويحفظ أثره، ويرفض الحفظ إن تغيّر المنصب منذ الفتح", async () => {
    const principal = await ctxOf("principal");
    const st = await getSettings(db, principal);
    const counselor = st!.leadership.find((l) => l.position === "COUNSELOR")!.current!;
    const [admin] = await db.select().from(s.employees).where(eq(s.employees.fullName, "إدارية تجريبية - منيرة صالح"));
    await updateLeadership(db, principal, { position: "COUNSELOR", employeeId: admin.id, titleAr: "المرشدة الطلابية", currentAssignmentId: counselor.id });
    const [old] = await db.select().from(s.employeeAssignments).where(eq(s.employeeAssignments.id, counselor.id));
    expect(old.isActive).toBe(false);
    expect(old.endDate).toBeTruthy();
    const now = (await getSettings(db, principal))!.leadership.find((l) => l.position === "COUNSELOR")!.current!;
    expect(now.employeeId).toBe(admin.id);
    await rejectsWith(updateLeadership(db, principal, { position: "COUNSELOR", employeeId: counselor.employeeId, titleAr: "المرشدة الطلابية", currentAssignmentId: counselor.id }), StaleRecordError);
  });
});

describe("الحسابات والصلاحيات وكلمة المرور", () => {
  it("إدارة الحسابات للمديرة فقط", async () => {
    for (const k of ["vp_academic", "vp_students", "directory"]) await rejectsWith(listUsers(db, await ctxOf(k)), ForbiddenError);
    expect((await listUsers(db, await ctxOf("principal"))).length).toBeGreaterThanOrEqual(5);
  });

  let newUserId = "";
  let temp = "";
  it("إنشاء حساب بكلمة مؤقتة تُعرض مرة واحدة ولا تُخزَّن في التدقيق، مع دور مقيّد بمرحلة", async () => {
    const principal = await ctxOf("principal");
    await rejectsWith(createUser(db, principal, { username: "Bad Name!", displayName: "x", role_VP_STUDENTS: "on" }), ZodError);
    await rejectsWith(createUser(db, principal, { username: "test.noroles", displayName: "بلا أدوار" }), ValidationError);
    const r = await createUser(db, principal, { username: "Test.Counselor", displayName: "حساب تجريبي", role_VP_STUDENTS: "on", stage_VP_STUDENTS: seed.stageIds.INTERMEDIATE });
    newUserId = r.user.id;
    temp = r.tempPassword;
    expect(r.user.username).toBe("test.counselor");
    expect(r.user.mustChangePassword).toBe(true);
    const audit = await lastAudit("user", newUserId);
    expect(JSON.stringify(audit)).not.toContain(temp);
    expect(JSON.stringify(audit)).not.toContain(r.user.passwordHash);
    const ctx = await loadAuthContext(db, newUserId);
    expect(ctx.mustChangePassword).toBe(true);
    expect(ctx.grants[0].stageId).toBe(seed.stageIds.INTERMEDIATE);
    const dup = await createUser(db, principal, { username: "test.counselor", displayName: "مكرر", role_VP_STUDENTS: "on" }).catch((e) => e);
    expect(errorToState(dup).error).toBe("اسم المستخدم مستخدم لحساب آخر.");
  });

  it("تغيير كلمة المرور الإجباري: التحقق من الحالية والقوة والاختلاف، ثم يُلغى بقية الجلسات", async () => {
    const a = await login(db, "test.counselor", temp);
    const b = await login(db, "test.counselor", temp);
    expect(a.ok && a.mustChangePassword).toBe(true);
    if (!a.ok || !b.ok) throw new Error("login failed");
    await rejectsWith(changeOwnPassword(db, newUserId, a.token, { currentPassword: "wrong-pass-1", newPassword: "New-Pass-2026x", confirmPassword: "New-Pass-2026x" }), ValidationError);
    await rejectsWith(changeOwnPassword(db, newUserId, a.token, { currentPassword: temp, newPassword: "short1", confirmPassword: "short1" }), ValidationError);
    await rejectsWith(changeOwnPassword(db, newUserId, a.token, { currentPassword: temp, newPassword: temp, confirmPassword: temp }), ZodError);
    await rejectsWith(changeOwnPassword(db, newUserId, a.token, { currentPassword: temp, newPassword: "New-Pass-2026x", confirmPassword: "Other-2026xx" }), ZodError);
    await changeOwnPassword(db, newUserId, a.token, { currentPassword: temp, newPassword: "New-Pass-2026x", confirmPassword: "New-Pass-2026x" });
    expect((await loadAuthContext(db, newUserId)).mustChangePassword).toBe(false);
    expect(await validateSession(db, a.token)).toBe(newUserId); // الجلسة الحالية باقية
    expect(await validateSession(db, b.token)).toBeNull(); // الجهاز الآخر خرج
    expect((await lastAudit("user", newUserId))?.action).toBe("password_change");
    expect((await login(db, "test.counselor", temp)).ok).toBe(false);
    expect((await login(db, "test.counselor", "New-Pass-2026x")).ok).toBe(true);
  });

  it("حماية من الإقفال: لا تعطيل للحساب الحالي ولا سحب إدارة الحسابات من النفس", async () => {
    const principal = await ctxOf("principal");
    const [me] = await db.select().from(s.users).where(eq(s.users.id, seed.userIds.principal));
    await rejectsWith(updateUser(db, principal, me.id, { version: me.version, displayName: me.displayName, role_PRINCIPAL: "on" }), ValidationError); // بلا isActive
    await rejectsWith(updateUser(db, principal, me.id, { version: me.version, displayName: me.displayName, isActive: "on", role_VP_STUDENTS: "on" }), ValidationError);
  });

  it("تعطيل حساب يُنهي جلساته ويمنع الدخول، وتعديل قديم يُرفض", async () => {
    const principal = await ctxOf("principal");
    const s1 = await login(db, "test.counselor", "New-Pass-2026x");
    if (!s1.ok) throw new Error();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, newUserId));
    const after = await updateUser(db, principal, newUserId, { version: u.version, displayName: "حساب تجريبي معطّل", role_VP_STUDENTS: "on", stage_VP_STUDENTS: seed.stageIds.PRIMARY });
    expect(after.isActive).toBe(false);
    expect(await validateSession(db, s1.token)).toBeNull();
    expect(await login(db, "test.counselor", "New-Pass-2026x")).toEqual({ ok: false, reason: "inactive" });
    const [{ stageId }] = await db.select().from(s.userRoles).where(eq(s.userRoles.userId, newUserId));
    expect(stageId).toBe(seed.stageIds.PRIMARY);
    await rejectsWith(updateUser(db, principal, newUserId, { version: u.version, displayName: "قديم", isActive: "on", role_VP_STUDENTS: "on" }), StaleRecordError);
  });

  it("إعادة تعيين كلمة المرور تفرض التغيير وتفك القفل وتُنهي الجلسات", async () => {
    const principal = await ctxOf("principal");
    const s1 = await login(db, "directory", DEV_PASSWORD);
    if (!s1.ok) throw new Error();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, seed.userIds.directory));
    await db.update(s.users).set({ mustChangePassword: false, failedLogins: 3 }).where(eq(s.users.id, u.id));
    const { tempPassword } = await resetUserPassword(db, principal, u.id, { version: u.version });
    expect(await validateSession(db, s1.token)).toBeNull();
    const r = await login(db, "directory", tempPassword);
    expect(r.ok && r.mustChangePassword).toBe(true);
    expect((await login(db, "directory", DEV_PASSWORD)).ok).toBe(false);
    await rejectsWith(resetUserPassword(db, await ctxOf("vp_academic"), u.id, { version: u.version + 1 }), ForbiddenError);
    const sessions = await db.select().from(s.sessions).where(and(eq(s.sessions.userId, u.id), isNull(s.sessions.revokedAt)));
    expect(sessions.length).toBe(1);
  });
});
