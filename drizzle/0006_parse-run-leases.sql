ALTER TABLE "resume_parses" ADD COLUMN "attempt_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "resume_parses" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
-- Runs left running before leases existed have no live worker: give them an already
-- expired lease so they can be retried or deleted, and so the CHECK below holds.
UPDATE "resume_parses" SET "lease_expires_at" = now() WHERE "status" = 'running';--> statement-breakpoint
ALTER TABLE "resume_parses" ADD CONSTRAINT "resume_parses_lease_check" CHECK (("resume_parses"."status" = 'running') = ("resume_parses"."lease_expires_at" is not null));