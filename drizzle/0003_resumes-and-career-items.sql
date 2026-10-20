CREATE TABLE "career_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"organization" text,
	"title" text,
	"started_on" text,
	"ended_on" text,
	"is_current" boolean DEFAULT false NOT NULL,
	"summary" text,
	"achievements" text[] DEFAULT '{}'::text[] NOT NULL,
	"technologies" text[] DEFAULT '{}'::text[] NOT NULL,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"source_resume_id" uuid,
	"source_parse_id" uuid,
	"verified_by_user" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "career_items_type_check" CHECK ("career_items"."type" in ('role', 'project', 'education', 'achievement', 'story')),
	CONSTRAINT "career_items_started_on_check" CHECK ("career_items"."started_on" ~ '^\d{4}(-(0[1-9]|1[0-2]))?$'),
	CONSTRAINT "career_items_ended_on_check" CHECK ("career_items"."ended_on" ~ '^\d{4}(-(0[1-9]|1[0-2]))?$'),
	CONSTRAINT "career_items_current_check" CHECK (not "career_items"."is_current" or "career_items"."ended_on" is null),
	CONSTRAINT "career_items_verified_check" CHECK ("career_items"."verified_by_user" = ("career_items"."verified_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "career_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resume_parses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resume_id" uuid NOT NULL,
	"task" text NOT NULL,
	"task_version" integer NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"traces" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "resume_parses_resume_task_key" UNIQUE("resume_id","task","task_version"),
	CONSTRAINT "resume_parses_status_check" CHECK ("resume_parses"."status" in ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "resume_parses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"parent_id" uuid,
	"is_master" boolean NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"content_sha256" text NOT NULL,
	"extracted_text" text NOT NULL,
	"text_extractor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resumes_user_version_key" UNIQUE("user_id","version"),
	CONSTRAINT "resumes_content_type_check" CHECK ("resumes"."content_type" in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
	CONSTRAINT "resumes_byte_size_check" CHECK ("resumes"."byte_size" > 0 and "resumes"."byte_size" <= 5242880),
	CONSTRAINT "resumes_master_check" CHECK ("resumes"."is_master" = ("resumes"."parent_id" is null))
);
--> statement-breakpoint
ALTER TABLE "resumes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "career_items" ADD CONSTRAINT "career_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_items" ADD CONSTRAINT "career_items_source_resume_id_resumes_id_fk" FOREIGN KEY ("source_resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_items" ADD CONSTRAINT "career_items_source_parse_id_resume_parses_id_fk" FOREIGN KEY ("source_parse_id") REFERENCES "public"."resume_parses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_parses" ADD CONSTRAINT "resume_parses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_parses" ADD CONSTRAINT "resume_parses_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_parent_id_resumes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."resumes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "career_items_user_resume_idx" ON "career_items" USING btree ("user_id","source_resume_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "career_items" AS PERMISSIVE FOR ALL TO "job_seeker_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "resume_parses" AS PERMISSIVE FOR ALL TO "job_seeker_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "resumes" AS PERMISSIVE FOR ALL TO "job_seeker_app" USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));