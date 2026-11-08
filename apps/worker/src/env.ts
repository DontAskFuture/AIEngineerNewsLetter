import { config } from "dotenv";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const currentDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(currentDir, "../../../.env") });

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);
const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().email().optional(),
);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  RAW_STORAGE_DIR: z.string().default(resolve(currentDir, "../../../var/raw")),
  FETCH_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  FETCH_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  CRAWLED_DOCUMENT_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(365),
  CRAWLED_DOCUMENT_CLEANUP_INTERVAL_MINUTES: z.coerce.number().int().positive().default(24 * 60),
  CRAWLED_DOCUMENT_CLEANUP_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  SCORING_MAX_DOCUMENTS_PER_RUN: z.coerce.number().int().min(1).max(100).default(20),
  SCORING_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  NEWSLETTER_CHECK_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  NEWSLETTER_SEND_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("~deepseek/deepseek-flash-latest"),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  APP_TIME_ZONE: z.string().default("America/Los_Angeles"),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM_EMAIL: optionalEmail,
  SMTP_FROM_NAME: z.string().default("AI Builder Intelligence"),
});

let cachedEnv: z.infer<typeof envSchema> | undefined;

export function loadWorkerEnv() {
  if (!cachedEnv) {
    const parsedEnv = envSchema.parse(process.env);

    cachedEnv = {
      ...parsedEnv,
      RAW_STORAGE_DIR: isAbsolute(parsedEnv.RAW_STORAGE_DIR)
        ? parsedEnv.RAW_STORAGE_DIR
        : resolve(currentDir, "../../../", parsedEnv.RAW_STORAGE_DIR),
    };
  }

  return cachedEnv;
}
