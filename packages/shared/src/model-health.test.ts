import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COOLDOWN_MS, ModelHealthTracker, classifyFailure } from "./model-health";

const FREE_A = "vendor/a:free";
const FREE_B = "vendor/b:free";
const PAID = "deepseek/deepseek-v4.1-flash-1017";

describe("classifyFailure", () => {
  it("treats 429 as an exhausted quota", () => {
    assert.equal(classifyFailure(429), "quota");
  });

  it("treats 403/401 as the account not being entitled to the model", () => {
    assert.equal(classifyFailure(403), "forbidden");
    assert.equal(classifyFailure(401), "forbidden");
  });

  it("treats 400/404 as a bad model id", () => {
    assert.equal(classifyFailure(400), "invalid");
    assert.equal(classifyFailure(404), "invalid");
  });

  it("treats upstream and timeout failures as transient", () => {
    assert.equal(classifyFailure(500), "transient");
    assert.equal(classifyFailure(502), "transient");
    assert.equal(classifyFailure(408), "transient");
  });

  it("orders cooldowns so entitlement failures outlast quota, and quota outlasts transient", () => {
    assert.ok(COOLDOWN_MS.invalid > COOLDOWN_MS.forbidden);
    assert.ok(COOLDOWN_MS.forbidden > COOLDOWN_MS.quota);
    assert.ok(COOLDOWN_MS.quota > COOLDOWN_MS.transient);
  });
});

describe("ModelHealthTracker", () => {
  it("treats an unseen model as available", () => {
    const tracker = new ModelHealthTracker();
    assert.equal(tracker.isParked(FREE_A, 0), false);
  });

  it("parks a model for the cooldown matching its failure kind", () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure(FREE_A, 429, 1000);

    assert.equal(tracker.isParked(FREE_A, 1000), true);
    assert.equal(tracker.isParked(FREE_A, 1000 + COOLDOWN_MS.quota - 1), true);
    assert.equal(tracker.isParked(FREE_A, 1000 + COOLDOWN_MS.quota), false);
  });

  it("escalates the cooldown for consecutive transient failures", () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure(FREE_A, 500, 0);
    const first = tracker.parkedUntil(FREE_A)!;

    tracker.recordFailure(FREE_A, 500, first);
    const second = tracker.parkedUntil(FREE_A)!;

    assert.ok(second - first > first, "second cooldown should be longer than the first");
  });

  it("caps escalation so a model is never parked indefinitely", () => {
    const tracker = new ModelHealthTracker();
    let now = 0;
    for (let i = 0; i < 20; i++) {
      tracker.recordFailure(FREE_A, 500, now);
      now = tracker.parkedUntil(FREE_A)!;
    }
    assert.ok(tracker.parkedUntil(FREE_A)! - now <= COOLDOWN_MS.maxTransient);
  });

  it("clears the park and the escalation streak on success", () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure(FREE_A, 500, 0);
    assert.equal(tracker.isParked(FREE_A, 1), true);

    tracker.recordSuccess(FREE_A, 1);
    assert.equal(tracker.isParked(FREE_A, 1), false);

    tracker.recordFailure(FREE_A, 500, 2);
    assert.equal(tracker.parkedUntil(FREE_A)! - 2, COOLDOWN_MS.transient);
  });

  it("filters parked free models out of the candidate order", () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure(FREE_A, 429, 0);

    assert.deepEqual(tracker.selectAvailable([FREE_A, FREE_B, PAID], 1), [FREE_B, PAID]);
  });

  it("preserves the given order for available models", () => {
    const tracker = new ModelHealthTracker();
    assert.deepEqual(tracker.selectAvailable([FREE_A, FREE_B, PAID], 0), [FREE_A, FREE_B, PAID]);
  });

  // The paid backstop is the only guaranteed path to a result, so health state
  // must never be able to remove it.
  it("never parks a paid model out of the candidate list", () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure(PAID, 500, 0);

    assert.deepEqual(tracker.selectAvailable([PAID], 1), [PAID]);
    assert.deepEqual(tracker.selectAvailable([FREE_A, PAID], 1), [FREE_A, PAID]);
  });

  it("falls back to the full list rather than returning nothing", () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure(FREE_A, 429, 0);
    tracker.recordFailure(FREE_B, 429, 0);

    assert.deepEqual(tracker.selectAvailable([FREE_A, FREE_B], 1), [FREE_A, FREE_B]);
  });

  it("reports a snapshot of parked models for logging", () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure(FREE_A, 429, 1000);

    const snapshot = tracker.snapshot(1000);
    assert.deepEqual(snapshot, [{ model: FREE_A, kind: "quota", parkedForMs: COOLDOWN_MS.quota }]);
  });
});
