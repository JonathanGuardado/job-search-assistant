CREATE TABLE "eligibility_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"engine_version" integer NOT NULL,
	"verdict" text NOT NULL,
	"confidence" real NOT NULL,
	"stage" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"claims_id" uuid,
	"prompt_version" integer,
	"model" text,
	"job_fingerprint" text NOT NULL,
	"profile_hash" text NOT NULL,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_override" text,
	"override_reason" text,
	CONSTRAINT "eligibility_assessments_user_job_engine_key" UNIQUE("user_id","job_id","engine_version"),
	CONSTRAINT "eligibility_assessments_verdict_check" CHECK ("eligibility_assessments"."verdict" in ('eligible', 'not_eligible', 'needs_review')),
	CONSTRAINT "eligibility_assessments_stage_check" CHECK ("eligibility_assessments"."stage" in ('structured', 'extracted', 'partial')),
	CONSTRAINT "eligibility_assessments_override_check" CHECK ("eligibility_assessments"."user_override" is null or "eligibility_assessments"."user_override" in ('eligible', 'not_eligible', 'needs_review')),
	CONSTRAINT "eligibility_assessments_confidence_check" CHECK ("eligibility_assessments"."confidence" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "eligibility_assessments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_eligibility_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"task_version" integer NOT NULL,
	"job_fingerprint" text NOT NULL,
	"claims" jsonb NOT NULL,
	"traces" jsonb NOT NULL,
	"model" text,
	"cost_micro_usd" bigint NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_eligibility_claims_job_task_key" UNIQUE("job_id","task_version")
);
--> statement-breakpoint
ALTER TABLE "eligibility_assessments" ADD CONSTRAINT "eligibility_assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_assessments" ADD CONSTRAINT "eligibility_assessments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_assessments" ADD CONSTRAINT "eligibility_assessments_claims_id_job_eligibility_claims_id_fk" FOREIGN KEY ("claims_id") REFERENCES "public"."job_eligibility_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_eligibility_claims" ADD CONSTRAINT "job_eligibility_claims_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "eligibility_assessments" AS PERMISSIVE FOR ALL TO "job_seeker_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));