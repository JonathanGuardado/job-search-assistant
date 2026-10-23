CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"occurred_on" date NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_events_to_status_check" CHECK ("application_events"."to_status" in ('applied', 'interviewing', 'offer', 'accepted', 'rejected', 'withdrawn', 'no_response')),
	CONSTRAINT "application_events_from_status_check" CHECK ("application_events"."from_status" is null or "application_events"."from_status" in ('applied', 'interviewing', 'offer', 'accepted', 'rejected', 'withdrawn', 'no_response')),
	CONSTRAINT "application_events_change_check" CHECK ("application_events"."from_status" is distinct from "application_events"."to_status")
);
--> statement-breakpoint
ALTER TABLE "application_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"raw_job_id" uuid NOT NULL,
	"status" text NOT NULL,
	"applied_on" date NOT NULL,
	"resume_id" uuid,
	"salary_asked_minor" bigint,
	"salary_asked_currency" text,
	"source_url" text NOT NULL,
	"contact" jsonb,
	"notes" text,
	"outcome_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_user_job_key" UNIQUE("user_id","job_id"),
	CONSTRAINT "applications_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "applications_status_check" CHECK ("applications"."status" in ('applied', 'interviewing', 'offer', 'accepted', 'rejected', 'withdrawn', 'no_response')),
	CONSTRAINT "applications_salary_check" CHECK (("applications"."salary_asked_minor" is null) = ("applications"."salary_asked_currency" is null) and ("applications"."salary_asked_minor" is null or "applications"."salary_asked_minor" >= 0))
);
--> statement-breakpoint
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_fk" FOREIGN KEY ("application_id","user_id") REFERENCES "public"."applications"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_raw_job_id_raw_jobs_id_fk" FOREIGN KEY ("raw_job_id") REFERENCES "public"."raw_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_events_user_application_idx" ON "application_events" USING btree ("user_id","application_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "application_events" AS PERMISSIVE FOR ALL TO "job_seeker_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "applications" AS PERMISSIVE FOR ALL TO "job_seeker_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));