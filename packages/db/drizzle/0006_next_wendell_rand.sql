CREATE TYPE "public"."scoring_job_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "scoring_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"profile_id" bigint NOT NULL,
	"status" "scoring_job_status" DEFAULT 'running' NOT NULL,
	"total_documents" integer DEFAULT 0 NOT NULL,
	"scored_documents" integer DEFAULT 0 NOT NULL,
	"failed_documents" integer DEFAULT 0 NOT NULL,
	"current_batch" integer DEFAULT 0 NOT NULL,
	"total_batches" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "scoring_jobs" ADD CONSTRAINT "scoring_jobs_profile_id_user_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;