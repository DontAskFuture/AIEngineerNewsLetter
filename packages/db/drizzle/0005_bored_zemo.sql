CREATE TABLE "document_scores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"profile_id" bigint NOT NULL,
	"score" integer NOT NULL,
	"why_relevant" text NOT NULL,
	"model" text,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_scores" ADD CONSTRAINT "document_scores_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_scores" ADD CONSTRAINT "document_scores_profile_id_user_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_scores_doc_profile_idx" ON "document_scores" USING btree ("document_id","profile_id");