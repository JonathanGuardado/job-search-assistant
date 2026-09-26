CREATE TABLE "job_user_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_user_states_user_job_key" UNIQUE("user_id","job_id"),
	CONSTRAINT "job_user_states_state_check" CHECK ("job_user_states"."state" in ('new', 'saved', 'ignored', 'applied'))
);
--> statement-breakpoint
ALTER TABLE "job_user_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"company_normalized" text NOT NULL,
	"title" text NOT NULL,
	"title_normalized" text NOT NULL,
	"description" text NOT NULL,
	"location_policy" text NOT NULL,
	"location_text" text,
	"remote_scope" jsonb,
	"employment_type" text NOT NULL,
	"salary_min_minor" bigint,
	"salary_max_minor" bigint,
	"salary_currency" text,
	"salary_source" text NOT NULL,
	"apply_url" text NOT NULL,
	"fingerprint" text NOT NULL,
	"canonical_job_id" uuid,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "jobs_location_policy_check" CHECK ("jobs"."location_policy" in ('onsite', 'hybrid', 'remote', 'unknown')),
	CONSTRAINT "jobs_employment_type_check" CHECK ("jobs"."employment_type" in ('employee', 'contractor', 'eor', 'unknown')),
	CONSTRAINT "jobs_salary_check" CHECK (("jobs"."salary_source" = 'unknown'
            and "jobs"."salary_min_minor" is null and "jobs"."salary_max_minor" is null and "jobs"."salary_currency" is null)
          or ("jobs"."salary_source" = 'posted'
            and "jobs"."salary_currency" is not null
            and ("jobs"."salary_min_minor" is not null or "jobs"."salary_max_minor" is not null)
            and ("jobs"."salary_min_minor" is null or "jobs"."salary_max_minor" is null
                 or "jobs"."salary_min_minor" <= "jobs"."salary_max_minor")))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "job_user_states" ADD CONSTRAINT "job_user_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_user_states" ADD CONSTRAINT "job_user_states_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_canonical_job_id_jobs_id_fk" FOREIGN KEY ("canonical_job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_fingerprint_idx" ON "jobs" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "jobs_company_normalized_idx" ON "jobs" USING btree ("company_normalized");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "job_user_states" AS PERMISSIVE FOR ALL TO "jobhunt_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));