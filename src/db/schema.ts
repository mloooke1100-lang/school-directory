/**
 * الدليل الرقمي المدرسي المتكامل — مخطط قاعدة البيانات (PostgreSQL عبر Drizzle ORM)
 *
 * قواعد عامة:
 * - لا يُستخدم الاسم مفتاحًا أساسيًا لأي شخص؛ كل المعرفات UUID مولّدة.
 * - لا يوجد أي حقل لرقم السجل المدني (قرار مقصود — راجع docs/DATA_PROTECTION.md).
 * - الأوقات اليومية بالدقائق منذ منتصف الليل بتوقيت Asia/Riyadh (7:15 = 435).
 * - الأيام: 0=الأحد ... 4=الخميس، 5=الجمعة، 6=السبت.
 * - التواريخ اليومية من نوع date وتُتداول كنص YYYY-MM-DD (ميلادي) لتجنب انزياح المنطقة الزمنية.
 * - السجلات القابلة للتعديل تحمل version للقفل التفاؤلي.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ───────────────────────── التعدادات ─────────────────────────

export const stageCode = pgEnum("stage_code", ["KINDERGARTEN", "PRIMARY", "INTERMEDIATE"]);
export const calendarType = pgEnum("calendar_type", ["HIJRI", "GREGORIAN"]);
export const dataStatus = pgEnum("data_status", ["COMPLETE", "INCOMPLETE", "PENDING_VERIFICATION"]);
export const yearStatus = pgEnum("year_status", ["PLANNED", "ACTIVE", "ARCHIVED"]);
export const employeeCategory = pgEnum("employee_category", [
  "LEADERSHIP",
  "TEACHER",
  "ADMINISTRATIVE",
  "SERVICE", // مستخدمة
  "GUARD", // حارس
  "COUNSELOR",
]);
export const employmentStatus = pgEnum("employment_status", [
  "ACTIVE",
  "ON_LEAVE",
  "SECONDED",
  "TRANSFERRED",
  "RETIRED",
  "INACTIVE",
]);
export const serviceDateKind = pgEnum("service_date_kind", ["MINISTRY", "SCHOOL"]);
export const positionCode = pgEnum("position_code", [
  "PRINCIPAL",
  "VP_ACADEMIC",
  "VP_STUDENTS",
  "COUNSELOR",
  "DIRECTORY_OFFICER",
  "OTHER",
]);
export const enrollmentStatus = pgEnum("enrollment_status", [
  "ACTIVE",
  "TRANSFERRED_OUT",
  "DROPPED_OUT", // منقطعة — لا تُضبط آليًا أبدًا
  "WITHDRAWN",
  "GRADUATED",
  "PROMOTED",
]);
export const attendanceType = pgEnum("attendance_type", ["ABSENCE", "LATE"]);
export const absenceKind = pgEnum("absence_kind", ["EXCUSED", "UNEXCUSED", "UNKNOWN"]);
export const recordStatus = pgEnum("record_status", ["RECORDED", "APPROVED", "CORRECTED", "CANCELLED"]);
export const requestStatus = pgEnum("request_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "COMPLETED",
  "CANCELLED",
]);
export const statusChangeType = pgEnum("status_change_type", [
  "DROPOUT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "WITHDRAWAL",
  "REINSTATEMENT",
]);
export const periodKind = pgEnum("period_kind", ["LESSON", "BREAK", "PRAYER", "ASSEMBLY", "OTHER"]);
export const timetableStatus = pgEnum("timetable_status", ["DRAFT", "APPROVED", "SUPERSEDED"]);
export const entryKind = pgEnum("entry_kind", ["LESSON", "STANDBY", "ACTIVITY"]);
export const assignmentStatus = pgEnum("assignment_status", ["PLANNED", "CONFIRMED", "DONE", "CANCELLED"]);
export const overrideType = pgEnum("override_type", ["CANCELLED", "ROOM_CHANGE", "TIME_CHANGE"]);
export const calendarExceptionType = pgEnum("calendar_exception_type", ["HOLIDAY", "SPECIAL_SCHEDULE", "EXAM"]);
export const supervisionPeriod = pgEnum("supervision_period", [
  "BEFORE_SCHOOL",
  "BREAK",
  "BETWEEN_PERIODS",
  "DISMISSAL",
  "CUSTOM",
]);
export const importKind = pgEnum("import_kind", ["EMPLOYEES", "TEACHERS", "STUDENTS", "TIMETABLE", "SERVICE_STAFF"]);
export const importStatus = pgEnum("import_status", ["DRAFT", "IN_REVIEW", "APPROVED", "APPLIED", "REJECTED"]);
export const issueSeverity = pgEnum("issue_severity", ["INFO", "WARNING", "ERROR"]);

// أعمدة مشتركة
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const version = () => integer("version").notNull().default(1);
const minuteCheck = (name: string, col: AnyPgColumn) =>
  check(name, sql`${col} IS NULL OR (${col} >= 0 AND ${col} < 1440)`);

// ───────────────────────── المستخدمات (تُعرَّف مبكرًا للمراجع) ─────────────────────────

export const users = pgTable("users", {
  id: id(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  employeeId: uuid("employee_id")
    .unique()
    .references((): AnyPgColumn => employees.id),
  isActive: boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  mfaSecret: text("mfa_secret"), // مخصص لـ TOTP لاحقًا (يُشفّر قبل التخزين)
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────────────────── المدرسة والإعدادات ─────────────────────────

export const schools = pgTable("schools", {
  id: id(),
  nameAr: text("name_ar").notNull(),
  educationOffice: text("education_office").notNull(),
  systemName: text("system_name").notNull(),
  tagline: text("tagline"),
  creditLine: text("credit_line").notNull(),
  timezone: text("timezone").notNull().default("Asia/Riyadh"),
  officialApproved: boolean("official_approved").notNull().default(false),
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  updatedById: uuid("updated_by_id").references(() => users.id),
});

export const schoolSettings = pgTable(
  "school_settings",
  {
    id: id(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: updatedAt(),
    updatedById: uuid("updated_by_id").references(() => users.id),
  },
  (t) => [uniqueIndex("school_settings_key_uq").on(t.schoolId, t.key)],
);

export const stages = pgTable(
  "educational_stages",
  {
    id: id(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    code: stageCode("code").notNull(),
    nameAr: text("name_ar").notNull(),
    order: integer("order").notNull(),
  },
  (t) => [uniqueIndex("stages_school_code_uq").on(t.schoolId, t.code)],
);

// ───────────────────────── السنوات والفصول ─────────────────────────

export const academicYears = pgTable(
  "academic_years",
  {
    id: id(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: yearStatus("status").notNull().default("PLANNED"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("years_school_name_uq").on(t.schoolId, t.name),
    // سنة نشطة واحدة فقط لكل مدرسة
    uniqueIndex("years_one_active_uq").on(t.schoolId).where(sql`${t.status} = 'ACTIVE'`),
    check("years_dates_ck", sql`${t.endDate} > ${t.startDate}`),
  ],
);

export const academicTerms = pgTable(
  "academic_terms",
  {
    id: id(),
    yearId: uuid("year_id")
      .notNull()
      .references(() => academicYears.id),
    number: integer("number").notNull(),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    isActive: boolean("is_active").notNull().default(false),
  },
  (t) => [
    uniqueIndex("terms_year_number_uq").on(t.yearId, t.number),
    check("terms_dates_ck", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

export const calendarExceptions = pgTable(
  "calendar_exceptions",
  {
    id: id(),
    termId: uuid("term_id")
      .notNull()
      .references(() => academicTerms.id),
    stageId: uuid("stage_id").references(() => stages.id), // null = كل المراحل
    type: calendarExceptionType("type").notNull(),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("cal_exc_dates_idx").on(t.startDate, t.endDate)],
);

export const grades = pgTable(
  "grades",
  {
    id: id(),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
    nameAr: text("name_ar").notNull(),
    order: integer("order").notNull(),
  },
  (t) => [uniqueIndex("grades_stage_order_uq").on(t.stageId, t.order)],
);

// ───────────────────────── مراقبة الأدوار: المباني والأدوار ─────────────────────────

export const floors = pgTable(
  "floors",
  {
    id: id(),
    building: text("building").notNull(),
    name: text("name").notNull(),
    order: integer("order").notNull(),
  },
  (t) => [uniqueIndex("floors_building_name_uq").on(t.building, t.name)],
);

export const rooms = pgTable("rooms", {
  id: id(),
  name: text("name").notNull().unique(),
  floorId: uuid("floor_id").references(() => floors.id),
  capacity: integer("capacity"),
  isActive: boolean("is_active").notNull().default(true),
});

// ───────────────────────── الموظفات ─────────────────────────

export const employees = pgTable(
  "employees",
  {
    id: id(),
    fullName: text("full_name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    category: employeeCategory("category").notNull(),
    jobTitle: text("job_title").notNull(),
    specialization: text("specialization"),
    status: employmentStatus("status").notNull().default("ACTIVE"),
    dataStatus: dataStatus("data_status").notNull().default("INCOMPLETE"),
    duties: text("duties"),
    workLocation: text("work_location"), // المرحلة أو موقع العمل (للمستخدمات والحراس خاصة)
    notes: text("notes"),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdById: uuid("created_by_id"),
    updatedById: uuid("updated_by_id"),
  },
  (t) => [index("employees_name_idx").on(t.nameNormalized), index("employees_category_idx").on(t.category)],
);

/** تاريخا المباشرة منفصلان: صف لكل نوع (الوزارة / المدرسة) — لا يُفترض تطابقهما */
export const employeeServiceDates = pgTable(
  "employee_service_dates",
  {
    id: id(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: serviceDateKind("kind").notNull(),
    date: date("date"), // الميلادي المكافئ بعد التحويل
    originalCalendar: calendarType("original_calendar"),
    originalText: text("original_text"), // النص كما ورد في المصدر (مثل 1440/05/12)
    verification: dataStatus("verification").notNull().default("PENDING_VERIFICATION"),
    updatedAt: updatedAt(),
    updatedById: uuid("updated_by_id").references(() => users.id),
  },
  (t) => [uniqueIndex("service_dates_emp_kind_uq").on(t.employeeId, t.kind)],
);

export const employeeAssignments = pgTable(
  "employee_assignments",
  {
    id: id(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    position: positionCode("position").notNull(),
    titleAr: text("title_ar").notNull(),
    stageId: uuid("stage_id").references(() => stages.id),
    yearId: uuid("year_id").references(() => academicYears.id),
    startDate: date("start_date"),
    endDate: date("end_date"),
    duties: text("duties"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [index("assignments_position_idx").on(t.position, t.isActive)],
);

export const subjects = pgTable(
  "subjects",
  {
    id: id(),
    stageId: uuid("stage_id").references(() => stages.id),
    nameAr: text("name_ar").notNull(),
  },
  (t) => [uniqueIndex("subjects_stage_name_uq").on(t.stageId, t.nameAr)],
);

export const teacherSubjects = pgTable(
  "teacher_subjects",
  {
    id: id(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
  },
  (t) => [uniqueIndex("teacher_subjects_uq").on(t.employeeId, t.subjectId, t.stageId)],
);

export const classSections = pgTable(
  "class_sections",
  {
    id: id(),
    gradeId: uuid("grade_id")
      .notNull()
      .references(() => grades.id),
    yearId: uuid("year_id")
      .notNull()
      .references(() => academicYears.id),
    name: text("name").notNull(),
    homeroomTeacherId: uuid("homeroom_teacher_id").references(() => employees.id),
    roomId: uuid("room_id").references(() => rooms.id),
    isActive: boolean("is_active").notNull().default(true),
    version: version(),
    updatedAt: updatedAt(),
    updatedById: uuid("updated_by_id").references((): AnyPgColumn => users.id),
  },
  (t) => [uniqueIndex("sections_grade_year_name_uq").on(t.gradeId, t.yearId, t.name)],
);

// ───────────────────────── الطالبات ─────────────────────────

export const students = pgTable(
  "students",
  {
    id: id(),
    fullName: text("full_name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    schoolNumber: text("school_number").unique(),
    dataStatus: dataStatus("data_status").notNull().default("COMPLETE"),
    notes: text("notes"),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdById: uuid("created_by_id").references(() => users.id),
    updatedById: uuid("updated_by_id").references(() => users.id),
  },
  (t) => [index("students_name_idx").on(t.nameNormalized)],
);

export const studentEnrollments = pgTable(
  "student_enrollments",
  {
    id: id(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id),
    yearId: uuid("year_id")
      .notNull()
      .references(() => academicYears.id),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => classSections.id),
    enrolledAt: date("enrolled_at").notNull(),
    status: enrollmentStatus("status").notNull().default("ACTIVE"),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedById: uuid("updated_by_id").references(() => users.id),
  },
  (t) => [
    uniqueIndex("enrollment_student_year_uq").on(t.studentId, t.yearId),
    index("enrollment_section_idx").on(t.sectionId),
  ],
);

export const studentAttendanceEvents = pgTable(
  "student_attendance_events",
  {
    id: id(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => studentEnrollments.id),
    date: date("date").notNull(),
    type: attendanceType("type").notNull(),
    absenceKind: absenceKind("absence_kind"),
    schoolStartMinute: integer("school_start_minute"),
    arrivalMinute: integer("arrival_minute"),
    lateMinutes: integer("late_minutes"),
    status: recordStatus("status").notNull().default("RECORDED"),
    supersedesId: uuid("supersedes_id")
      .unique()
      .references((): AnyPgColumn => studentAttendanceEvents.id),
    notes: text("notes"),
    recordedById: uuid("recorded_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("attendance_date_type_idx").on(t.date, t.type),
    index("attendance_student_date_idx").on(t.studentId, t.date),
    // منع التكرار: سجل نشط واحد لكل (طالبة، تاريخ، نوع)
    uniqueIndex("attendance_active_uq")
      .on(t.studentId, t.date, t.type)
      .where(sql`${t.status} IN ('RECORDED','APPROVED')`),
    check(
      "attendance_late_fields_ck",
      sql`${t.type} <> 'LATE' OR (${t.arrivalMinute} IS NOT NULL AND ${t.schoolStartMinute} IS NOT NULL)`,
    ),
    minuteCheck("attendance_arrival_ck", t.arrivalMinute),
    minuteCheck("attendance_start_ck", t.schoolStartMinute),
  ],
);

export const studentLeaveRequests = pgTable(
  "student_leave_requests",
  {
    id: id(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => studentEnrollments.id),
    date: date("date").notNull(),
    requestMinute: integer("request_minute").notNull(),
    exitMinute: integer("exit_minute"),
    reason: text("reason"),
    status: requestStatus("status").notNull().default("PENDING"),
    requestedById: uuid("requested_by_id")
      .notNull()
      .references(() => users.id),
    approvedById: uuid("approved_by_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    notes: text("notes"),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("leave_date_idx").on(t.date),
    minuteCheck("leave_request_ck", t.requestMinute),
    minuteCheck("leave_exit_ck", t.exitMinute),
  ],
);

export const studentStatusChanges = pgTable(
  "student_status_changes",
  {
    id: id(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => studentEnrollments.id),
    type: statusChangeType("type").notNull(),
    effectiveDate: date("effective_date").notNull(),
    reference: text("reference"),
    destinationSchool: text("destination_school"),
    status: requestStatus("status").notNull().default("PENDING"),
    requestedById: uuid("requested_by_id")
      .notNull()
      .references(() => users.id),
    approvedById: uuid("approved_by_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    notes: text("notes"),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("status_change_student_idx").on(t.studentId)],
);

// ───────────────────────── الجداول ─────────────────────────

/** أوقات الحصص قابلة للإعداد لكل مرحلة وفصل دراسي — لا أوقات افتراضية مفترضة */
export const periodDefinitions = pgTable(
  "period_definitions",
  {
    id: id(),
    termId: uuid("term_id")
      .notNull()
      .references(() => academicTerms.id),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
    dayOfWeek: integer("day_of_week"), // null = كل الأيام؛ قيمة = تعريف خاص بيوم
    number: integer("number").notNull(),
    kind: periodKind("kind").notNull().default("LESSON"),
    label: text("label"),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    version: version(),
    updatedAt: updatedAt(),
    updatedById: uuid("updated_by_id").references((): AnyPgColumn => users.id),
  },
  (t) => [
    uniqueIndex("periods_slot_uq").on(t.termId, t.stageId, sql`coalesce(${t.dayOfWeek}, -1)`, t.number),
    check("periods_time_ck", sql`${t.startMinute} >= 0 AND ${t.endMinute} <= 1440 AND ${t.endMinute} > ${t.startMinute}`),
    check("periods_day_ck", sql`${t.dayOfWeek} IS NULL OR (${t.dayOfWeek} BETWEEN 0 AND 6)`),
  ],
);

export const weeklyTimetables = pgTable(
  "weekly_timetables",
  {
    id: id(),
    termId: uuid("term_id")
      .notNull()
      .references(() => academicTerms.id),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
    name: text("name").notNull(),
    status: timetableStatus("status").notNull().default("DRAFT"),
    effectiveFrom: date("effective_from"),
    sourceTimetableId: uuid("source_timetable_id").references((): AnyPgColumn => weeklyTimetables.id),
    approvedById: uuid("approved_by_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // جدول معتمد واحد ومسودة واحدة لكل مرحلة في كل فصل دراسي؛ السابق يصبح «مستبدلًا» ولا يُحذف
    uniqueIndex("tt_one_approved_uq").on(t.termId, t.stageId).where(sql`${t.status} = 'APPROVED'`),
    uniqueIndex("tt_one_draft_uq").on(t.termId, t.stageId).where(sql`${t.status} = 'DRAFT'`),
  ],
);

export const timetableEntries = pgTable(
  "timetable_entries",
  {
    id: id(),
    timetableId: uuid("timetable_id")
      .notNull()
      .references(() => weeklyTimetables.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    periodNumber: integer("period_number").notNull(),
    kind: entryKind("kind").notNull().default("LESSON"),
    sectionId: uuid("section_id").references(() => classSections.id),
    subjectId: uuid("subject_id").references(() => subjects.id),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => employees.id),
    roomId: uuid("room_id").references(() => rooms.id),
    notes: text("notes"),
    version: version(),
    updatedAt: updatedAt(),
    updatedById: uuid("updated_by_id").references(() => users.id),
  },
  (t) => [
    // منع التعارض على مستوى قاعدة البيانات:
    uniqueIndex("tt_teacher_slot_uq").on(t.timetableId, t.dayOfWeek, t.periodNumber, t.teacherId),
    uniqueIndex("tt_section_slot_uq")
      .on(t.timetableId, t.dayOfWeek, t.periodNumber, t.sectionId)
      .where(sql`${t.sectionId} IS NOT NULL`),
    uniqueIndex("tt_room_slot_uq")
      .on(t.timetableId, t.dayOfWeek, t.periodNumber, t.roomId)
      .where(sql`${t.roomId} IS NOT NULL`),
    check("tt_day_ck", sql`${t.dayOfWeek} BETWEEN 0 AND 6`),
    check("tt_lesson_needs_section_ck", sql`${t.kind} <> 'LESSON' OR ${t.sectionId} IS NOT NULL`),
  ],
);

/** استثناءات يوم محدد — لا تعدّل الجدول الأسبوعي الأصلي */
export const timetableOverrides = pgTable(
  "timetable_overrides",
  {
    id: id(),
    date: date("date").notNull(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => timetableEntries.id, { onDelete: "cascade" }),
    type: overrideType("type").notNull(),
    newRoomId: uuid("new_room_id").references(() => rooms.id),
    startMinute: integer("start_minute"),
    endMinute: integer("end_minute"),
    reason: text("reason"),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("override_date_entry_type_uq").on(t.date, t.entryId, t.type)],
);

/** حصص الانتظار الفعلية (بديلة لمعلمة غائبة في تاريخ محدد) — منفصلة عن الجدول الأساسي */
export const substituteAssignments = pgTable(
  "substitute_assignments",
  {
    id: id(),
    termId: uuid("term_id")
      .notNull()
      .references(() => academicTerms.id),
    date: date("date").notNull(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => classSections.id),
    periodNumber: integer("period_number").notNull(),
    originalTeacherId: uuid("original_teacher_id").references(() => employees.id),
    substituteTeacherId: uuid("substitute_teacher_id")
      .notNull()
      .references(() => employees.id),
    originalEntryId: uuid("original_entry_id").references(() => timetableEntries.id),
    startMinute: integer("start_minute"),
    endMinute: integer("end_minute"),
    status: assignmentStatus("status").notNull().default("PLANNED"),
    notes: text("notes"),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sub_date_teacher_idx").on(t.date, t.substituteTeacherId),
    uniqueIndex("sub_section_slot_uq")
      .on(t.date, t.sectionId, t.periodNumber)
      .where(sql`${t.status} <> 'CANCELLED'`),
    uniqueIndex("sub_teacher_slot_uq")
      .on(t.date, t.substituteTeacherId, t.periodNumber)
      .where(sql`${t.status} <> 'CANCELLED'`),
    check("sub_not_self_ck", sql`${t.originalTeacherId} IS NULL OR ${t.originalTeacherId} <> ${t.substituteTeacherId}`),
  ],
);

export const activities = pgTable("activities", {
  id: id(),
  stageId: uuid("stage_id").references(() => stages.id),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const activitySessions = pgTable(
  "activity_sessions",
  {
    id: id(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id),
    date: date("date").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    sectionId: uuid("section_id").references(() => classSections.id),
    groupName: text("group_name"),
    supervisorId: uuid("supervisor_id")
      .notNull()
      .references(() => employees.id),
    roomId: uuid("room_id").references(() => rooms.id),
    location: text("location"),
    status: assignmentStatus("status").notNull().default("PLANNED"),
    notes: text("notes"),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("activity_date_idx").on(t.date),
    check("activity_time_ck", sql`${t.endMinute} > ${t.startMinute}`),
  ],
);

// ───────────────────────── مراقبة الأدوار ─────────────────────────

export const supervisionAreas = pgTable(
  "supervision_areas",
  {
    id: id(),
    floorId: uuid("floor_id")
      .notNull()
      .references(() => floors.id),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("areas_floor_name_uq").on(t.floorId, t.name)],
);

export const supervisionAssignments = pgTable(
  "supervision_assignments",
  {
    id: id(),
    termId: uuid("term_id")
      .notNull()
      .references(() => academicTerms.id),
    areaId: uuid("area_id")
      .notNull()
      .references(() => supervisionAreas.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    dayOfWeek: integer("day_of_week"), // تكليف أسبوعي متكرر
    date: date("date"), // أو تكليف ليوم محدد
    periodType: supervisionPeriod("period_type").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    status: assignmentStatus("status").notNull().default("PLANNED"),
    notes: text("notes"),
    assignedById: uuid("assigned_by_id")
      .notNull()
      .references(() => users.id),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("supervision_emp_day_idx").on(t.employeeId, t.dayOfWeek),
    index("supervision_date_idx").on(t.date),
    check("supervision_day_or_date_ck", sql`(${t.dayOfWeek} IS NULL) <> (${t.date} IS NULL)`),
    check("supervision_time_ck", sql`${t.endMinute} > ${t.startMinute}`),
  ],
);

// ───────────────────────── الصلاحيات والجلسات ─────────────────────────

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(), // SHA-256 للرمز؛ الرمز نفسه في كوكي httpOnly فقط
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const roles = pgTable("roles", {
  id: id(),
  code: text("code").notNull().unique(),
  nameAr: text("name_ar").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
});

export const permissions = pgTable("permissions", {
  id: id(),
  code: text("code").notNull().unique(),
  nameAr: text("name_ar").notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

/** stageId = null → الدور يسري على كل المراحل؛ قيمة → مقيّد بتلك المرحلة */
export const userRoles = pgTable(
  "user_roles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id").references(() => stages.id),
  },
  (t) => [
    uniqueIndex("user_roles_uq").on(t.userId, t.roleId, sql`coalesce(${t.stageId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
  ],
);

// ───────────────────────── التدقيق والاستيراد والتصدير ─────────────────────────

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt)],
);

export const importBatches = pgTable("import_batches", {
  id: id(),
  kind: importKind("kind").notNull(),
  sourceLabel: text("source_label").notNull(), // وصف المصدر فقط — لا يُخزَّن الملف الأصلي
  status: importStatus("status").notNull().default("DRAFT"),
  rows: jsonb("rows").notNull(),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => users.id),
  reviewedById: uuid("reviewed_by_id").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const importRowIssues = pgTable(
  "import_row_issues",
  {
    id: id(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    field: text("field"),
    message: text("message").notNull(),
    severity: issueSeverity("severity").notNull().default("WARNING"),
    resolved: boolean("resolved").notNull().default(false),
  },
  (t) => [index("import_issues_batch_idx").on(t.batchId)],
);

export const exportLogs = pgTable("export_logs", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  reportType: text("report_type").notNull(),
  format: text("format").notNull(),
  filters: jsonb("filters"),
  rowCount: integer("row_count").notNull(),
  createdAt: createdAt(),
});
