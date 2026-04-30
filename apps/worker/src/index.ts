import { PgBoss, type Job } from "pg-boss";
import { closePool, getDb, schema } from "@ai-intel/db";
import { and, asc, eq, sql } from "drizzle-orm";
import type { FetchSourceEndpointPayload, ScoreDocumentsPayload, SendDailyNewsletterPayload } from "@ai-intel/shared";
import { logger } from "./logger";
import { loadWorkerEnv } from "./env";
import { sendDailyNewsletter } from "./jobs/send-daily-newsletter";
import { fetchSourceEndpoint } from "./jobs/fetch-source-endpoint";
import { scoreDocuments } from "./jobs/score-documents";
import { listActiveSourceEndpoints, seedDefaultSources } from "./services/source-registry";

const fetchQueueName = "fetch-source-endpoint";
const scoreQueueName = "score-documents";
const newsletterQueueName = "send-daily-newsletter";

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
  return Boolean(env.SENDPULSE_CLIENT_ID && env.SENDPULSE_CLIENT_SECRET && env.SENDPULSE_FROM_EMAIL);
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

async function enqueueScoringForActiveProfiles(boss: PgBoss, reason: string) {
  const db = getDb();
  const profiles = await db
    .select({ id: schema.userProfiles.id })
    .from(schema.userProfiles)
    .where(and(eq(schema.userProfiles.isActive, true), sql`length(btrim(${schema.userProfiles.interestStatement})) > 0`))
    .orderBy(asc(schema.userProfiles.id));

  let enqueuedCount = 0;

  for (const profile of profiles) {
    const jobId = await boss.send(
      scoreQueueName,
      { profileId: profile.id },
      {
        singletonKey: `score-profile:${profile.id}`,
        singletonSeconds: 10 * 60,
      },
    );

    if (jobId) {
      enqueuedCount += 1;
    }
  }

  logger.info({ enqueuedCount, profileCount: profiles.length, reason }, "Enqueued scoring for active profiles");
}

async function runFetchJob(job: Job<FetchSourceEndpointPayload>, boss: PgBoss) {
  const result = await fetchSourceEndpoint(job.data, job.id);

  if (result.extractedCount <= 0) {
    return;
  }

  try {
    await enqueueScoringForActiveProfiles(boss, `crawl:${job.data.endpointId}`);
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
    logger.info("Daily newsletter is disabled because SendPulse env vars are not configured");
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

  await enqueueDueFetches(boss);
  await enqueueDueNewsletter(boss, env);

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

  const shutdown = async () => {
    clearInterval(interval);
    clearInterval(newsletterInterval);
    await boss.stop();
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info(
    {
      queues: [fetchQueueName, scoreQueueName, newsletterQueueName],
      fetchIntervalMinutes: env.FETCH_INTERVAL_MINUTES,
      fetchWorkerConcurrency: env.FETCH_WORKER_CONCURRENCY,
      newsletterCheckIntervalMinutes: env.NEWSLETTER_CHECK_INTERVAL_MINUTES,
      newsletterSendHour: env.NEWSLETTER_SEND_HOUR,
      newsletterTimeZone: env.APP_TIME_ZONE,
      newsletterEnabled: hasNewsletterConfig(env),
    },
    "Worker is running",
  );
}

main().catch(async (error) => {
  logger.error({ error }, "Worker failed to start");
  await closePool();
  process.exitCode = 1;
});
