import { ModelHealthTracker, type HealthSnapshotEntry } from "./model-health";
import { DISCOVERY_DEFAULT_LIMIT, selectDiscoverableFreeModels } from "./model-discovery";
import { isFreeTierModel } from "./openrouter-retry";
import { scoringConfig } from "./scoring-config";

/**
 * Assembles the ordered scoring candidate list from three layers:
 *
 *   1. the hand-probed verified free pool (`scoring-config.ts`),
 *   2. free models discovered from OpenRouter's models API, and
 *   3. the paid backstop, always last and never parked.
 *
 * Health state from `ModelHealthTracker` filters layers 1 and 2, so a model
 * that just exhausted its quota is skipped outright on the next batch instead
 * of costing a round trip every time.
 */

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_DISCOVERY_TTL_MS = 60 * 60_000;
const DISCOVERY_TIMEOUT_MS = 10_000;

export interface ScoringModelPoolOptions {
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
  discoveryTtlMs?: number;
  discoveryLimit?: number;
  onWarn?: (message: string) => void;
}

export class ScoringModelPool {
  readonly #health = new ModelHealthTracker();
  readonly #fetchImpl: typeof fetch;
  readonly #apiKey: string | null;
  readonly #discoveryTtlMs: number;
  readonly #discoveryLimit: number;
  readonly #onWarn: (message: string) => void;

  #discovered: readonly string[] = [];
  #lastDiscoveryAt: number | null = null;
  #inFlight: Promise<void> | null = null;

  constructor({
    fetchImpl = fetch,
    apiKey = null,
    discoveryTtlMs = DEFAULT_DISCOVERY_TTL_MS,
    discoveryLimit = DISCOVERY_DEFAULT_LIMIT,
    onWarn = () => {},
  }: ScoringModelPoolOptions = {}) {
    this.#fetchImpl = fetchImpl;
    this.#apiKey = apiKey;
    this.#discoveryTtlMs = discoveryTtlMs;
    this.#discoveryLimit = discoveryLimit;
    this.#onWarn = onWarn;
  }

  /** Verified free models, then discovered free models, then the paid backstop. */
  #ordered(fallbackModel?: string | null): string[] {
    const verified = [...scoringConfig.scoringModelCandidates];
    const backstop = verified.filter((model) => !isFreeTierModel(model));
    const verifiedFree = verified.filter((model) => isFreeTierModel(model));
    const extraFallback =
      fallbackModel && fallbackModel.trim().length > 0 ? [fallbackModel.trim()] : [];

    return [...new Set([...verifiedFree, ...this.#discovered, ...backstop, ...extraFallback])];
  }

  candidates(now: number = Date.now(), fallbackModel?: string | null): string[] {
    return this.#health.selectAvailable(this.#ordered(fallbackModel), now);
  }

  recordSuccess(model: string, now: number = Date.now()): void {
    this.#health.recordSuccess(model, now);
  }

  recordFailure(model: string, status: number, now: number = Date.now()): void {
    this.#health.recordFailure(model, status, now);
  }

  health(now: number = Date.now()): HealthSnapshotEntry[] {
    return this.#health.snapshot(now);
  }

  /**
   * Refreshes the discovered layer if the cache has lapsed. Never throws:
   * discovery is an enhancement, and a failure just leaves the verified pool in
   * place.
   */
  async refresh(now: number = Date.now()): Promise<void> {
    if (!this.#apiKey) return;
    if (this.#lastDiscoveryAt !== null && now - this.#lastDiscoveryAt < this.#discoveryTtlMs) return;
    if (this.#inFlight) return this.#inFlight;

    this.#inFlight = this.#discover(now).finally(() => {
      this.#inFlight = null;
    });

    return this.#inFlight;
  }

  async #discover(now: number): Promise<void> {
    try {
      const response = await this.#fetchImpl(OPENROUTER_MODELS_URL, {
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.#onWarn(`model discovery failed: HTTP ${response.status}`);
        return;
      }

      const payload = (await response.json()) as { data?: unknown };
      this.#discovered = selectDiscoverableFreeModels(payload?.data, {
        exclude: [...scoringConfig.scoringModelCandidates],
        limit: this.#discoveryLimit,
      });
      this.#lastDiscoveryAt = now;
    } catch (error) {
      this.#onWarn(`model discovery failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
}
