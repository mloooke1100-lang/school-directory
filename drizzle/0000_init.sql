CREATE TYPE "public"."absence_kind" AS ENUM('EXCUSED', 'UNEXCUSED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('PLANNED', 'CONFIRMED', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."attendance_type" AS ENUM('ABSENCE', 'LATE');--> statement-breakpoint
CREATE TYPE "public"."calendar_exception_type" AS ENUM('HOLIDAY', 'SPECIAL_SCHEDULE', 'EXAM');--> statement-breakpoint
CREATE TYPE "public"."calendar_type" AS ENUM('HIJRI', 'GREGORIAN');--> statement-breakpoint
CREATE TYPE "public"."data_status" AS ENUM('COMPLETE', 'INCOMPLETE', 'PENDING_VERIFICATION');--> statement-breakpoint
CREATE TYPE "public"."employee_category" AS ENUM('LEADERSHIP', 'TEACHER', 'ADMINISTRATIVE', 'SERVICE', 'GUARD', 'COUNSELOR');--> statement-breakpoint
CREATE TYPE "public"."employment_status" AS ENUM('ACTIVE', 'ON_LEAVE', 'SECONDED', 'TRANSFERRED', 'RETIRED', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('ACTIVE', 'TRANSFERRED_OUT', 'DROPPED_OUT', 'WITHDRAWN', 'GRADUATED', 'PROMOTED');--> statement-breakpoint
CREATE TYPE "public"."entry_kind" AS ENUM('LESSON', 'STANDBY', 'ACTIVITY');--> statement-breakpoint
CREATE TYPE "public"."import_kind" AS ENUM('EMPLOYEES', 'TEACHERS', 'STUDENTS', 'TIMETABLE', 'SERVICE_STAFF');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'APPLIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."issue_severity" AS ENUM('INFO', 'WARNING', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."override_type" AS ENUM('CANCELLED', 'ROOM_CHANGE', 'TIME_CHANGE');--> statement-breakpoint
CREATE TYPE "public"."period_kind" AS ENUM('LESSON', 'BREAK', 'PRAYER', 'ASSEMBLY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."position_code" AS ENUM('PRINCIPAL', 'VP_ACADEMIC', 'VP_STUDENTS', 'COUNSELOR', 'DIRECTORY_OFFICER', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('RECORDED', 'APPROVED', 'CORRECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."service_date_kind" AS ENUM('MINISTRY', 'SCHOOL');--> statement-breakpoint
CREATE TYPE "public"."stage_code" AS ENUM('KINDERGARTEN', 'PRIMARY', 'INTERMEDIATE');--> statement-breakpoint
CREATE TYPE "public"."status_change_type" AS ENUM('DROPOUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'WITHDRAWAL', 'REINSTATEMENT');--> statement-breakpoint
CREATE TYPE "public"."supervision_period" AS ENUM('BEFORE_SCHOOL', 'BREAK', 'BETWEEN_PERIODS', 'DISMISSAL', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."timetable_status" AS ENUM('DRAFT', 'APPROVED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."year_status" AS ENUM('PLANNED', 'ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "academic_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	CONSTRAINT "terms_dates_ck" CHECK ("academic_terms"."end_date" >= "academic_terms"."start_date")
);
--> statement-breakpoint
CREATE TABLE "academic_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "year_status" DEFAULT 'PLANNED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "years_dates_ck" CHECK ("academic_years"."end_date" > "academic_years"."start_date")
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"section_id" uuid,
	"group_name" text,
	"supervisor_id" uuid NOT NULL,
	"room_id" uuid,
	"location" text,
	"status" "assignment_status" DEFAULT 'PLANNED' NOT NULL,
	"notes" text,
	"created_by_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_time_ck" CHECK ("activity_sessions"."end_minute" > "activity_sessions"."start_minute")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"stage_id" uuid,
	"type" "calendar_exception_type" NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grade_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"homeroom_teacher_id" uuid,
	"room_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"position" "position_code" NOT NULL,
	"title_ar" text NOT NULL,
	"stage_id" uuid,
	"year_id" uuid,
	"start_date" date,
	"end_date" date,
	"duties" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_service_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "service_date_kind" NOT NULL,
	"date" date,
	"original_calendar" "calendar_type",
	"original_text" text,
	"verification" "data_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"category" "employee_category" NOT NULL,
	"job_title" text NOT NULL,
	"specialization" text,
	"status" "employment_status" DEFAULT 'ACTIVE' NOT NULL,
	"data_status" "data_status" DEFAULT 'INCOMPLETE' NOT NULL,
	"duties" text,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "export_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"report_type" text NOT NULL,
	"format" text NOT NULL,
	"filters" jsonb,
	"row_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building" text NOT NULL,
	"name" text NOT NULL,
	"order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "import_kind" NOT NULL,
	"source_label" text NOT NULL,
	"status" "import_status" DEFAULT 'DRAFT' NOT NULL,
	"rows" jsonb NOT NULL,
	"created_by_id" uuid NOT NULL,
	"reviewed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_row_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"field" text,
	"message" text NOT NULL,
	"severity" "issue_severity" DEFAULT 'WARNING' NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"day_of_week" integer,
	"number" integer NOT NULL,
	"kind" "period_kind" DEFAULT 'LESSON' NOT NULL,
	"label" text,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	CONSTRAINT "periods_time_ck" CHECK ("period_definitions"."start_minute" >= 0 AND "period_definitions"."end_minute" <= 1440 AND "period_definitions"."end_minute" > "period_definitions"."start_minute"),
	CONSTRAINT "periods_day_ck" CHECK ("period_definitions"."day_of_week" IS NULL OR ("period_definitions"."day_of_week" BETWEEN 0 AND 6))
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"floor_id" uuid,
	"capacity" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "rooms_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "school_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ar" text NOT NULL,
	"education_office" text NOT NULL,
	"system_name" text NOT NULL,
	"tagline" text,
	"credit_line" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"official_approved" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "educational_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"code" "stage_code" NOT NULL,
	"name_ar" text NOT NULL,
	"order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_attendance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"date" date NOT NULL,
	"type" "attendance_type" NOT NULL,
	"absence_kind" "absence_kind",
	"school_start_minute" integer,
	"arrival_minute" integer,
	"late_minutes" integer,
	"status" "record_status" DEFAULT 'RECORDED' NOT NULL,
	"supersedes_id" uuid,
	"notes" text,
	"recorded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_attendance_events_supersedes_id_unique" UNIQUE("supersedes_id"),
	CONSTRAINT "attendance_late_fields_ck" CHECK ("student_attendance_events"."type" <> 'LATE' OR ("student_attendance_events"."arrival_minute" IS NOT NULL AND "student_attendance_events"."school_start_minute" IS NOT NULL)),
	CONSTRAINT "attendance_arrival_ck" CHECK ("student_attendance_events"."arrival_minute" IS NULL OR ("student_attendance_events"."arrival_minute" >= 0 AND "student_attendance_events"."arrival_minute" < 1440)),
	CONSTRAINT "attendance_start_ck" CHECK ("student_attendance_events"."school_start_minute" IS NULL OR ("student_attendance_events"."school_start_minute" >= 0 AND "student_attendance_events"."school_start_minute" < 1440))
);
--> statement-breakpoint
CREATE TABLE "student_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"enrolled_at" date NOT NULL,
	"status" "enrollment_status" DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "student_leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"date" date NOT NULL,
	"request_minute" integer NOT NULL,
	"exit_minute" integer,
	"reason" text,
	"status" "request_status" DEFAULT 'PENDING' NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_request_ck" CHECK ("student_leave_requests"."request_minute" IS NULL OR ("student_leave_requests"."request_minute" >= 0 AND "student_leave_requests"."request_minute" < 1440)),
	CONSTRAINT "leave_exit_ck" CHECK ("student_leave_requests"."exit_minute" IS NULL OR ("student_leave_requests"."exit_minute" >= 0 AND "student_leave_requests"."exit_minute" < 1440))
);
--> statement-breakpoint
CREATE TABLE "student_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"type" "status_change_type" NOT NULL,
	"effective_date" date NOT NULL,
	"reference" text,
	"destination_school" text,
	"status" "request_status" DEFAULT 'PENDING' NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"school_number" text,
	"data_status" "data_status" DEFAULT 'COMPLETE' NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	CONSTRAINT "students_school_number_unique" UNIQUE("school_number")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid,
	"name_ar" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "substitute_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"date" date NOT NULL,
	"section_id" uuid NOT NULL,
	"period_number" integer NOT NULL,
	"original_teacher_id" uuid,
	"substitute_teacher_id" uuid NOT NULL,
	"original_entry_id" uuid,
	"start_minute" integer,
	"end_minute" integer,
	"status" "assignment_status" DEFAULT 'PLANNED' NOT NULL,
	"notes" text,
	"created_by_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_not_self_ck" CHECK ("substitute_assignments"."original_teacher_id" IS NULL OR "substitute_assignments"."original_teacher_id" <> "substitute_assignments"."substitute_teacher_id")
);
--> statement-breakpoint
CREATE TABLE "supervision_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supervision_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"day_of_week" integer,
	"date" date,
	"period_type" "supervision_period" NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"status" "assignment_status" DEFAULT 'PLANNED' NOT NULL,
	"notes" text,
	"assigned_by_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supervision_day_or_date_ck" CHECK (("supervision_assignments"."day_of_week" IS NULL) <> ("supervision_assignments"."date" IS NULL)),
	CONSTRAINT "supervision_time_ck" CHECK ("supervision_assignments"."end_minute" > "supervision_assignments"."start_minute")
);
--> statement-breakpoint
CREATE TABLE "teacher_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timetable_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timetable_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"period_number" integer NOT NULL,
	"kind" "entry_kind" DEFAULT 'LESSON' NOT NULL,
	"section_id" uuid,
	"subject_id" uuid,
	"teacher_id" uuid NOT NULL,
	"room_id" uuid,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	CONSTRAINT "tt_day_ck" CHECK ("timetable_entries"."day_of_week" BETWEEN 0 AND 6),
	CONSTRAINT "tt_lesson_needs_section_ck" CHECK ("timetable_entries"."kind" <> 'LESSON' OR "timetable_entries"."section_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "timetable_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"entry_id" uuid NOT NULL,
	"type" "override_type" NOT NULL,
	"new_room_id" uuid,
	"start_minute" integer,
	"end_minute" integer,
	"reason" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"stage_id" uuid
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"employee_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"mfa_secret" text,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
CREATE TABLE "weekly_timetables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" timetable_status DEFAULT 'DRAFT' NOT NULL,
	"effective_from" date,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_stage_id_educational_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."educational_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_section_id_class_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."class_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_supervisor_id_employees_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_exceptions" ADD CONSTRAINT "calendar_exceptions_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_exceptions" ADD CONSTRAINT "calendar_exceptions_stage_id_educational_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."educational_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sections" ADD CONSTRAINT "class_sections_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sections" ADD CONSTRAINT "class_sections_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sections" ADD CONSTRAINT "class_sections_homeroom_teacher_id_employees_id_fk" FOREIGN KEY ("homeroom_teacher_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sections" ADD CONSTRAINT "class_sections_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_stage_id_educational_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."educational_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_service_dates" ADD CONSTRAINT "employee_service_dates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_service_dates" ADD CONSTRAINT "employee_service_dates_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_logs" ADD CONSTRAINT "export_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_stage_id_educational_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."educational_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row_issues" ADD CONSTRAINT "import_row_issues_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_definitions" ADD CONSTRAINT "period_definitions_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_definitions" ADD CONSTRAINT "period_definitions_stage_id_educational_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."educational_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_settings" ADD CONSTRAINT "school_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_settings" ADD CONSTRAINT "school_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "educational_stages" ADD CONSTRAINT "educational_stages_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance_events" ADD CONSTRAINT "student_attendance_events_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance_events" ADD CONSTRAINT "student_attendance_events_enrollment_id_student_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."student_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance_events" ADD CONSTRAINT "student_attendance_events_supersedes_id_student_attendance_events_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."student_attendance_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance_events" ADD CONSTRAINT "student_attendance_events_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_section_id_class_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."class_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_leave_requests" ADD CONSTRAINT "student_leave_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_leave_requests" ADD CONSTRAINT "student_leave_requests_enrollment_id_student_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."student_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_leave_requests" ADD CONSTRAINT "student_leave_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_leave_requests" ADD CONSTRAINT "student_leave_requests_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_status_changes" ADD CONSTRAINT "student_status_changes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_status_changes" ADD CONSTRAINT "student_status_changes_enrollment_id_student_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."student_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_status_changes" ADD CONSTRAINT "student_status_changes_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_status_changes" ADD CONSTRAINT "student_status_changes_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_stage_id_educational_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."educational_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_assignments" ADD CONSTRAINT "substitute_assignments_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_assignments" ADD CONSTRAINT "substitute_assignments_section_id_class_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."class_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_assignments" ADD CONSTRAINT "substitute_assignments_original_teacher_id_employees_id_fk" FOREIGN KEY ("original_teacher_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_assignments" ADD CONSTRAINT "substitute_assignments_substitute_teacher_id_employees_id_fk" FOREIGN KEY ("substitute_teacher_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_assignments" ADD CONSTRAINT "substitute_assignments_original_entry_id_timetable_entries_id_fk" FOREIGN KEY ("original_entry_id") REFERENCES "public"."timetable_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_assignments" ADD CONSTRAINT "substitute_assignments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervision_areas" ADD CONSTRAINT "supervision_areas_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervision_assignments" ADD CONSTRAINT "supervision_assignments_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervision_assignments" ADD CONSTRAINT "supervision_assignments_area_id_supervision_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."supervision_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervision_assignments" ADD CONSTRAINT "supervision_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervision_assignments" ADD CONSTRAINT "supervision_assignments_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "teacher_subjects_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "teacher_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "teacher_subjects_stage_id_educational_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."educational_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_timetable_id_weekly_timetables_id_fk" FOREIGN KEY ("timetable_id") REFERENCES "public"."weekly_timetables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_section_id_class_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."class_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_teacher_id_employees_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_overrides" ADD CONSTRAINT "timetable_overrides_entry_id_timetable_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."timetable_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_overrides" ADD CONSTRAINT "timetable_overrides_new_room_id_rooms_id_fk" FOREIGN KEY ("new_room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_overrides" ADD CONSTRAINT "timetable_overrides_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_stage_id_educational_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."educational_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_timetables" ADD CONSTRAINT "weekly_timetables_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_timetables" ADD CONSTRAINT "weekly_timetables_stage_id_educational_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."educational_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_timetables" ADD CONSTRAINT "weekly_timetables_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "terms_year_number_uq" ON "academic_terms" USING btree ("year_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "years_school_name_uq" ON "academic_years" USING btree ("school_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "years_one_active_uq" ON "academic_years" USING btree ("school_id") WHERE "academic_years"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "activity_date_idx" ON "activity_sessions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cal_exc_dates_idx" ON "calendar_exceptions" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_grade_year_name_uq" ON "class_sections" USING btree ("grade_id","year_id","name");--> statement-breakpoint
CREATE INDEX "assignments_position_idx" ON "employee_assignments" USING btree ("position","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "service_dates_emp_kind_uq" ON "employee_service_dates" USING btree ("employee_id","kind");--> statement-breakpoint
CREATE INDEX "employees_name_idx" ON "employees" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "employees_category_idx" ON "employees" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "floors_building_name_uq" ON "floors" USING btree ("building","name");--> statement-breakpoint
CREATE UNIQUE INDEX "grades_stage_order_uq" ON "grades" USING btree ("stage_id","order");--> statement-breakpoint
CREATE INDEX "import_issues_batch_idx" ON "import_row_issues" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "periods_slot_uq" ON "period_definitions" USING btree ("term_id","stage_id",coalesce("day_of_week", -1),"number");--> statement-breakpoint
CREATE UNIQUE INDEX "school_settings_key_uq" ON "school_settings" USING btree ("school_id","key");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stages_school_code_uq" ON "educational_stages" USING btree ("school_id","code");--> statement-breakpoint
CREATE INDEX "attendance_date_type_idx" ON "student_attendance_events" USING btree ("date","type");--> statement-breakpoint
CREATE INDEX "attendance_student_date_idx" ON "student_attendance_events" USING btree ("student_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_active_uq" ON "student_attendance_events" USING btree ("student_id","date","type") WHERE "student_attendance_events"."status" IN ('RECORDED','APPROVED');--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_student_year_uq" ON "student_enrollments" USING btree ("student_id","year_id");--> statement-breakpoint
CREATE INDEX "enrollment_section_idx" ON "student_enrollments" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "leave_date_idx" ON "student_leave_requests" USING btree ("date");--> statement-breakpoint
CREATE INDEX "status_change_student_idx" ON "student_status_changes" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "students_name_idx" ON "students" USING btree ("name_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_stage_name_uq" ON "subjects" USING btree ("stage_id","name_ar");--> statement-breakpoint
CREATE INDEX "sub_date_teacher_idx" ON "substitute_assignments" USING btree ("date","substitute_teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_section_slot_uq" ON "substitute_assignments" USING btree ("date","section_id","period_number") WHERE "substitute_assignments"."status" <> 'CANCELLED';--> statement-breakpoint
CREATE UNIQUE INDEX "sub_teacher_slot_uq" ON "substitute_assignments" USING btree ("date","substitute_teacher_id","period_number") WHERE "substitute_assignments"."status" <> 'CANCELLED';--> statement-breakpoint
CREATE UNIQUE INDEX "areas_floor_name_uq" ON "supervision_areas" USING btree ("floor_id","name");--> statement-breakpoint
CREATE INDEX "supervision_emp_day_idx" ON "supervision_assignments" USING btree ("employee_id","day_of_week");--> statement-breakpoint
CREATE INDEX "supervision_date_idx" ON "supervision_assignments" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_subjects_uq" ON "teacher_subjects" USING btree ("employee_id","subject_id","stage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tt_teacher_slot_uq" ON "timetable_entries" USING btree ("timetable_id","day_of_week","period_number","teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tt_section_slot_uq" ON "timetable_entries" USING btree ("timetable_id","day_of_week","period_number","section_id") WHERE "timetable_entries"."section_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tt_room_slot_uq" ON "timetable_entries" USING btree ("timetable_id","day_of_week","period_number","room_id") WHERE "timetable_entries"."room_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "override_date_entry_type_uq" ON "timetable_overrides" USING btree ("date","entry_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_uq" ON "user_roles" USING btree ("user_id","role_id",coalesce("stage_id", '00000000-0000-0000-0000-000000000000'::uuid));