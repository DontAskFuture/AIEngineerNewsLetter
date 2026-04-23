import { PgBoss, type Job } from "pg-boss";
import { closePool } from "@ai-intel/db";
import type { FetchSourceEndpointPayload, ScoreDocumentsPayload } from "@ai-intel/shared";
import { logger } from "./logger";
import { loadWorkerEnv } from "./env";
import { fetchSourceEndpoint } from "./jobs/fetch-source-endpoint";
import { scoreDocuments } from "./jobs/score-documents";
import { listActiveSourceEndpoints, seedDefaultSources } from "./services/source-registry";

const fetchQueueName = "fetch-source-endpoint";
const scoreQueueName = "score-documents";

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
  await seedDefaultSources();

  await boss.work<FetchSourceEndpointPayload>(fetchQueueName, async (jobs: Job<FetchSourceEndpointPayload>[]) => {
    await Promise.all(jobs.map((job) => fetchSourceEndpoint(job.data, job.id)));
  });

  await boss.work<ScoreDocumentsPayload>(
    scoreQueueName,
    async (jobs: Job<ScoreDocumentsPayload>[]) => {
      for (const job of jobs) {
        await scoreDocuments(job.data);
      }
    },
  );

  await enqueueDueFetches(boss);

  const interval = setInterval(() => {
    enqueueDueFetches(boss).catch((error) => {
      logger.error({ error }, "Failed to enqueue due fetches");
    });
  }, env.FETCH_INTERVAL_MINUTES * 60 * 1000);

  const shutdown = async () => {
    clearInterval(interval);
    await boss.stop();
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info(
    {
      queues: [fetchQueueName, scoreQueueName],
      fetchIntervalMinutes: env.FETCH_INTERVAL_MINUTES,
    },
    "Worker is running",
  );
}

main().catch(async (error) => {
  logger.error({ error }, "Worker failed to start");
  await closePool();
  process.exitCode = 1;
});
