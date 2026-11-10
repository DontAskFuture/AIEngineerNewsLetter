import { createHash } from "node:crypto";
import { PgBoss, type Job } from "pg-boss";
import { closePool, getDb, schema } from "@ai-intel/db";
import { and, asc, eq, sql } from "drizzle-orm";
import type {
  FetchSourceEndpointPayload,
  ScoreDocumentsPayload,
  SendDailyAdminReportPayload,
  SendDailyNewsletterPayload,
} from "@ai-intel/shared";
import { logger } from "./logger";
import { loadWorkerEnv } from "./env";
import { sendDailyAdminReport } from "./jobs/send-daily-admin-report";
import { sendDailyNewsletter } from "./jobs/send-daily-newsletter";
import { fetchSourceEndpoint } from "./jobs/fetch-source-endpoint";
import { scoreDocuments } from "./jobs/score-documents";
import { cleanupCrawledDocuments } from "./jobs/cleanup-crawled-documents";
import { listActiveSourceEndpoints, seedDefaultSources } from "./services/source-registry";

const fetchQueueName = "fetch-source-endpoint";
const scoreQueueName = "score-documents";
const newsletterQueueName = "send-daily-newsletter";
const adminReportQueueName = "send-daily-admin-report";
let crawledDocumentCleanupInFlight = false;

function getLocalDateHour(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
  };
}

function hasNewsletterConfig(env: ReturnType<typeof loadWorkerEnv>) {
  return Boolean(env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM_EMAIL);
}

async function enqueueDueFetches(boss: PgBoss) {
  const endpoints = await listActiveSourceEndpoints();

  for (const endpoint of endpoints) {
    await boss.send(
      fetchQueueName,
      { endpointId: endpoint.id },
      {
        singletonKey: `endpoint:${endpoint.id}`,
        singletonSeconds: endpoint.cadenceMinutes * 60,
      },
    );
  }
}

async function enqueueScoringForActiveProfiles(boss: PgBoss, reason: string, documentIds: number[] = []) {
  const db = getDb();
  const uniqueDocumentIds = Array.from(new Set(documentIds)).sort((a, b) => a - b);
  const profiles = await db
    .select({ id: schema.userProfiles.id })
    .from(schema.userProfiles)
    .where(and(eq(schema.userProfiles.isActive, true), sql`length(btrim(${schema.userProfiles.interestStatement})) > 0`))
    .orderBy(asc(schema.userProfiles.id));

  let enqueuedCount = 0;

  for (const profile of profiles) {
    const targetedJobSuffix = uniqueDocumentIds.length > 0
      ? `:${createHash("sha256").update(uniqueDocumentIds.join(",")).digest("hex").slice(0, 16)}`
      : "";
    const jobId = await boss.send(
      scoreQueueName,
      {
        profileId: profile.id,
        ...(uniqueDocumentIds.length > 0 ? { documentIds: uniqueDocumentIds } : {}),
      },
      {
        singletonKey: `score-profile:${profile.id}${targetedJobSuffix}`,
        singletonSeconds: 10 * 60,
      },
    );

    if (jobId) {
      enqueuedCount += 1;
    }
  }

  logger.info(
    { enqueuedCount, profileCount: profiles.length, reason, documentCount: uniqueDocumentIds.length },
    "Enqueued scoring for active profiles",
  );
}

async function runFetchJob(job: Job<FetchSourceEndpointPayload>, boss: PgBoss) {
  const result = await fetchSourceEndpoint(job.data, job.id);

  if (result.extractedCount <= 0) {
    return;
  }

  try {
    await enqueueScoringForActiveProfiles(boss, `crawl:${job.data.endpointId}`, result.documentIds);
  } catch (error) {
    logger.error(
      {
        endpointId: job.data.endpointId,
        extractedCount: result.extractedCount,
        error,
      },
      "Failed to enqueue scoring after crawl",
    );
  }
}

async function enqueueDueNewsletter(boss: PgBoss, env: ReturnType<typeof loadWorkerEnv>) {
  if (!hasNewsletterConfig(env)) {
    logger.info("Daily newsletter is disabled because SMTP env vars are not configured");
    return;
  }

  const { date, hour } = getLocalDateHour(env.APP_TIME_ZONE);

  if (hour < env.NEWSLETTER_SEND_HOUR) {
    return;
  }

  await boss.send(
    newsletterQueueName,
    { newsletterDate: date },
    {
      singletonKey: `daily-newsletter:${date}`,
      singletonSeconds: 36 * 60 * 60,
    },
  );
  await boss.send(
    adminReportQueueName,
    { reportDate: date },
    {
      singletonKey: `daily-admin-report:${date}`,
      singletonSeconds: 36 * 60 * 60,
    },
  );
}

