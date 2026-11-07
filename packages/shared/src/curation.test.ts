import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InvalidSubscriberEmailError,
  buildCuratedRssXml,
  escapeXml,
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

describe("buildCuratedRssXml", () => {
  it("renders valid RSS 2.0 XML with pinned badges, curator notes, and escaped XML entities", () => {
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
    assert.match(xml, /<link>https:\/\/example\.com\/feed\?window=week<\/link>/);
    assert.equal(sanitizeHttpUrl("javascript:alert(1)", "https://example.com"), "https://example.com");
    assert.equal(escapeXml(`a&b<c>d"e'f`), "a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
});
