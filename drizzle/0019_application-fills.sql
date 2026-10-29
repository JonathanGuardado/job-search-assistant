CREATE TABLE "application_fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"raw_job_id" uuid NOT NULL,
	"form_fingerprint" text NOT NULL,
	"packet" jsonb NOT NULL,
	"packet_hash" text NOT NULL,
	"status" text NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"fill_report" jsonb,
	"submission" jsonb,
	"outcome" text,
	"outcome_evidence" jsonb,
	"application_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_fills_status_check" CHECK ("application_fills"."status" in ('prepared', 'queued', 'launching', 'filling', 'waiting', 'submitted', 'uncertain', 'failed', 'abandoned', 'stale')),
	CONSTRAINT "application_fills_outcome_check" CHECK ("application_fills"."outcome" is null or "application_fills"."outcome" in ('confirmed', 'rejected', 'unknown', 'user_reported')),
	CONSTRAINT "application_fills_lease_check" CHECK (("application_fills"."lease_owner" is null) = ("application_fills"."lease_expires_at" is null)),
	CONSTRAINT "application_fills_application_check" CHECK ("application_fills"."application_id" is null or "application_fills"."status" = 'submitted')
);
--> statement-breakpoint
ALTER TABLE "application_fills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "application_fills" ADD CONSTRAINT "application_fills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_fills" ADD CONSTRAINT "application_fills_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_fills" ADD CONSTRAINT "application_fills_raw_job_id_raw_jobs_id_fk" FOREIGN KEY ("raw_job_id") REFERENCES "public"."raw_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_fills" ADD CONSTRAINT "application_fills_application_fk" FOREIGN KEY ("application_id","user_id") REFERENCES "public"."applications"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_fills_in_progress_key" ON "application_fills" USING btree ("user_id","job_id") WHERE "application_fills"."status" in ('queued', 'launching', 'filling', 'waiting', 'uncertain') or ("application_fills"."status" = 'submitted' and "application_fills"."application_id" is null);--> statement-breakpoint
CREATE INDEX "application_fills_user_job_idx" ON "application_fills" USING btree ("user_id","job_id","created_at");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_mode_check" CHECK ("applications"."mode" in ('manual', 'assisted'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "application_fills" AS PERMISSIVE FOR ALL TO "job_seeker_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));