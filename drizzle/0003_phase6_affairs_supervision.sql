ALTER TABLE "student_attendance_events" ADD COLUMN "approved_by_id" uuid;--> statement-breakpoint
ALTER TABLE "student_attendance_events" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "supervision_areas" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "student_attendance_events" ADD CONSTRAINT "student_attendance_events_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_active_uq" ON "student_leave_requests" USING btree ("student_id","date") WHERE "student_leave_requests"."status" IN ('PENDING','APPROVED','COMPLETED');--> statement-breakpoint
CREATE UNIQUE INDEX "status_change_pending_uq" ON "student_status_changes" USING btree ("enrollment_id") WHERE "student_status_changes"."status" = 'PENDING';