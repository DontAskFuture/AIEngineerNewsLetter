import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WATCHED_MODEL_PROVIDERS,
  extractWatchedDocumentModelReleases,
  extractWatchedOpenRouterModels,
  formatModelContextLength,
  formatModelPricingPerMillion,
  mergeWatchedModelReleases,
} from "./model-releases";

describe("watched model releases", () => {
  const now = new Date("2026-11-21T18:00:00Z");
  const cutoffDate = new Date("2026-11-14T18:00:00Z");

  it("tracks all 14 requested providers", () => {
    assert.deepEqual(
      WATCHED_MODEL_PROVIDERS.map((p) => p.id),
      [
        "google",
        "xai",
        "anthropic",
        "openai",
        "deepseek",
        "tencent",
        "mai",
        "nvidia",
        "glm",
        "kimi",
        "xiaomi",
        "alibaba",
        "cohere",
        "mistral",
      ],
    );
  });

  it("filters OpenRouter models strictly to watched providers, excludes :batch/:free variants, and formats specs", () => {
    const payload = {
      data: [
        {
          id: "google/gemini-4-neon",
          name: "Google: Gemini 4 Neon",
          created: Math.floor(new Date("2026-11-20T12:00:00Z").getTime() / 1000),
          context_length: 1_048_576,
          pricing: { prompt: "0.000003", completion: "0.000015" },
        },
        {
          id: "google/gemini-4-neon:batch",
          name: "Google: Gemini 4 Neon (batch)",
          created: Math.floor(new Date("2026-11-20T12:00:00Z").getTime() / 1000),
          context_length: 1_048_576,
          pricing: { prompt: "0.0000015", completion: "0.0000075" },
        },
        {
          id: "~deepseek/deepseek-flash-latest",
          name: "DeepSeek Flash Latest",
          created: Math.floor(new Date("2026-11-20T12:00:00Z").getTime() / 1000),
          context_length: 128_000,
          pricing: { prompt: "0.00000015", completion: "0.0000006" },
        },
        {
          id: "thinkingmachines/inkling-2-mini",
          name: "Thinking Machines: Inkling 2 Mini",
          created: Math.floor(new Date("2026-11-21T08:00:00Z").getTime() / 1000),
          context_length: 1_048_576,
          pricing: { prompt: "0.0000002", completion: "0.0000008" },
        },
        {
          id: "xiaomi/mimo-v2.6-pro",
          name: "Xiaomi: MiMo-V2.6-Pro",
          created: Math.floor(new Date("2026-11-16T00:00:00Z").getTime() / 1000),
          context_length: 262_144,
          pricing: { prompt: "0.00000043", completion: "0.00000087" },
        },
        {
          id: "nvidia/switchyard",
          name: "NVIDIA: Switchyard",
          created: Math.floor(new Date("2026-11-15T00:00:00Z").getTime() / 1000),
          context_length: 128_000,
          pricing: { prompt: "-1", completion: "-1" },
        },
        {
          id: "anthropic/claude-old",
          name: "Anthropic: Old Model",
          created: Math.floor(new Date("2026-10-01T00:00:00Z").getTime() / 1000),
          context_length: 200_000,
          pricing: { prompt: "0.000003", completion: "0.000015" },
        },
      ],
    };

    const releases = extractWatchedOpenRouterModels(payload, { cutoffDate, now });
    assert.deepEqual(
      releases.map((r) => ({
        providerId: r.providerId,
        modelName: r.modelName,
        contextLabel: r.contextLabel,
        pricingLabel: r.pricingLabel,
        isNew: r.isNew,
      })),
      [
        {
          providerId: "google",
          modelName: "Gemini 4 Neon",
          contextLabel: "1M ctx",
          pricingLabel: "$3 / $15 per 1M",
          isNew: true,
        },
        {
          providerId: "xiaomi",
          modelName: "MiMo-V2.6-Pro",
          contextLabel: "262K ctx",
          pricingLabel: "$0.43 / $0.87 per 1M",
          isNew: false,
        },
        {
          providerId: "nvidia",
          modelName: "Switchyard",
          contextLabel: "128K ctx",
          pricingLabel: null,
          isNew: false,
        },
      ],
    );
    assert.equal(formatModelContextLength(1_050_000), "1M ctx");
    assert.equal(formatModelContextLength(2_000_000), "2M ctx");
    assert.equal(formatModelPricingPerMillion("0", "0"), "Free");
    assert.equal(formatModelPricingPerMillion("0.000000005", "0.00000002"), "$0.005 / $0.02 per 1M");
  });

  it("extracts official/release announcements for watched providers and filters out commentary or non-watched labs", () => {
    const docs = [
      {
        id: 1,
        title: "Introducing Gemini 4 Neon",
        canonicalUrl: "https://deepmind.google/blog/introducing-gemini-4-neon",
        sourceName: "Google DeepMind Blog",
        sourceSlug: "deepmind-blog",
        category: "lab_blog",
        storyTopic: "models",
        sortTime: new Date("2026-11-20T13:00:00Z"),
      },
      {
        id: 2,
        title: "Introducing MAI-Code-2 and MAI-Code-2-Flash",
        canonicalUrl: "https://microsoft.ai/news/introducing-mai-code-2-and-mai-code-2-flash",
        sourceName: "Microsoft AI (MAI)",
        sourceSlug: "microsoft-ai-mai",
        category: "lab_blog",
        storyTopic: null,
        sortTime: new Date("2026-11-19T12:00:00Z"),
      },
      {
        id: 3,
        title: "OpenAI shares new prompting tips for GPT-6.2 Astra and Sol",
        canonicalUrl: "https://the-decoder.com/openai-prompting-tips",
        sourceName: "The Decoder",
        sourceSlug: "the-decoder",
        category: "community_feed",
        storyTopic: "models",
        sortTime: new Date("2026-11-21T10:00:00Z"),
      },
      {
        id: 4,
        title: "Meta releases Muse Ember, a new lightweight model for agent execution",
        canonicalUrl: "https://techcrunch.com/meta-muse-ember",
        sourceName: "TechCrunch AI",
        sourceSlug: "techcrunch-ai",
        category: "community_feed",
        storyTopic: "models",
        sortTime: new Date("2026-11-20T10:00:00Z"),
      },
      {
        id: 5,
        title: "Tencent Releases Hy4 Flagship Weights Under Conditional License",
        canonicalUrl: "https://pandaily.com/tencent-hy4-weights",
        sourceName: "Pandaily",
        sourceSlug: "pandaily",
        category: "community_feed",
        storyTopic: "models",
        sortTime: new Date("2026-11-20T09:00:00Z"),
      },
      {
        id: 6,
        title: "llm-gemini 0.38",
        canonicalUrl: "https://simonwillison.net/llm-gemini",
        sourceName: "Simon Willison LLMs",
        sourceSlug: "simon-willison-llms",
        category: "community_feed",
        storyTopic: "models",
        sortTime: new Date("2026-11-18T12:00:00Z"),
      },
      {
        id: 7,
        title: "Grok Bot 1.0",
        canonicalUrl: "https://x.ai/news/grok-bot-1-0",
        sourceName: "xAI News",
        sourceSlug: "xai-news",
        category: "lab_blog",
        storyTopic: null,
        sortTime: new Date("2026-11-18T14:00:00Z"),
      },
    ];

    const docReleases = extractWatchedDocumentModelReleases(docs, { cutoffDate, now });
    assert.deepEqual(
      docReleases.map((r) => ({ id: r.key, providerId: r.providerId })),
      [
        { id: "doc:1", providerId: "google" },
        { id: "doc:5", providerId: "tencent" },
        { id: "doc:2", providerId: "mai" },
        { id: "doc:7", providerId: "xai" },
      ],
    );

    const openRouterReleases = extractWatchedOpenRouterModels(
      {
        data: [
          {
            id: "google/gemini-4-neon",
            name: "Google: Gemini 4 Neon",
            created: Math.floor(new Date("2026-11-20T12:00:00Z").getTime() / 1000),
            context_length: 1_048_576,
            pricing: { prompt: "0.000003", completion: "0.000015" },
          },
        ],
      },
      { cutoffDate, now },
    );

    const merged = mergeWatchedModelReleases(openRouterReleases, docReleases);
    assert.equal(merged.length, 4);
    assert.equal(merged[0]?.key, "openrouter:google/gemini-4-neon");
    assert.equal(
      merged[0]?.announcementUrl,
      "https://deepmind.google/blog/introducing-gemini-4-neon",
    );
    assert.deepEqual(
      merged.map((m) => m.providerId),
      ["google", "tencent", "mai", "xai"],
    );
  });
});
