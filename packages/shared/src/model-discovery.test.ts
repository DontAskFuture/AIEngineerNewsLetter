import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DISCOVERY_MIN_CONTEXT, selectDiscoverableFreeModels } from "./model-discovery";

function model(overrides: Record<string, unknown> = {}) {
  return {
    id: "vendor/candidate:free",
    context_length: 262_144,
    supported_parameters: ["max_tokens", "response_format", "temperature"],
    ...overrides,
  };
}

describe("selectDiscoverableFreeModels", () => {
  it("keeps a free model that meets every gate", () => {
    assert.deepEqual(selectDiscoverableFreeModels([model()]), ["vendor/candidate:free"]);
  });

  it("excludes paid models", () => {
    assert.deepEqual(selectDiscoverableFreeModels([model({ id: "vendor/paid" })]), []);
  });

  it("excludes models without response_format, which the JSON contract relies on", () => {
    const without = model({ supported_parameters: ["max_tokens", "temperature"] });
    assert.deepEqual(selectDiscoverableFreeModels([without]), []);
  });

  it("excludes models whose context cannot hold a scoring batch", () => {
    const tiny = model({ context_length: DISCOVERY_MIN_CONTEXT - 1 });
    assert.deepEqual(selectDiscoverableFreeModels([tiny]), []);
  });

  it("excludes already-known models so the verified pool is not duplicated", () => {
    const known = ["vendor/candidate:free"];
    assert.deepEqual(selectDiscoverableFreeModels([model()], { exclude: known }), []);
  });

  it("excludes denylisted models", () => {
    const result = selectDiscoverableFreeModels([model()], { deny: ["vendor/candidate:free"] });
    assert.deepEqual(result, []);
  });

  it("ranks by context length descending as a weak capability proxy", () => {
    const models = [
      model({ id: "vendor/small:free", context_length: 100_000 }),
      model({ id: "vendor/large:free", context_length: 900_000 }),
      model({ id: "vendor/mid:free", context_length: 400_000 }),
    ];
    assert.deepEqual(selectDiscoverableFreeModels(models), [
      "vendor/large:free",
      "vendor/mid:free",
      "vendor/small:free",
    ]);
  });

  it("caps how many discovered models are returned", () => {
    const models = Array.from({ length: 30 }, (_, i) =>
      model({ id: `vendor/m${i}:free`, context_length: 262_144 - i }),
    );
    assert.equal(selectDiscoverableFreeModels(models, { limit: 4 }).length, 4);
  });

  it("ignores malformed entries instead of throwing", () => {
    const models = [null, "nope", {}, { id: 42 }, model()];
    assert.deepEqual(selectDiscoverableFreeModels(models), ["vendor/candidate:free"]);
  });

  it("returns an empty list for a non-array payload", () => {
    assert.deepEqual(selectDiscoverableFreeModels(null), []);
    assert.deepEqual(selectDiscoverableFreeModels(undefined), []);
  });
});
