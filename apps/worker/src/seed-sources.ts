import { closePool } from "@ai-intel/db";
import { logger } from "./logger";
import { seedDefaultSources } from "./services/source-registry";

async function main() {
  await seedDefaultSources();
  logger.info("Seeded default sources");
  await closePool();
}

main().catch(async (error) => {
  logger.error({ error }, "Failed to seed sources");
  await closePool();
  process.exitCode = 1;
});

