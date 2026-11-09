import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InvalidSubscriberEmailError,
  buildCuratedRssXml,
  escapeXml,
  formatPractitionerTake,
  normalizeSubscriberEmail,
  sanitizeHttpUrl,
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
          isPinned: false,
        },
      ],
    });

    assert.match(xml, /<title>Autumn &lt;AI&gt; · Curated AI Intelligence<\/title>/);
    assert.match(xml, /<title>\[Pinned Pick\] Disaggregated RL &amp; Weight Sync<\/title>/);
    assert.match(
      xml,
      /Autumn &lt;AI&gt;&apos;s Take: Watch the collective bandwidth curve &lt;100ms\./,
    );
    assert.match(
      xml,
      /Autumn &lt;AI&gt;&apos;s Take: Shows how KV cache offloading reduces TTFT by 40%\./,
    );
    assert.match(xml, /<link>https:\/\/example\.com\/feed\?window=week<\/link>/);
    assert.equal(sanitizeHttpUrl("javascript:alert(1)", "https://example.com"), "https://example.com");
    assert.equal(escapeXml(`a&b<c>d"e'f`), "a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
});
