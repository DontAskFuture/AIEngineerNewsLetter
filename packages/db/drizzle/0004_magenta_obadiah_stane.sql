CREATE TABLE "ranking_cache" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"profile_id" bigint NOT NULL,
	"candidates_hash" text NOT NULL,
	"model" text,
	"ranking_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ranking_cache" ADD CONSTRAINT "ranking_cache_profile_id_user_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ranking_cache_profile_candidates_idx" ON "ranking_cache" USING btree ("profile_id","candidates_hash");