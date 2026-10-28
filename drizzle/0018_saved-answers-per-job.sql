ALTER TABLE "saved_answers" DROP CONSTRAINT "saved_answers_user_question_key";--> statement-breakpoint
ALTER TABLE "saved_answers" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "saved_answers" ADD CONSTRAINT "saved_answers_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_answers" ADD CONSTRAINT "saved_answers_user_question_job_key" UNIQUE NULLS NOT DISTINCT("user_id","question_key","job_id");