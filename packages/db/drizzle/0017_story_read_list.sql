DROP TABLE IF EXISTS "user_source_read_list";--> statement-breakpoint
CREATE TABLE "user_document_read_list" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"document_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_document_read_list" ADD CONSTRAINT "user_document_read_list_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_document_read_list" ADD CONSTRAINT "user_document_read_list_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_document_read_list_user_document_idx" ON "user_document_read_list" USING btree ("user_id","document_id");--> statement-breakpoint
CREATE INDEX "user_document_read_list_user_idx" ON "user_document_read_list" USING btree ("user_id");
