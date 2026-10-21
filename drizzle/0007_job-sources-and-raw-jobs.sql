CREATE TABLE "job_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adapter_key" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cursor" text,
	"last_polled_at" timestamp with time zone,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"health_message" text,
	"health_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_sources_adapter_key_check" CHECK ("job_sources"."adapter_key" in ('greenhouse', 'lever')),
	CONSTRAINT "job_sources_health_status_check" CHECK ("job_sources"."health_status" in ('unknown', 'ok', 'failing'))
);
--> statement-breakpoint
CREATE TABLE "raw_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "raw_jobs_source_external_hash_key" UNIQUE("source_id","external_id","content_hash")
);
--> statement-breakpoint
ALTER TABLE "raw_jobs" ADD CONSTRAINT "raw_jobs_source_id_job_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."job_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_sources_adapter_token_key" ON "job_sources" USING btree ("adapter_key",("config"->>'token'));