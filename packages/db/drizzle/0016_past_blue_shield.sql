CREATE TABLE "user_source_read_list" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"source_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_source_read_list" ADD CONSTRAINT "user_source_read_list_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_source_read_list" ADD CONSTRAINT "user_source_read_list_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_source_read_list_user_source_idx" ON "user_source_read_list" USING btree ("user_id","source_id");--> statement-breakpoint
CREATE INDEX "user_source_read_list_user_idx" ON "user_source_read_list" USING btree ("user_id");