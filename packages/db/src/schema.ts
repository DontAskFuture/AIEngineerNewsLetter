import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const sourceCategoryEnum = pgEnum("source_category", [
  "lab_blog",
  "engineering_blog",
  "research_feed",
  "community_feed",
  "social_trends",
  "startup_launch",
  "docs",
  "pricing",
  "github",
]);

export const endpointKindEnum = pgEnum("endpoint_kind", ["rss", "sitemap", "html", "docs", "pricing"]);

export const fetchStatusEnum = pgEnum("fetch_status", ["queued", "running", "succeeded", "failed"]);

export const storageProviderEnum = pgEnum("storage_provider", ["local_fs", "s3"]);

export const entityKindEnum = pgEnum("entity_kind", [
  "company",
  "model",
  "product",
  "repo",
  "paper",
  "person",
  "topic",
]);

export const userProfiles = pgTable(
  "user_profiles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    interestStatement: text("interest_statement").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_profiles_user_slug_idx").on(table.userId, table.slug),
    uniqueIndex("user_profiles_user_display_name_idx").on(
      table.userId,
      sql`lower(btrim(${table.displayName}))`,
    ),
  ],
);

export const authUsers = pgTable(
  "auth_users",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("auth_users_email_idx").on(table.email)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    sessionTokenHash: text("session_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("auth_sessions_token_hash_idx").on(table.sessionTokenHash)],
);

export const authLoginAttempts = pgTable(
  "auth_login_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    email: text("email").notNull(),
    ipAddress: text("ip_address").notNull(),
    succeeded: boolean("succeeded").notNull().default(false),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("auth_login_attempts_lookup_idx").on(table.email, table.ipAddress, table.attemptedAt)],
);

export const documentReads = pgTable(
  "document_reads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    documentId: bigint("document_id", { mode: "number" })
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("document_reads_user_document_idx").on(table.userId, table.documentId)],
);

export const sources = pgTable(
  "sources",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: sourceCategoryEnum("category").notNull(),
    baseUrl: text("base_url").notNull(),
    canonicalDomain: text("canonical_domain").notNull(),
    trustTier: integer("trust_tier").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sources_slug_idx").on(table.slug)],
);

export const sourceEndpoints = pgTable(
  "source_endpoints",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sourceId: bigint("source_id", { mode: "number" })
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    kind: endpointKindEnum("kind").notNull(),
    url: text("url").notNull(),
    cadenceMinutes: integer("cadence_minutes").notNull().default(60),
    parserKey: text("parser_key"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("source_endpoints_source_url_idx").on(table.sourceId, table.url)],
);

export const fetchJobs = pgTable("fetch_jobs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sourceEndpointId: bigint("source_endpoint_id", { mode: "number" })
    .notNull()
    .references(() => sourceEndpoints.id, { onDelete: "cascade" }),
  bossJobId: text("boss_job_id"),
  status: fetchStatusEnum("status").notNull().default("queued"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  attemptCount: integer("attempt_count").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rawDocuments = pgTable("raw_documents", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sourceId: bigint("source_id", { mode: "number" })
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  sourceEndpointId: bigint("source_endpoint_id", { mode: "number" })
    .notNull()
    .references(() => sourceEndpoints.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  contentHash: text("content_hash").notNull(),
  mimeType: text("mime_type").notNull(),
  storageProvider: storageProviderEnum("storage_provider").notNull(),
  storageKey: text("storage_key").notNull(),
  contentLength: integer("content_length").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
});

export const fetchAttempts = pgTable("fetch_attempts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  fetchJobId: bigint("fetch_job_id", { mode: "number" })
    .notNull()
    .references(() => fetchJobs.id, { onDelete: "cascade" }),
  status: fetchStatusEnum("status").notNull(),
  httpStatus: integer("http_status"),
  contentHash: text("content_hash"),
  rawDocumentId: bigint("raw_document_id", { mode: "number" }).references(() => rawDocuments.id, {
    onDelete: "set null",
  }),
  responseHeaders: jsonb("response_headers").notNull().default(sql`'{}'::jsonb`),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  errorMessage: text("error_message"),
});

export const documents = pgTable(
  "documents",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sourceId: bigint("source_id", { mode: "number" })
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    sourceEndpointId: bigint("source_endpoint_id", { mode: "number" })
      .notNull()
      .references(() => sourceEndpoints.id, { onDelete: "cascade" }),
    rawDocumentId: bigint("raw_document_id", { mode: "number" }).references(() => rawDocuments.id, {
      onDelete: "set null",
    }),
    canonicalUrl: text("canonical_url").notNull(),
    externalId: text("external_id"),
    title: text("title").notNull(),
    summary: text("summary"),
    bodyText: text("body_text"),
    sourcePublishedAt: timestamp("source_published_at", { withTimezone: true }),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    contentHash: text("content_hash").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("documents_canonical_url_idx").on(table.canonicalUrl)],
);

export const entities = pgTable(
  "entities",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: entityKindEnum("kind").notNull(),
    description: text("description"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("entities_slug_idx").on(table.slug)],
);

export const documentEntities = pgTable(
  "document_entities",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: bigint("document_id", { mode: "number" })
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    entityId: bigint("entity_id", { mode: "number" })
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    evidence: text("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("document_entities_document_entity_idx").on(table.documentId, table.entityId)],
);

export const documentScores = pgTable(
  "document_scores",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: bigint("document_id", { mode: "number" })
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    profileId: bigint("profile_id", { mode: "number" })
      .notNull()
      .references(() => userProfiles.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    whyRelevant: text("why_relevant").notNull(),
    model: text("model"),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("document_scores_doc_profile_idx").on(table.documentId, table.profileId),
  ],
);

export const scoringJobStatusEnum = pgEnum("scoring_job_status", ["running", "completed", "failed"]);

export const scoringJobs = pgTable("scoring_jobs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  profileId: bigint("profile_id", { mode: "number" })
    .notNull()
    .references(() => userProfiles.id, { onDelete: "cascade" }),
  status: scoringJobStatusEnum("status").notNull().default("running"),
  totalDocuments: integer("total_documents").notNull().default(0),
  scoredDocuments: integer("scored_documents").notNull().default(0),
  failedDocuments: integer("failed_documents").notNull().default(0),
  currentBatch: integer("current_batch").notNull().default(0),
  totalBatches: integer("total_batches").notNull().default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const newsletterSends = pgTable(
  "newsletter_sends",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    profileId: bigint("profile_id", { mode: "number" })
      .notNull()
      .references(() => userProfiles.id, { onDelete: "cascade" }),
    newsletterDate: text("newsletter_date").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    storyCount: integer("story_count").notNull().default(0),
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("newsletter_sends_user_date_idx").on(table.userId, table.newsletterDate)],
);

export const rankingCache = pgTable(
  "ranking_cache",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    profileId: bigint("profile_id", { mode: "number" })
      .notNull()
      .references(() => userProfiles.id, { onDelete: "cascade" }),
    candidatesHash: text("candidates_hash").notNull(),
    model: text("model"),
    rankingJson: jsonb("ranking_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("ranking_cache_profile_candidates_idx").on(table.profileId, table.candidatesHash),
  ],
);
