CREATE TABLE "applicant_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"linkedin_url" text,
	"github_url" text,
	"website_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applicant_details_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "applicant_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "question_match_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"inputs_hash" text NOT NULL,
	"task_version" integer NOT NULL,
	"matches" jsonb NOT NULL,
	"traces" jsonb NOT NULL,
	"model" text,
	"cost_micro_usd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_match_runs_user_inputs_key" UNIQUE("user_id","inputs_hash","task_version")
);
--> statement-breakpoint
ALTER TABLE "question_match_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saved_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"label" text NOT NULL,
	"answer" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_answers_user_question_key" UNIQUE("user_id","question_key")
);
--> statement-breakpoint
ALTER TABLE "saved_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "applicant_details" ADD CONSTRAINT "applicant_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_match_runs" ADD CONSTRAINT "question_match_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_answers" ADD CONSTRAINT "saved_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "applicant_details" AS PERMISSIVE FOR ALL TO "job_seeker_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "question_match_runs" AS PERMISSIVE FOR ALL TO "job_seeker_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "saved_answers" AS PERMISSIVE FOR ALL TO "job_seeker_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));