import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InvalidSubscriberEmailError,
  buildCuratedRssXml,
  escapeXml,
  formatPractitionerTake,
  normalizeSubscriberEmail,
  readDocumentStoryImage,
  sanitizeHttpUrl,
  sanitizeStoryImageUrl,
  shouldDisplayTopStoryImage,
} from "./curation";

describe("normalizeSubscriberEmail", () => {
  it("trims and lowercases valid email addresses", () => {
    assert.equal(normalizeSubscriberEmail("  Founder+AI@Example.COM "), "founder+ai@example.com");
  });

  it("rejects empty, malformed, and overlong emails", () => {
    assert.throws(() => normalizeSubscriberEmail(""), InvalidSubscriberEmailError);
    assert.throws(() => normalizeSubscriberEmail("not-an-email"), InvalidSubscriberEmailError);
    assert.throws(() => normalizeSubscriberEmail("user@"), InvalidSubscriberEmailError);
    assert.throws(
      () => normalizeSubscriberEmail(`${"a".repeat(250)}@example.com`),
      InvalidSubscriberEmailError,
    );
  });
});

describe("formatPractitionerTake", () => {
  it("prefers manual curatorNote when provided", () => {
    assert.equal(
      formatPractitionerTake("Custom curator insight.", "AI generated note."),
      "Custom curator insight.",
    );
  });

  it("hides a pending opinion so Michael's Take stays empty until DeepSeek writes it", () => {
    assert.equal(formatPractitionerTake(null, "Opinion pending."), null);
    assert.equal(formatPractitionerTake(null, "Opinion pending.\n\nConfidence: high"), null);
    assert.equal(formatPractitionerTake(null, "Take withheld.\n\nConfidence: high"), null);
    assert.equal(formatPractitionerTake("Manual take.", "Opinion pending."), "Manual take.");
  });

  it("falls back to whyRelevant and strips legacy profile-matching boilerplate", () => {
    assert.equal(
      formatPractitionerTake(
        null,
        "Details scaling GLM-5.3-Flash training to 1M tokens on 64 B200 GPUs in SkyRL, directly relevant to AI engineering advancements and model updates.",
      ),
      "Details scaling GLM-5.3-Flash training to 1M tokens on 64 B200 GPUs in SkyRL.",
    );
  });
});

