import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOpinionToStoredWhyRelevant,
  buildStoryDecisionRequest,
  buildTopicDecisionRequest,
  decideStoryRelevanceBatch,
  mapJevRelevanceScore,
  parseJevStoryDecision,
  recordStoryTopic,
  relevanceStorage,
  storyTopicAtCap,
  storyTopicKey,
} from "./jev";

describe("mapJevRelevanceScore", () => {
  it("maps ordered levels onto the existing 1-100 bands", () => {
    assert.deepEqual(mapJevRelevanceScore(0, 0.9), { score: 20, confidence: "high" });
    assert.deepEqual(mapJevRelevanceScore(1, 0.5), { score: 55, confidence: "medium" });
    assert.deepEqual(mapJevRelevanceScore(1.5, 0.8), { score: 68, confidence: "high" });
    assert.deepEqual(mapJevRelevanceScore(3, 0.99), { score: 95, confidence: "high" });
  });

  it("caps a low-confidence decision at 65", () => {
    assert.equal(mapJevRelevanceScore(2.8, 0.1).score, 65);
    assert.equal(mapJevRelevanceScore(2.8, undefined).confidence, "low");
  });
});

describe("story topics", () => {
  it("treats missing and unknown topics as one uncategorized bucket", () => {
    assert.equal(storyTopicKey(null), "uncategorized");
    assert.equal(storyTopicKey("not-a-topic"), "uncategorized");
    assert.equal(storyTopicKey("agents"), "agents");

    const counts = new Map<string, number>();
    recordStoryTopic(counts, null);
    recordStoryTopic(counts, "models");
    assert.equal(storyTopicAtCap(counts, "nope", 1), true);
    assert.equal(storyTopicAtCap(counts, "models", 2), false);
  });
});

describe("buildStoryDecisionRequest", () => {
  it("asks for a topic only when the document has not been classified", () => {
    const fresh = buildStoryDecisionRequest({
      interestStatement: "Ignore consumer gadgets. Watch inference serving.",
      story: {
        id: 4,
        title: "vLLM FP8 kernel",
        excerpt: "Hopper kernels raise FP8 utilization.",
        sourceName: "vLLM",
        sourceCategory: "github",
        storyTopic: null,
      },
    });

    assert.equal(fresh.questions.topic?.type, "choice");
    assert.equal(fresh.questions.relevance?.type, "score");
    assert.equal(fresh.state.title, "vLLM FP8 kernel");
    assert.ok(fresh.questions.relevance?.instructions.includes("Ignore consumer gadgets"));
    assert.equal(JSON.stringify(fresh.state).includes("Ignore consumer gadgets"), false);

    const classified = buildStoryDecisionRequest({
      interestStatement: "Agents",
      story: {
        id: 5,
        title: "Already classified",
        excerpt: "Excerpt",
        sourceName: "Lab",
        sourceCategory: "lab_blog",
        storyTopic: "agents",
      },
    });
    assert.equal(classified.questions.topic, undefined);
  });
});

describe("buildTopicDecisionRequest", () => {
  it("asks only for a topic", () => {
    const request = buildTopicDecisionRequest({
      id: 3,
      title: "New weights",
      excerpt: "A checkpoint dropped.",
      sourceName: "Lab",
      sourceCategory: "lab_blog",
      storyTopic: null,
    });
    assert.equal(request.questions.topic?.type, "choice");
    assert.equal(request.questions.relevance, undefined);
  });
});

describe("parseJevStoryDecision and relevance storage", () => {
  it("reads a score and a known topic, and parks an opinion for qualifying stories", () => {
    const parsed = parseJevStoryDecision(
      {
        model: "typesafe/jev-1.14-20261014",
        answers: {
          topic: { type: "choice", choice: "infrastructure" },
          relevance: { type: "score", score: 2.2, confidence: 0.8 },
        },
      },
      9,
    );

    assert.equal(parsed.topic, "infrastructure");
    assert.equal(parsed.model, "typesafe/jev-1.14-20261014");
    assert.ok(parsed.score >= 40);

    const stored = relevanceStorage(parsed);
    assert.equal(stored.needsOpinion, true);
    assert.equal(stored.opinionModel, null);
    assert.match(stored.whyRelevant, /^Opinion pending\./);

    const withTake = applyOpinionToStoredWhyRelevant({
      existingWhyRelevant: stored.whyRelevant,
      opinion: "Pin the kernel and remeasure TTFT.",
      matchedSignals: ["FP8"],
    });
    assert.match(withTake, /Pin the kernel/);
    assert.match(withTake, /Confidence: high/);
    assert.match(withTake, /Signals: FP8/);
  });

  it("stores a short non-opinion for scores below the take threshold", () => {
    const stored = relevanceStorage({ score: 20, confidence: "low" });
    assert.equal(stored.needsOpinion, false);
    assert.equal(stored.opinionModel, "not_required");
    assert.match(stored.whyRelevant, /Off-topic for this profile\./);
  });
});

describe("decideStoryRelevanceBatch", () => {
  it("keeps a successful story when another story fails", async () => {
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { state: { title: string } };
      if (body.state.title === "Bad") {
        return { ok: false, status: 400, json: async () => ({ error: { message: "rejected", code: 400 } }) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "typesafe/jev-1.14-test",
          answers: {
            topic: { type: "choice", choice: "models" },
            relevance: { type: "score", score: 3, confidence: 0.9 },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const outcomes = await decideStoryRelevanceBatch({
      apiKey: "test-key",
      interestStatement: "Model releases",
      stories: [
        { id: 1, title: "Good", excerpt: "A model", sourceName: "Lab", sourceCategory: "lab_blog", storyTopic: null },
        { id: 2, title: "Bad", excerpt: "Nope", sourceName: "Lab", sourceCategory: "lab_blog", storyTopic: null },
      ],
      fetchImpl,
      concurrency: 2,
      maxRetries: 0,
    });

    assert.equal(outcomes[0]?.ok, true);
    assert.equal(outcomes[1]?.ok, false);
    if (outcomes[0]?.ok) assert.equal(outcomes[0].topic, "models");
    if (!outcomes[1]?.ok) assert.match(outcomes[1].error, /rejected/);
  });
});
