CREATE TABLE "rss_feed_clients" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_hash" text NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rss_feed_clients_hash_idx" ON "rss_feed_clients" USING btree ("client_hash");--> statement-breakpoint
CREATE INDEX "rss_feed_clients_last_seen_idx" ON "rss_feed_clients" USING btree ("last_seen_at");