describe("buildCuratedRssXml", () => {
  it("renders valid RSS 2.0 XML with pinned badges, curator notes, whyRelevant fallback, and escaped XML entities", () => {
    const xml = buildCuratedRssXml({
      brandAuthorName: "Autumn <AI>",
      brandAuthorBio: "Opinionated AI & infra notes.",
      feedUrl: "https://example.com/feed?window=week",
      selfUrl: "https://example.com/rss.xml",
      items: [
        {
          id: 42,
          title: "Disaggregated RL & Weight Sync",
          canonicalUrl: "https://example.com/rl-weights",
          sourceName: "NVIDIA Blog",
          category: "engineering_blog",
          sortTime: new Date("2026-11-07T12:00:00Z"),
          previewParagraph: "Fast weight refit across training & inference GPUs.",
          curatorNote: "Watch the collective bandwidth curve <100ms.",
          whyRelevant: null,
          isPinned: true,
        },
        {
          id: 43,
          title: "Untrusted Link Story",
          canonicalUrl: "javascript:alert(1)",
          sourceName: "Community",
          category: "community_feed",
          sortTime: new Date("2026-11-07T11:00:00Z"),
          previewParagraph: "Preview text.",
          curatorNote: null,
          whyRelevant: "Shows how KV cache offloading reduces TTFT by 40%.",
          imageUrl: "https://cdn.example.com/kv-offload-chart.png",
          imageAlt: "KV cache latency curve",
          isPinned: false,
        },
        {
          id: 44,
          title: "Story 3 Unpinned",
          canonicalUrl: "https://example.com/story-3",
          sourceName: "Blog",
          category: "engineering_blog",
          sortTime: new Date("2026-11-07T10:00:00Z"),
          previewParagraph: "Story 3",
          curatorNote: null,
          imageUrl: "https://cdn.example.com/story-3.png",
          isPinned: false,
        },
        {
          id: 45,
          title: "Story 4 Unpinned Image Omitted",
          canonicalUrl: "https://example.com/story-4",
          sourceName: "Blog",
          category: "engineering_blog",
          sortTime: new Date("2026-11-07T09:00:00Z"),
          previewParagraph: "Story 4",
          curatorNote: null,
          imageUrl: "https://cdn.example.com/story-4.png",
          isPinned: false,
        },
        {
          id: 46,
          title: "Story 5 Pinned Included",
          canonicalUrl: "https://example.com/story-5",
          sourceName: "Blog",
          category: "engineering_blog",
          sortTime: new Date("2026-11-07T08:00:00Z"),
          previewParagraph: "Story 5",
          curatorNote: null,
          imageUrl: "https://cdn.example.com/story-5.webp",
          isPinned: true,
        },
      ],
    });

    assert.match(xml, /<title>Autumn &lt;AI&gt;&apos;s Newsletter<\/title>/);
    assert.match(xml, /<title>\[Pinned Pick\] Disaggregated RL &amp; Weight Sync<\/title>/);
    assert.match(
      xml,
      /Autumn &lt;AI&gt;&apos;s Take: Watch the collective bandwidth curve &lt;100ms\./,
    );
    assert.match(
      xml,
      /Autumn &lt;AI&gt;&apos;s Take: Shows how KV cache offloading reduces TTFT by 40%\./,
    );
    assert.match(xml, /<enclosure url="https:\/\/cdn\.example\.com\/kv-offload-chart\.png" length="0" type="image\/png" \/>/);
    assert.match(xml, /<enclosure url="https:\/\/cdn\.example\.com\/story-3\.png" length="0" type="image\/png" \/>/);
    assert.doesNotMatch(xml, /story-4\.png/);
    assert.match(xml, /<enclosure url="https:\/\/cdn\.example\.com\/story-5\.webp" length="0" type="image\/webp" \/>/);
    assert.match(xml, /<link>https:\/\/example\.com\/feed\?window=week<\/link>/);
    assert.equal(sanitizeHttpUrl("javascript:alert(1)", "https://example.com"), "https://example.com");
    assert.equal(escapeXml(`a&b<c>d"e'f`), "a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
});

describe("story image helpers", () => {
  it("accepts valid HTTPS diagrams and rejects insecure, vector, or generic social banners", () => {
    assert.equal(
      sanitizeStoryImageUrl("https://arxiv.org/html/2610.33253v2/AIOS_Architecture.png"),
      "https://arxiv.org/html/2610.33253v2/AIOS_Architecture.png",
    );
    assert.equal(sanitizeStoryImageUrl("http://example.com/chart.png"), null);
    assert.equal(sanitizeStoryImageUrl("https://example.com/logo.svg"), null);
    assert.equal(
      sanitizeStoryImageUrl("https://opengraph.githubassets.com/123/ggml-org/llama.cpp"),
      null,
    );
    assert.equal(
      sanitizeStoryImageUrl("https://cdn.example.com/opengraph-cover-image.jpg"),
      null,
    );
    assert.equal(
      sanitizeStoryImageUrl("https://api-docs.deepseek.com/img/deepseek-social-card.jpeg"),
      null,
    );
    assert.equal(sanitizeStoryImageUrl("https://avatars.githubusercontent.com/u/12345"), null);
    assert.equal(sanitizeStoryImageUrl("https://example.com/favicon.png"), null);
    assert.equal(sanitizeStoryImageUrl("https://localhost/diagram.png"), null);
  });

  it("reads sanitized metadata and limits unpinned display to top 3 slots plus pins", () => {
    const image = readDocumentStoryImage({
      imageUrl: "https://cdn.example.com/fig1.png",
      imageAlt: "  Figure 1: Throughput chart  ",
    });
    assert.deepEqual(image, {
      imageUrl: "https://cdn.example.com/fig1.png",
      imageAlt: "Figure 1: Throughput chart",
    });

    assert.equal(shouldDisplayTopStoryImage(0, false, image), true);
    assert.equal(shouldDisplayTopStoryImage(2, false, image), true);
    assert.equal(shouldDisplayTopStoryImage(3, false, image), false);
    assert.equal(shouldDisplayTopStoryImage(5, true, image), true);
    assert.equal(shouldDisplayTopStoryImage(0, true, null), false);
  });
});
