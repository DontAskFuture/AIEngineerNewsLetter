CREATE TYPE "public"."endpoint_kind" AS ENUM('rss', 'sitemap', 'html', 'docs', 'pricing');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('company', 'model', 'product', 'repo', 'paper', 'person', 'topic');--> statement-breakpoint
CREATE TYPE "public"."fetch_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_category" AS ENUM('lab_blog', 'engineering_blog', 'research_feed', 'startup_launch', 'docs', 'pricing', 'github');--> statement-breakpoint
CREATE TYPE "public"."storage_provider" AS ENUM('local_fs', 's3');--> statement-breakpoint
CREATE TABLE "document_entities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"entity_id" bigint NOT NULL,
	"evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"source_endpoint_id" bigint NOT NULL,
	"raw_document_id" bigint,
	"canonical_url" text NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"summary" text,
	"body_text" text,
	"source_published_at" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "entity_kind" NOT NULL,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fetch_job_id" bigint NOT NULL,
	"status" "fetch_status" NOT NULL,
	"http_status" integer,
	"content_hash" text,
	"raw_document_id" bigint,
	"response_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "fetch_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_endpoint_id" bigint NOT NULL,
	"boss_job_id" text,
	"status" "fetch_status" DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"source_endpoint_id" bigint NOT NULL,
	"source_url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"content_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"storage_provider" "storage_provider" NOT NULL,
	"storage_key" text NOT NULL,
	"content_length" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_endpoints" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"kind" "endpoint_kind" NOT NULL,
	"url" text NOT NULL,
	"cadence_minutes" integer DEFAULT 60 NOT NULL,
	"parser_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "source_category" NOT NULL,
	"base_url" text NOT NULL,
	"canonical_domain" text NOT NULL,
	"trust_tier" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_entities" ADD CONSTRAINT "document_entities_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_entities" ADD CONSTRAINT "document_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_source_endpoint_id_source_endpoints_id_fk" FOREIGN KEY ("source_endpoint_id") REFERENCES "public"."source_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_raw_document_id_raw_documents_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_attempts" ADD CONSTRAINT "fetch_attempts_fetch_job_id_fetch_jobs_id_fk" FOREIGN KEY ("fetch_job_id") REFERENCES "public"."fetch_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_attempts" ADD CONSTRAINT "fetch_attempts_raw_document_id_raw_documents_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_jobs" ADD CONSTRAINT "fetch_jobs_source_endpoint_id_source_endpoints_id_fk" FOREIGN KEY ("source_endpoint_id") REFERENCES "public"."source_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD CONSTRAINT "raw_documents_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD CONSTRAINT "raw_documents_source_endpoint_id_source_endpoints_id_fk" FOREIGN KEY ("source_endpoint_id") REFERENCES "public"."source_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_endpoints" ADD CONSTRAINT "source_endpoints_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_entities_document_entity_idx" ON "document_entities" USING btree ("document_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_canonical_url_idx" ON "documents" USING btree ("canonical_url");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_slug_idx" ON "entities" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "source_endpoints_source_url_idx" ON "source_endpoints" USING btree ("source_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_slug_idx" ON "sources" USING btree ("slug");