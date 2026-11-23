/**
 * بيانات التطوير والاختبار — وهمية بالكامل.
 * هوية المدرسة الحقيقية (أسماء القيادة) تُقرأ من data-private/school-identity.json إن وُجد (مستبعد من Git)،
 * وإلا تُستخدم عناصر نائبة واضحة. لا توجد أي أرقام سجل مدني في أي مكان.
 */
import { existsSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { DB } from "./client";
import * as s from "./schema";
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from "@/auth/permissions";
import { normalizeArabic } from "@/domain/arabic";
import bcrypt from "bcryptjs";

export const DEV_PASSWORD = "Dev-Only-2026"; // للتطوير المحلي فقط — يُجبر تغييرها عند أول دخول

interface Identity {
  principal: string;
  vpAcademic: string;
  vpStudents: string;
  counselor: string;
  kindergartenTeachers: string[];
}

const PLACEHOLDER_IDENTITY: Identity = {
  principal: "[اسم المديرة]",
  vpAcademic: "[اسم وكيلة الشؤون التعليمية]",
  vpStudents: "[اسم وكيلة شؤون الطالبات]",
  counselor: "[اسم المرشدة الطلابية]",
  kindergartenTeachers: ["[معلمة روضة 1]", "[معلمة روضة 2]"],
};

export function loadIdentity(): { identity: Identity; source: "private" | "placeholder" } {
  const p = "data-private/school-identity.json";
  if (existsSync(p)) return { identity: JSON.parse(readFileSync(p, "utf8")), source: "private" };
  return { identity: PLACEHOLDER_IDENTITY, source: "placeholder" };
}

/** يمسح كل الجداول — للتطوير والاختبار فقط */
export async function resetDatabase(db: DB) {
  if (process.env.NODE_ENV === "production") throw new Error("ممنوع مسح قاعدة الإنتاج");
  const { rows } = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const names = rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await db.execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`));
}

export async function syncRolesAndPermissions(db: DB) {
  for (const code of ALL_PERMISSIONS) {
    await db
      .insert(s.permissions)
      .values({ code, nameAr: PERMISSIONS[code] })
      .onConflictDoUpdate({ target: s.permissions.code, set: { nameAr: PERMISSIONS[code] } });
  }
  const perms = await db.select().from(s.permissions);
  const permId = new Map(perms.map((p) => [p.code, p.id]));
  const roleIds: Record<string, string> = {};
  for (const [code, def] of Object.entries(SYSTEM_ROLES)) {
    const [r] = await db
      .insert(s.roles)
      .values({ code, nameAr: def.nameAr, isSystem: true })
      .onConflictDoUpdate({ target: s.roles.code, set: { nameAr: def.nameAr, isSystem: true } })
      .returning();
    roleIds[code] = r.id;
    await db.delete(s.rolePermissions).where(sql`${s.rolePermissions.roleId} = ${r.id}`);
    await db.insert(s.rolePermissions).values(def.permissions.map((p) => ({ roleId: r.id, permissionId: permId.get(p)! })));
  }
  return roleIds;
}

const FAKE_TEACHERS: Array<{ name: string; stage: "PRIMARY" | "INTERMEDIATE"; spec: string }> = [
  { name: "معلمة تجريبية - سارة أحمد", stage: "PRIMARY", spec: "لغة عربية" },
  { name: "معلمة تجريبية - هيا محمد", stage: "PRIMARY", spec: "رياضيات" },
  { name: "معلمة تجريبية - نورة سالم", stage: "PRIMARY", spec: "علوم" },
  { name: "معلمة تجريبية - ريم خالد", stage: "INTERMEDIATE", spec: "لغة إنجليزية" },
  { name: "معلمة تجريبية - لمى فهد", stage: "INTERMEDIATE", spec: "رياضيات" },
];

// أسماء متشابهة عمدًا لاختبار عدم خلط السجلات
const FAKE_STUDENTS = [
  "طالبة تجريبية - فاطمة علي",
  "طالبة تجريبية - فاطمه علي",
  "طالبة تجريبية - أمل ناصر",
  "طالبة تجريبية - امل ناصر",
  "طالبة تجريبية - جود عبدالله",
  "طالبة تجريبية - رؤى سعد",
  "طالبة تجريبية - لين حمد",
  "طالبة تجريبية - مها ماجد",
];

export interface SeedResult {
  schoolId: string;
  stageIds: Record<"KINDERGARTEN" | "PRIMARY" | "INTERMEDIATE", string>;
  yearId: string;
  termId: string;
  userIds: Record<string, string>;
  roleIds: Record<string, string>;
  sectionIds: Record<string, string>;
  teacherIds: string[];
  studentIds: string[];
  timetableId: string;
}

/**
 * mustChangePassword: الافتراضي true (كلمة مرور التطوير معروفة فيُفرض تغييرها عند أول دخول).
 * الاختبارات الطرفية تمرر false للحسابات الأساسية وتختبر التغيير الإجباري على حساب تُنشئه بنفسها.
 */
export async function seedDev(db: DB, opts: { fastHash?: boolean; mustChangePassword?: boolean } = {}): Promise<SeedResult> {
  const { identity } = loadIdentity();
  const roleIds = await syncRolesAndPermissions(db);

  const [school] = await db
    .insert(s.schools)
    .values({
      nameAr: "الروضة الثانية والابتدائية الرابعة والمتوسطة الثانية بالمهد",
      educationOffice: "إدارة التعليم بمحافظة المهد، المملكة العربية السعودية",
      systemName: "الدليل الرقمي المدرسي المتكامل",
      tagline: "إدارة مدرسية أكثر تنظيمًا ودقة.",
      creditLine: "إنشاء وتطوير الأستاذة وضحى زايد المطيري",
      officialApproved: false,
    })
    .returning();

  const stageRows = await db
    .insert(s.stages)
    .values([
      { schoolId: school.id, code: "KINDERGARTEN", nameAr: "الروضة الثانية", order: 1 },
      { schoolId: school.id, code: "PRIMARY", nameAr: "الابتدائية الرابعة", order: 2 },
      { schoolId: school.id, code: "INTERMEDIATE", nameAr: "المتوسطة الثانية", order: 3 },
    ])
    .returning();
  const stageIds = Object.fromEntries(stageRows.map((r) => [r.code, r.id])) as SeedResult["stageIds"];

  // تواريخ السنة والفصل عناصر نائبة قابلة للتعديل من الإعدادات — يجب ضبطها من التقويم الرسمي
  const [year] = await db
    .insert(s.academicYears)
    .values({ schoolId: school.id, name: "1448هـ (تجريبي)", startDate: "2026-08-23", endDate: "2027-06-10", status: "ACTIVE" })
    .returning();
  const [prevYear] = await db
    .insert(s.academicYears)
    .values({ schoolId: school.id, name: "1447هـ (تجريبي)", startDate: "2025-08-24", endDate: "2026-06-25", status: "ARCHIVED" })
    .returning();
  const [term] = await db
    .insert(s.academicTerms)
    .values({ yearId: year.id, number: 1, name: "الفصل الدراسي الأول", startDate: "2026-08-23", endDate: "2027-01-07", isActive: true })
    .returning();
  await db
    .insert(s.academicTerms)
    .values({ yearId: year.id, number: 2, name: "الفصل الدراسي الثاني", startDate: "2027-01-17", endDate: "2027-06-10" });

  // الصفوف
  const gradeDefs: Array<[keyof SeedResult["stageIds"], string[]]> = [
    ["KINDERGARTEN", ["المستوى الأول", "المستوى الثاني", "المستوى الثالث"]],
    ["PRIMARY", ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"]],
    ["INTERMEDIATE", ["الأول المتوسط", "الثاني المتوسط", "الثالث المتوسط"]],
  ];
  const sectionIds: Record<string, string> = {};
  for (const [code, names] of gradeDefs) {
    const gs = await db
      .insert(s.grades)
      .values(names.map((n, i) => ({ stageId: stageIds[code], nameAr: n, order: i + 1 })))
      .returning();
    for (const g of gs) {
      const [sec] = await db.insert(s.classSections).values({ gradeId: g.id, yearId: year.id, name: "1" }).returning();
      sectionIds[`${code}:${g.order}:1`] = sec.id;
    }
  }

  // المباني والقاعات ومناطق المراقبة (وهمية)
  const [floor1] = await db.insert(s.floors).values({ building: "المبنى الرئيسي", name: "الدور الأرضي", order: 0 }).returning();
  const [floor2] = await db.insert(s.floors).values({ building: "المبنى الرئيسي", name: "الدور الأول", order: 1 }).returning();
  await db.insert(s.supervisionAreas).values([
    { floorId: floor1.id, name: "الممر الشرقي" },
    { floorId: floor1.id, name: "الساحة" },
    { floorId: floor2.id, name: "ممر الدور الأول" },
  ]);
  const roomRows = await db
    .insert(s.rooms)
    .values([
      { name: "قاعة 101", floorId: floor1.id },
      { name: "قاعة 102", floorId: floor1.id },
      { name: "قاعة 201", floorId: floor2.id },
      { name: "معمل العلوم", floorId: floor2.id },
    ])
    .returning();

  // القيادة (من الملف الخاص أو عناصر نائبة) — بانتظار التحقق
  const mkEmp = async (v: Partial<typeof s.employees.$inferInsert> & { fullName: string; category: (typeof s.employeeCategory.enumValues)[number]; jobTitle: string }) => {
    const [e] = await db
      .insert(s.employees)
      .values({ dataStatus: "INCOMPLETE", ...v, nameNormalized: normalizeArabic(v.fullName) })
      .returning();
    await db.insert(s.employeeServiceDates).values([
      { employeeId: e.id, kind: "MINISTRY", verification: "PENDING_VERIFICATION" },
      { employeeId: e.id, kind: "SCHOOL", verification: "PENDING_VERIFICATION" },
    ]);
    return e;
  };
  const principal = await mkEmp({ fullName: identity.principal, category: "LEADERSHIP", jobTitle: "مديرة المدرسة", dataStatus: "PENDING_VERIFICATION", notes: "الاسم مبدئي — بانتظار التحقق من السجل الرسمي" });
  const vpA = await mkEmp({ fullName: identity.vpAcademic, category: "LEADERSHIP", jobTitle: "وكيلة الشؤون التعليمية" });
  const vpS = await mkEmp({ fullName: identity.vpStudents, category: "LEADERSHIP", jobTitle: "وكيلة شؤون الطالبات" });
  const counselor = await mkEmp({ fullName: identity.counselor, category: "COUNSELOR", jobTitle: "المرشدة الطلابية" });
  await db.insert(s.employeeAssignments).values([
    { employeeId: principal.id, position: "PRINCIPAL", titleAr: "المديرة", yearId: year.id },
    { employeeId: vpA.id, position: "VP_ACADEMIC", titleAr: "وكيلة الشؤون التعليمية", yearId: year.id },
    { employeeId: vpS.id, position: "VP_STUDENTS", titleAr: "وكيلة شؤون الطالبات", yearId: year.id },
    { employeeId: counselor.id, position: "COUNSELOR", titleAr: "المرشدة الطلابية", yearId: year.id },
  ]);
  for (const kg of identity.kindergartenTeachers) {
    const e = await mkEmp({ fullName: kg, category: "TEACHER", jobTitle: "معلمة روضة" });
    await db.insert(s.employeeAssignments).values({ employeeId: e.id, position: "OTHER", titleAr: "معلمة روضة", stageId: stageIds.KINDERGARTEN, yearId: year.id });
  }

  // معلمات وهميات + مواد
  const teacherIds: string[] = [];
  const subjectIds: Record<string, string> = {};
  for (const t of FAKE_TEACHERS) {
    const key = `${t.stage}:${t.spec}`;
    if (!subjectIds[key]) {
      const [sub] = await db.insert(s.subjects).values({ stageId: stageIds[t.stage], nameAr: t.spec }).returning();
      subjectIds[key] = sub.id;
    }
    const e = await mkEmp({ fullName: t.name, category: "TEACHER", jobTitle: "معلمة", specialization: t.spec, dataStatus: "COMPLETE" });
    await db.insert(s.teacherSubjects).values({ employeeId: e.id, subjectId: subjectIds[key], stageId: stageIds[t.stage] });
    await db.insert(s.employeeAssignments).values({ employeeId: e.id, position: "OTHER", titleAr: "معلمة", stageId: stageIds[t.stage], yearId: year.id });
    teacherIds.push(e.id);
  }
  // إداريات ومستخدمات وحراس وهميون
  await mkEmp({ fullName: "إدارية تجريبية - منيرة صالح", category: "ADMINISTRATIVE", jobTitle: "مساعدة إدارية" });
  await mkEmp({ fullName: "مستخدمة تجريبية - حصة راشد", category: "SERVICE", jobTitle: "مستخدمة" });
  await mkEmp({ fullName: "حارس تجريبي - سعيد ناصر", category: "GUARD", jobTitle: "حارس" });

  // الطالبات الوهميات (الابتدائي: الأول والثاني؛ المتوسط: الأول)
  const studentIds: string[] = [];
  const targets = ["PRIMARY:1:1", "PRIMARY:1:1", "PRIMARY:2:1", "INTERMEDIATE:1:1", "PRIMARY:1:1", "PRIMARY:2:1", "INTERMEDIATE:1:1", "KINDERGARTEN:2:1"];
  for (let i = 0; i < FAKE_STUDENTS.length; i++) {
    const [st] = await db
      .insert(s.students)
      .values({ fullName: FAKE_STUDENTS[i], nameNormalized: normalizeArabic(FAKE_STUDENTS[i]), schoolNumber: `T-${1000 + i}` })
      .returning();
    await db.insert(s.studentEnrollments).values({ studentId: st.id, yearId: year.id, sectionId: sectionIds[targets[i]], enrolledAt: "2026-08-23" });
    studentIds.push(st.id);
  }
  // قيد في السنة السابقة (للأرشيف) لأول طالبة
  const [oldGrade] = await db.select().from(s.grades).where(sql`${s.grades.stageId} = ${stageIds.KINDERGARTEN} AND ${s.grades.order} = 3`);
  const [oldSec] = await db.insert(s.classSections).values({ gradeId: oldGrade.id, yearId: prevYear.id, name: "1" }).returning();
  await db.insert(s.studentEnrollments).values({ studentId: studentIds[0], yearId: prevYear.id, sectionId: oldSec.id, enrolledAt: "2025-08-24", status: "PROMOTED" });

  // أوقات حصص تجريبية للابتدائية فقط — الروضة والمتوسطة تُترك غير مكتملة عمدًا
  const demo: Array<[number, "LESSON" | "BREAK", string, number, number]> = [
    [1, "LESSON", "الحصة 1 (تجريبي)", 420, 465],
    [2, "LESSON", "الحصة 2 (تجريبي)", 465, 510],
    [3, "LESSON", "الحصة 3 (تجريبي)", 510, 555],
    [90, "BREAK", "الفسحة (تجريبي)", 555, 580],
    [4, "LESSON", "الحصة 4 (تجريبي)", 580, 625],
    [5, "LESSON", "الحصة 5 (تجريبي)", 625, 670],
    [6, "LESSON", "الحصة 6 (تجريبي)", 670, 715],
  ];
  await db.insert(s.periodDefinitions).values(
    demo.map(([number, kind, label, startMinute, endMinute]) => ({ termId: term.id, stageId: stageIds.PRIMARY, number, kind, label, startMinute, endMinute })),
  );

  // جدول أسبوعي تجريبي معتمد للابتدائية
  const [tt] = await db
    .insert(s.weeklyTimetables)
    .values({ termId: term.id, stageId: stageIds.PRIMARY, name: "الجدول الأسبوعي — الابتدائية (تجريبي)", status: "APPROVED", effectiveFrom: "2026-08-23" })
    .returning();
  const p1 = sectionIds["PRIMARY:1:1"];
  const p2 = sectionIds["PRIMARY:2:1"];
  const [arab, math, sci] = teacherIds;
  const entries: Array<typeof s.timetableEntries.$inferInsert> = [];
  for (let day = 0; day <= 4; day++) {
    entries.push({ timetableId: tt.id, dayOfWeek: day, periodNumber: 1, sectionId: p1, subjectId: subjectIds["PRIMARY:لغة عربية"], teacherId: arab, roomId: roomRows[0].id });
    entries.push({ timetableId: tt.id, dayOfWeek: day, periodNumber: 1, sectionId: p2, subjectId: subjectIds["PRIMARY:رياضيات"], teacherId: math, roomId: roomRows[1].id });
    entries.push({ timetableId: tt.id, dayOfWeek: day, periodNumber: 2, sectionId: p1, subjectId: subjectIds["PRIMARY:رياضيات"], teacherId: math, roomId: roomRows[0].id });
    entries.push({ timetableId: tt.id, dayOfWeek: day, periodNumber: 2, sectionId: p2, subjectId: subjectIds["PRIMARY:علوم"], teacherId: sci, roomId: roomRows[3].id });
    entries.push({ timetableId: tt.id, dayOfWeek: day, periodNumber: 3, kind: "STANDBY", teacherId: sci }); // انتظار ثابت
  }
  await db.insert(s.timetableEntries).values(entries);

  // الحسابات الأساسية الأربعة + حساب مقيّد بمرحلة للاختبار
  const hash = opts.fastHash ? bcrypt.hashSync(DEV_PASSWORD, 4) : bcrypt.hashSync(DEV_PASSWORD, 12);
  const mkUser = async (username: string, displayName: string, role: string, employeeId?: string, stageId?: string) => {
    const [u] = await db.insert(s.users).values({ username, displayName, passwordHash: hash, employeeId, mustChangePassword: opts.mustChangePassword ?? true }).returning();
    await db.insert(s.userRoles).values({ userId: u.id, roleId: roleIds[role], stageId: stageId ?? null });
    return u.id;
  };
  const userIds: Record<string, string> = {
    principal: await mkUser("principal", "المديرة", "PRINCIPAL", principal.id),
    vp_academic: await mkUser("vp.academic", "وكيلة الشؤون التعليمية", "VP_ACADEMIC", vpA.id),
    vp_students: await mkUser("vp.students", "وكيلة شؤون الطالبات", "VP_STUDENTS", vpS.id),
    directory: await mkUser("directory", "مسؤولة الدليل الرقمي", "DIRECTORY_OFFICER"),
    primary_only: await mkUser("test.primary", "حساب اختبار — الابتدائية فقط", "VP_STUDENTS", undefined, stageIds.PRIMARY),
  };

  await db.insert(s.schoolSettings).values([
    { schoolId: school.id, key: "attendance.autoDropoutRule", value: { enabled: false, note: "لا تحويل آلي إلى منقطعة ما لم تُعتمد قاعدة رسمية" } },
    { schoolId: school.id, key: "identity.verification", value: { principalName: "PENDING_VERIFICATION" } },
  ]);

  return { schoolId: school.id, stageIds, yearId: year.id, termId: term.id, userIds, roleIds, sectionIds, teacherIds, studentIds, timetableId: tt.id };
}
