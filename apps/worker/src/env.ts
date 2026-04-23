import { config } from "dotenv";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const currentDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(currentDir, "../../../.env") });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  RAW_STORAGE_DIR: z.string().default(resolve(currentDir, "../../../var/raw")),
  FETCH_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("nvidia/nemotron-3-super-120b-a12b:free"),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
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
