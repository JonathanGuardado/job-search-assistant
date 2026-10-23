CREATE TABLE "job_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"task_version" integer NOT NULL,
	"job_fingerprint" text NOT NULL,
	"requirements" jsonb NOT NULL,
	"traces" jsonb NOT NULL,
	"model" text,
	"cost_micro_usd" bigint NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_requirements_job_task_key" UNIQUE("job_id","task_version")
);
--> statement-breakpoint
CREATE TABLE "match_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"engine_version" integer NOT NULL,
	"dimensions" jsonb NOT NULL,
	"met_requirements" jsonb NOT NULL,
	"missing_requirements" jsonb NOT NULL,
	"concerns" text[] NOT NULL,
	"salary_compatibility" text NOT NULL,
	"requirements_id" uuid,
	"prompt_version" integer,
	"model" text,
	"job_fingerprint" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_assessments_user_job_engine_key" UNIQUE("user_id","job_id","engine_version"),
	CONSTRAINT "match_assessments_salary_check" CHECK ("match_assessments"."salary_compatibility" in ('above', 'within', 'below', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "match_assessments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD COLUMN "spoken_languages" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_assessments" ADD CONSTRAINT "match_assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_assessments" ADD CONSTRAINT "match_assessments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_assessments" ADD CONSTRAINT "match_assessments_requirements_id_job_requirements_id_fk" FOREIGN KEY ("requirements_id") REFERENCES "public"."job_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "match_assessments" AS PERMISSIVE FOR ALL TO "job_seeker_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));