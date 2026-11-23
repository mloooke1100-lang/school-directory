ALTER TABLE "activities" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "period_definitions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "period_definitions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "period_definitions" ADD COLUMN "updated_by_id" uuid;--> statement-breakpoint
ALTER TABLE "weekly_timetables" ADD COLUMN "source_timetable_id" uuid;--> statement-breakpoint
ALTER TABLE "weekly_timetables" ADD COLUMN "created_by_id" uuid;--> statement-breakpoint
ALTER TABLE "weekly_timetables" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "period_definitions" ADD CONSTRAINT "period_definitions_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_timetables" ADD CONSTRAINT "weekly_timetables_source_timetable_id_weekly_timetables_id_fk" FOREIGN KEY ("source_timetable_id") REFERENCES "public"."weekly_timetables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_timetables" ADD CONSTRAINT "weekly_timetables_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tt_one_approved_uq" ON "weekly_timetables" USING btree ("term_id","stage_id") WHERE "weekly_timetables"."status" = 'APPROVED';--> statement-breakpoint
CREATE UNIQUE INDEX "tt_one_draft_uq" ON "weekly_timetables" USING btree ("term_id","stage_id") WHERE "weekly_timetables"."status" = 'DRAFT';