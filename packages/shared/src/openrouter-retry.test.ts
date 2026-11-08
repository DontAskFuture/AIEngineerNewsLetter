import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideRetry, extractBodyError, isFreeTierModel } from "./openrouter-retry";

describe("isFreeTierModel", () => {
  it("recognizes the :free suffix", () => {
    assert.equal(isFreeTierModel("nvidia/nemotron-3-super-120b-a12b:free"), true);
  });

  it("rejects paid model ids", () => {
    assert.equal(isFreeTierModel("deepseek/deepseek-v4.1-flash-1017"), false);
  });

  it("ignores surrounding whitespace", () => {
    assert.equal(isFreeTierModel("  some/model:free  "), true);
  });

  it("does not match :free appearing mid-id", () => {
    assert.equal(isFreeTierModel("vendor/model:free-tier"), false);
  });
});

describe("decideRetry", () => {
  const base = { attempt: 0, maxRetries: 3, isFreeTier: false };

  // With a deep free pool behind it, moving to the next free model is always
  // cheaper than backing off on a congested one.
  it("never retries a free-tier model, whatever the failure", () => {
    for (const status of [429, 500, 502, 503, 400, 408]) {
      assert.equal(decideRetry({ ...base, status, isFreeTier: true }), "next-model", `status ${status}`);
    }
  });

  it("retries a paid model on 429 while attempts remain", () => {
    assert.equal(decideRetry({ ...base, status: 429 }), "retry");
  });

  it("retries a paid model on 5xx while attempts remain", () => {
    assert.equal(decideRetry({ ...base, status: 500 }), "retry");
  });

  it("moves to the next model once retries are exhausted", () => {
    assert.equal(decideRetry({ ...base, status: 429, attempt: 3 }), "next-model");
    assert.equal(decideRetry({ ...base, status: 500, attempt: 3 }), "next-model");
  });

  it("never retries a non-retryable client error", () => {
    assert.equal(decideRetry({ ...base, status: 400 }), "next-model");
    assert.equal(decideRetry({ ...base, status: 404 }), "next-model");
  });
});

describe("extractBodyError", () => {
  // OpenRouter reports upstream provider failures as HTTP 200 with an `error`
  // object in the body, so response.ok alone does not mean the call succeeded.
  it("extracts an upstream provider error returned under HTTP 200", () => {
    const payload = {
      id: "gen-123",
      error: { message: "Upstream error from Nvidia: Service temporarily overloaded", code: 502 },
    };
    assert.deepEqual(extractBodyError(payload), {
      message: "Upstream error from Nvidia: Service temporarily overloaded",
      status: 502,
    });
  });

  it("defaults to 502 when the error carries no numeric code", () => {
    assert.deepEqual(extractBodyError({ error: { message: "boom" } }), {
      message: "boom",
      status: 502,
    });
  });

  it("treats a body with no choices as a failure so the caller can fall through", () => {
    assert.deepEqual(extractBodyError({ id: "gen-1", choices: [] }), {
      message: "OpenRouter returned no choices",
      status: 502,
    });
  });

  it("returns null for a well-formed completion", () => {
    const payload = { id: "gen-1", choices: [{ message: { content: "{}" } }] };
    assert.equal(extractBodyError(payload), null);
  });

  it("returns a failure for a non-object payload", () => {
    assert.equal(extractBodyError(null)?.status, 502);
    assert.equal(extractBodyError("nope")?.status, 502);
  });

  it("classifies a rate-limit code so free-tier fall-through still applies", () => {
    const bodyError = extractBodyError({ error: { message: "rate limited", code: 429 } })!;
    assert.equal(bodyError.status, 429);
    assert.equal(
      decideRetry({ status: bodyError.status, attempt: 0, maxRetries: 3, isFreeTier: true }),
      "next-model",
    );
  });
});
