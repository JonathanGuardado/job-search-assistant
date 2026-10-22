ALTER TABLE "jobs" ADD COLUMN "source_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "external_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "raw_job_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "raw_fetched_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "seniority" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "location_country" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_id_job_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."job_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_raw_job_id_raw_jobs_id_fk" FOREIGN KEY ("raw_job_id") REFERENCES "public"."raw_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_canonical_job_id_idx" ON "jobs" USING btree ("canonical_job_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_external_key" UNIQUE("source_id","external_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_seniority_check" CHECK ("jobs"."seniority" in ('intern', 'junior', 'senior', 'lead', 'staff', 'principal'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_location_country_check" CHECK ("jobs"."location_country" ~ '^[A-Z]{2}$');