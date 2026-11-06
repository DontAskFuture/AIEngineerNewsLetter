import pino from "pino";
import { loadWorkerEnv } from "./env";

const env = loadWorkerEnv();

const sharedSerializers = {
  err: pino.stdSerializers.err,
  error: pino.stdSerializers.err,
};

const loggerConfig =
  process.env.NODE_ENV === "development"
    ? {
        level: env.LOG_LEVEL,
        serializers: sharedSerializers,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
          },
        },
      }
    : {
        level: env.LOG_LEVEL,
        serializers: sharedSerializers,
      };

export const logger = pino(loggerConfig);
