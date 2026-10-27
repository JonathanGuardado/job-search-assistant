CREATE TABLE "answer_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"label" text NOT NULL,
	"method" text NOT NULL,
	"job_id" uuid,
	"status" text NOT NULL,
	"answer" jsonb,
	"basis" jsonb NOT NULL,
	"reason" text,
	"inputs_hash" text NOT NULL,
	"reading_id" uuid,
	"task_version" integer,
	"traces" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_drafts_method_check" CHECK ("answer_drafts"."method" in ('profile', 'experience', 'motivation')),
	CONSTRAINT "answer_drafts_status_check" CHECK ("answer_drafts"."status" in ('drafted', 'no_basis', 'rejected')),
	CONSTRAINT "answer_drafts_answer_check" CHECK (("answer_drafts"."status" = 'drafted') = ("answer_drafts"."answer" is not null)),
	CONSTRAINT "answer_drafts_reason_check" CHECK (("answer_drafts"."status" = 'drafted') = ("answer_drafts"."reason" is null))
);
--> statement-breakpoint
ALTER TABLE "answer_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "question_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_hash" text NOT NULL,
	"task_version" integer NOT NULL,
	"reading" jsonb NOT NULL,
	"traces" jsonb NOT NULL,
	"model" text,
	"cost_micro_usd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_readings_hash_version_key" UNIQUE("question_hash","task_version")
);
--> statement-breakpoint
ALTER TABLE "saved_answers" ADD COLUMN "origin" text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_answers" ADD COLUMN "draft_id" uuid;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD COLUMN "citizenships" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD COLUMN "english_level" text;--> statement-breakpoint
ALTER TABLE "answer_drafts" ADD CONSTRAINT "answer_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_drafts" ADD CONSTRAINT "answer_drafts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_drafts" ADD CONSTRAINT "answer_drafts_reading_id_question_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."question_readings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_drafts_user_question_idx" ON "answer_drafts" USING btree ("user_id","question_key","created_at");--> statement-breakpoint
ALTER TABLE "saved_answers" ADD CONSTRAINT "saved_answers_draft_id_answer_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."answer_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_answers" ADD CONSTRAINT "saved_answers_origin_check" CHECK ("saved_answers"."origin" in ('owner', 'draft'));--> statement-breakpoint
ALTER TABLE "saved_answers" ADD CONSTRAINT "saved_answers_draft_check" CHECK ("saved_answers"."draft_id" is null or "saved_answers"."origin" = 'draft');--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_english_level_check" CHECK ("candidate_profiles"."english_level" is null or "candidate_profiles"."english_level" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "answer_drafts" AS PERMISSIVE FOR ALL TO "job_seeker_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));