import pino from "pino";
import { loadWorkerEnv } from "./env";

const env = loadWorkerEnv();

const loggerConfig =
  process.env.NODE_ENV === "development"
    ? {
        level: env.LOG_LEVEL,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
          },
        },
      }
    : {
        level: env.LOG_LEVEL,
      };

export const logger = pino(loggerConfig);
