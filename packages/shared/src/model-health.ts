import { isFreeTierModel } from "./openrouter-retry";

/**
 * In-process circuit breaker for OpenRouter model candidates.
 *
 * Free endpoints fail in ways that persist: an exhausted quota stays exhausted
 * for the rest of its window, and a model the account cannot access never
 * becomes accessible. Re-probing those on every batch burns latency for a known
 * outcome, so a failed candidate is parked for a cooldown scaled to how durable
 * its failure kind is.
 *
 * State is per-process and deliberately forgotten on restart.
 */

export type FailureKind = "quota" | "forbidden" | "invalid" | "transient";

export const COOLDOWN_MS = {
  /** Upstream congestion, timeouts, provider 5xx — usually recovers quickly. */
  transient: 60_000,
  /** Ceiling for repeated transient failures, so nothing is parked forever. */
  maxTransient: 15 * 60_000,
  /** Free quota windows are measured in minutes, not seconds. */
  quota: 15 * 60_000,
  /** The account is not entitled to this model; only an account change fixes it. */
  forbidden: 6 * 60 * 60_000,
  /** A model id OpenRouter rejects outright — retired or misspelled. */
  invalid: 24 * 60 * 60_000,
} as const;

export function classifyFailure(status: number): FailureKind {
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 400 || status === 404) return "invalid";
  return "transient";
}

interface HealthEntry {
  kind: FailureKind;
  parkedUntil: number;
  consecutiveFailures: number;
}

export interface HealthSnapshotEntry {
  model: string;
  kind: FailureKind;
  parkedForMs: number;
}

function cooldownFor(kind: FailureKind, consecutiveFailures: number): number {
  if (kind !== "transient") return COOLDOWN_MS[kind];

  // Exponential backoff across consecutive transient failures, capped.
  const scaled = COOLDOWN_MS.transient * 2 ** Math.max(0, consecutiveFailures - 1);
  return Math.min(scaled, COOLDOWN_MS.maxTransient);
}

export class ModelHealthTracker {
  readonly #entries = new Map<string, HealthEntry>();

  recordSuccess(model: string, _now: number = Date.now()): void {
    this.#entries.delete(model);
  }

  recordFailure(model: string, status: number, now: number = Date.now()): void {
    const kind = classifyFailure(status);
    const previous = this.#entries.get(model);
    const consecutiveFailures = previous && previous.kind === kind ? previous.consecutiveFailures + 1 : 1;

    this.#entries.set(model, {
      kind,
      consecutiveFailures,
      parkedUntil: now + cooldownFor(kind, consecutiveFailures),
    });
  }

  parkedUntil(model: string): number | null {
    return this.#entries.get(model)?.parkedUntil ?? null;
  }

  isParked(model: string, now: number = Date.now()): boolean {
    const entry = this.#entries.get(model);
    if (!entry) return false;

    if (entry.parkedUntil <= now) {
      this.#entries.delete(model);
      return false;
    }

    return true;
  }

  /**
   * Drops parked free candidates while preserving the caller's order. Paid
   * candidates are never dropped — they are the only guaranteed path to a
   * result — and an all-parked list falls back to the full list rather than
   * leaving the caller with nothing to try.
   */
  selectAvailable(models: readonly string[], now: number = Date.now()): string[] {
    const available = models.filter((model) => !isFreeTierModel(model) || !this.isParked(model, now));
    return available.length > 0 ? available : [...models];
  }

  snapshot(now: number = Date.now()): HealthSnapshotEntry[] {
    return [...this.#entries.entries()]
      .filter(([, entry]) => entry.parkedUntil > now)
      .map(([model, entry]) => ({
        model,
        kind: entry.kind,
        parkedForMs: entry.parkedUntil - now,
      }));
  }
}
