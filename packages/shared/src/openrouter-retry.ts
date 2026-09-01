/**
 * Retry policy for OpenRouter chat completions.
 *
 * Pure and dependency-light so it can be verified without network or database
 * access, and shared by the web and worker OpenRouter clients.
 */

const FREE_TIER_SUFFIX = ":free";

/** OpenRouter marks zero-cost, rate-limited model variants with a `:free` suffix. */
export function isFreeTierModel(modelId: string): boolean {
  return modelId.trim().endsWith(FREE_TIER_SUFFIX);
}

export type RetryDecision = "retry" | "next-model";

export interface RetryContext {
  /** HTTP status of the failed response. */
  status: number;
  /** Zero-based index of the attempt that just failed. */
  attempt: number;
  maxRetries: number;
  /** Free-tier models are quota-limited, so a 429 means "out of quota", not "slow down". */
  isFreeTier: boolean;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface OpenRouterBodyError {
  message: string;
  /** Provider-reported status, defaulted to 502 so it is treated as retryable. */
  status: number;
}

const UNKNOWN_UPSTREAM_STATUS = 502;

function readErrorMessage(error: Record<string, unknown>): string {
  return typeof error.message === "string" && error.message.trim().length > 0
    ? error.message.trim()
    : "OpenRouter returned an unspecified error";
}

/**
 * OpenRouter surfaces upstream provider failures as HTTP 200 with an `error`
 * object in the body, so `response.ok` is not sufficient to prove success.
 * Returns a normalized error for any payload the caller cannot read a
 * completion out of, or `null` when the payload is usable.
 */
export function extractBodyError(payload: unknown): OpenRouterBodyError | null {
  if (!payload || typeof payload !== "object") {
    return { message: "OpenRouter returned a malformed payload", status: UNKNOWN_UPSTREAM_STATUS };
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;

  if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>;
    const code = errorRecord.code;
    return {
      message: readErrorMessage(errorRecord),
      status: typeof code === "number" && Number.isFinite(code) ? code : UNKNOWN_UPSTREAM_STATUS,
    };
  }

  if (!Array.isArray(record.choices) || record.choices.length === 0) {
    return { message: "OpenRouter returned no choices", status: UNKNOWN_UPSTREAM_STATUS };
  }

  return null;
}

export function decideRetry({ status, attempt, maxRetries, isFreeTier }: RetryContext): RetryDecision {
  // Free-tier models are never retried. A 429 means the quota is gone for the
  // window, and a congested free endpoint is not worth a backoff when another
  // free candidate is queued behind it. Retries are reserved for the paid
  // backstop, which is the candidate actually worth waiting on.
  if (isFreeTier) return "next-model";

  if (isRetryableStatus(status) && attempt < maxRetries) return "retry";

  return "next-model";
}