async function runCrawledDocumentCleanup() {
  if (crawledDocumentCleanupInFlight) {
    logger.info("Skipped crawled document cleanup because a prior run is still active");
    return;
  }

  crawledDocumentCleanupInFlight = true;

  try {
    await cleanupCrawledDocuments();
  } catch (error) {
    logger.error({ error }, "Failed to clean up expired crawled documents");
  } finally {
    crawledDocumentCleanupInFlight = false;
  }
}

async function main() {
  const env = loadWorkerEnv();
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
  });

  boss.on("error", (error: Error) => {
    logger.error({ error }, "pg-boss emitted an error");
  });

  await boss.start();
  await boss.createQueue(fetchQueueName);
  await boss.createQueue(scoreQueueName);
  await boss.createQueue(newsletterQueueName);
  await boss.createQueue(adminReportQueueName);
  await seedDefaultSources();

  await boss.work<FetchSourceEndpointPayload>(
    fetchQueueName,
    { localConcurrency: env.FETCH_WORKER_CONCURRENCY },
    async (jobs: Job<FetchSourceEndpointPayload>[]) => {
      await Promise.all(jobs.map((job) => runFetchJob(job, boss)));
    },
  );

  await boss.work<ScoreDocumentsPayload>(
    scoreQueueName,
    async (jobs: Job<ScoreDocumentsPayload>[]) => {
      for (const job of jobs) {
        await scoreDocuments(job.data);
      }
    },
  );

  await boss.work<SendDailyNewsletterPayload>(
    newsletterQueueName,
    async (jobs: Job<SendDailyNewsletterPayload>[]) => {
      for (const job of jobs) {
        await sendDailyNewsletter(job.data);
      }
    },
  );

  await boss.work<SendDailyAdminReportPayload>(
    adminReportQueueName,
    async (jobs: Job<SendDailyAdminReportPayload>[]) => {
      for (const job of jobs) {
        await sendDailyAdminReport(job.data);
      }
    },
  );

  await enqueueDueFetches(boss);
  await enqueueScoringForActiveProfiles(boss, "startup");
  await enqueueDueNewsletter(boss, env);
  await runCrawledDocumentCleanup();

  const interval = setInterval(() => {
    enqueueDueFetches(boss).catch((error) => {
      logger.error({ error }, "Failed to enqueue due fetches");
    });
  }, env.FETCH_INTERVAL_MINUTES * 60 * 1000);
  const newsletterInterval = setInterval(() => {
    enqueueDueNewsletter(boss, env).catch((error) => {
      logger.error({ error }, "Failed to enqueue due newsletter");
    });
  }, env.NEWSLETTER_CHECK_INTERVAL_MINUTES * 60 * 1000);
  const crawledDocumentCleanupInterval = setInterval(() => {
    runCrawledDocumentCleanup();
  }, env.CRAWLED_DOCUMENT_CLEANUP_INTERVAL_MINUTES * 60 * 1000);

  const shutdown = async () => {
    clearInterval(interval);
    clearInterval(newsletterInterval);
    clearInterval(crawledDocumentCleanupInterval);
    await boss.stop();
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info(
    {
      queues: [fetchQueueName, scoreQueueName, newsletterQueueName, adminReportQueueName],
      fetchIntervalMinutes: env.FETCH_INTERVAL_MINUTES,
      fetchWorkerConcurrency: env.FETCH_WORKER_CONCURRENCY,
      newsletterCheckIntervalMinutes: env.NEWSLETTER_CHECK_INTERVAL_MINUTES,
      newsletterSendHour: env.NEWSLETTER_SEND_HOUR,
      newsletterTimeZone: env.APP_TIME_ZONE,
      newsletterEnabled: hasNewsletterConfig(env),
      crawledDocumentTtlDays: env.CRAWLED_DOCUMENT_TTL_DAYS,
      crawledDocumentCleanupIntervalMinutes: env.CRAWLED_DOCUMENT_CLEANUP_INTERVAL_MINUTES,
      crawledDocumentCleanupBatchSize: env.CRAWLED_DOCUMENT_CLEANUP_BATCH_SIZE,
      scoringMaxDocumentsPerRun: env.SCORING_MAX_DOCUMENTS_PER_RUN,
      scoringLookbackDays: env.SCORING_LOOKBACK_DAYS,
    },
    "Worker is running",
  );
}

main().catch(async (error) => {
  logger.error({ error }, "Worker failed to start");
  await closePool();
  process.exitCode = 1;
});
