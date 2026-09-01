import { isFreeTierModel } from "./openrouter-retry";

/**
 * Discovery of additional zero-cost OpenRouter models.
 *
 * The verified pool in `scoring-config.ts` is probed by hand and stays stable;
 * discovery exists so the pool does not silently rot as free models are added
 * and retired upstream. Discovered models are unproven against the scoring JSON
 * contract, so they are always tried *after* the verified pool and always ahead
 * of the paid backstop — a bad one costs a fall-through, never a wrong answer
 * that reaches the database, because unparseable output is discarded by the
 * caller's existing validation.
 */

/** A 20-document batch is a few thousand tokens; this is a generous floor. */
export const DISCOVERY_MIN_CONTEXT = 32_768;

/** Keeps worst-case fall-through latency bounded when the whole pool is cold. */
export const DISCOVERY_DEFAULT_LIMIT = 6;

export interface DiscoveryOptions {
  /** Models already in the verified pool, so discovery does not duplicate them. */
  exclude?: readonly string[];
  /** Models known to be unusable regardless of what the API advertises. */
  deny?: readonly string[];
  limit?: number;
}

interface CandidateModel {
  id: string;
  contextLength: number;
}

function readCandidate(entry: unknown): CandidateModel | null {
  if (!entry || typeof entry !== "object") return null;

  const record = entry as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "string" || id.length === 0) return null;
  if (!isFreeTierModel(id)) return null;

  const contextLength = typeof record.context_length === "number" ? record.context_length : 0;
  if (contextLength < DISCOVERY_MIN_CONTEXT) return null;

  // The scoring prompt depends on the model honoring a JSON response contract.
  const supported = Array.isArray(record.supported_parameters) ? record.supported_parameters : [];
  if (!supported.includes("response_format")) return null;

  return { id, contextLength };
}

export function selectDiscoverableFreeModels(
  payload: unknown,
  { exclude = [], deny = [], limit = DISCOVERY_DEFAULT_LIMIT }: DiscoveryOptions = {},
): string[] {
  if (!Array.isArray(payload)) return [];

  const skip = new Set([...exclude, ...deny]);

  return payload
    .map(readCandidate)
    .filter((candidate): candidate is CandidateModel => candidate !== null && !skip.has(candidate.id))
    .sort((a, b) => b.contextLength - a.contextLength)
    .slice(0, Math.max(0, limit))
    .map((candidate) => candidate.id);
}
