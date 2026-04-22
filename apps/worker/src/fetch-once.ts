import { closePool } from "@ai-intel/db";
import { logger } from "./logger";
import { fetchSourceEndpoint } from "./jobs/fetch-source-endpoint";
import { listActiveSourceEndpoints, seedDefaultSources } from "./services/source-registry";

async function main() {
  await seedDefaultSources();
  const endpoints = await listActiveSourceEndpoints();

  for (const endpoint of endpoints) {
    logger.info({ endpointId: endpoint.id, url: endpoint.endpointUrl }, "Fetching endpoint");
    await fetchSourceEndpoint({ endpointId: endpoint.id });
  }

  await closePool();
}

main().catch(async (error) => {
  logger.error({ error }, "One-shot fetch run failed");
  await closePool();
  process.exitCode = 1;
});

