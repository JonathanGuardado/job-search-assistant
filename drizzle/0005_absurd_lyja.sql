CREATE TABLE "candidate_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"country" text NOT NULL,
	"city" text NOT NULL,
	"timezone" text NOT NULL,
	"work_authorizations" jsonb NOT NULL,
	"willing_to_relocate" boolean NOT NULL,
	"allowed_regions" text[] NOT NULL,
	"employment_types" text[] NOT NULL,
	"salary_floor_minor" integer,
	"salary_currency" text NOT NULL,
	"target_roles" text[] NOT NULL,
	"seniority" text NOT NULL,
	"preferred_tech" text[] NOT NULL,
	"excluded_tech" text[] NOT NULL,
	"excluded_companies" text[] NOT NULL,
	"excluded_industries" text[] NOT NULL,
	"constraint_modes" jsonb NOT NULL,
	CONSTRAINT "candidate_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "candidate_profiles_salary_check" CHECK ("candidate_profiles"."salary_floor_minor" >= 0),
	CONSTRAINT "candidate_profiles_hard_modes_check" CHECK (("candidate_profiles"."constraint_modes"->>'workAuthorizations') is not distinct from 'hard' and ("candidate_profiles"."constraint_modes"->>'willingToRelocate') is not distinct from 'hard')
);
--> statement-breakpoint
ALTER TABLE "candidate_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "candidate_profiles" AS PERMISSIVE FOR ALL TO "job_seeker_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));