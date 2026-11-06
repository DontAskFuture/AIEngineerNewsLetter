import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ScoringModelPool } from "./model-pool";
import { scoringConfig } from "./scoring-config";

const PAID = "deepseek/deepseek-v4-flash-0731";

function modelsPayload(ids: string[]) {
  return {
    data: ids.map((id) => ({
      id,
      context_length: 262_144,
      supported_parameters: ["max_tokens", "response_format"],
    })),
  };
}

function stubFetch(payload: unknown, status = 200) {
  const state = { calls: 0 };
  const impl = (async () => {
    state.calls++;
    return { ok: status >= 200 && status < 300, status, json: async () => payload } as unknown as Response;
  }) as unknown as typeof fetch & { state: { calls: number } };
  impl.state = state;
  return impl;
}

describe("ScoringModelPool", () => {
  it("returns the verified pool with the paid backstop last before any discovery", () => {
    const pool = new ScoringModelPool({ fetchImpl: stubFetch(modelsPayload([])) });
    const candidates = pool.candidates();

    assert.deepEqual(candidates, [...scoringConfig.scoringModelCandidates]);
    assert.equal(candidates.at(-1), PAID);
  });

  it("appends discovered models after the verified pool but before the paid backstop", async () => {
    const fetchImpl = stubFetch(modelsPayload(["vendor/new:free"]));
    const pool = new ScoringModelPool({ fetchImpl, apiKey: "k" });
    await pool.refresh();

    const candidates = pool.candidates();
    const verifiedCount = scoringConfig.scoringModelCandidates.length - 1;

    assert.deepEqual(candidates.slice(0, verifiedCount), scoringConfig.scoringModelCandidates.slice(0, verifiedCount));
    assert.equal(candidates.at(-1), PAID);
    assert.ok(candidates.includes("vendor/new:free"));
    assert.ok(candidates.indexOf("vendor/new:free") > verifiedCount - 1);
    assert.ok(candidates.indexOf("vendor/new:free") < candidates.indexOf(PAID));
  });

  it("never duplicates a model already in the verified pool", async () => {
    const known = scoringConfig.scoringModelCandidates[0];
    const pool = new ScoringModelPool({ fetchImpl: stubFetch(modelsPayload([known])), apiKey: "k" });
    await pool.refresh();

    const candidates = pool.candidates();
    assert.equal(new Set(candidates).size, candidates.length);
  });

  it("keeps serving the verified pool when discovery fails", async () => {
    const failing = async () => {
      throw new Error("network down");
    };
    const pool = new ScoringModelPool({ fetchImpl: failing as unknown as typeof fetch, apiKey: "k" });
    await pool.refresh();

    assert.deepEqual(pool.candidates(), [...scoringConfig.scoringModelCandidates]);
  });

  it("keeps serving the verified pool when discovery returns a non-OK response", async () => {
    const pool = new ScoringModelPool({ fetchImpl: stubFetch({}, 500), apiKey: "k" });
    await pool.refresh();

    assert.deepEqual(pool.candidates(), [...scoringConfig.scoringModelCandidates]);
  });

  it("drops a parked free model from the candidate order, including when passed as fallbackModel", () => {
    const pool = new ScoringModelPool({ fetchImpl: stubFetch(modelsPayload([])) });
    const first = scoringConfig.scoringModelCandidates[0];

    pool.recordFailure(first, 429, 0);

    assert.ok(!pool.candidates(1).includes(first));
    assert.ok(!pool.candidates(1, first).includes(first));
    assert.equal(pool.candidates(1, PAID).at(-1), PAID);
  });

  it("restores a parked model once its cooldown lapses", () => {
    const pool = new ScoringModelPool({ fetchImpl: stubFetch(modelsPayload([])) });
    const first = scoringConfig.scoringModelCandidates[0];

    pool.recordFailure(first, 429, 0);
    assert.ok(!pool.candidates(1).includes(first));

    assert.ok(pool.candidates(24 * 60 * 60_000).includes(first));
  });

  it("keeps the paid backstop even when every free model is parked", () => {
    const pool = new ScoringModelPool({ fetchImpl: stubFetch(modelsPayload([])) });
    for (const model of scoringConfig.scoringModelCandidates) pool.recordFailure(model, 429, 0);

    assert.ok(pool.candidates(1).includes(PAID));
  });

  it("does not refetch discovery inside the cache window", async () => {
    const fetchImpl = stubFetch(modelsPayload(["vendor/new:free"]));
    const pool = new ScoringModelPool({ fetchImpl, apiKey: "k" });

    await pool.refresh(0);
    await pool.refresh(1000);

    assert.equal(fetchImpl.state.calls, 1);
  });

  it("refetches discovery once the cache window lapses", async () => {
    const fetchImpl = stubFetch(modelsPayload(["vendor/new:free"]));
    const pool = new ScoringModelPool({ fetchImpl, apiKey: "k", discoveryTtlMs: 500 });

    await pool.refresh(0);
    await pool.refresh(600);

    assert.equal(fetchImpl.state.calls, 2);
  });

  it("skips discovery entirely without an api key", async () => {
    const fetchImpl = stubFetch(modelsPayload(["vendor/new:free"]));
    const pool = new ScoringModelPool({ fetchImpl });
    await pool.refresh();

    assert.equal(fetchImpl.state.calls, 0);
    assert.deepEqual(pool.candidates(), [...scoringConfig.scoringModelCandidates]);
  });
});
