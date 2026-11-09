import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNewsletterHtml,
  buildNewsletterText,
  selectTopStories,
  type NewsletterRecipient,
  type NewsletterStory,
} from "./send-daily-newsletter";

function makeStory(overrides: Partial<NewsletterStory> & { id: number; title: string }): NewsletterStory {
  return {
    id: overrides.id,
    title: overrides.title,
    canonicalUrl: overrides.canonicalUrl ?? `https://example.com/story-${overrides.id}`,
    sourceName: overrides.sourceName ?? "Example Blog",
    sourceGroupKey: overrides.sourceGroupKey ?? "example.com",
    sortTime: overrides.sortTime ?? new Date("2026-11-07T12:00:00Z"),
    score: overrides.score ?? 85,
    whyRelevant: overrides.whyRelevant ?? "Relevant to AI builders.",
    curatorNote: overrides.curatorNote ?? null,
    isPinned: overrides.isPinned ?? false,
    isHidden: overrides.isHidden ?? false,
  };
}

describe("selectTopStories", () => {
  it("promotes pinned stories ahead of unpinned stories and excludes hidden stories", () => {
    const stories = [
      makeStory({ id: 1, title: "Regular Story A", score: 95 }),
      makeStory({ id: 2, title: "Hidden Story B", score: 99, isHidden: true }),
      makeStory({ id: 3, title: "Hidden Pinned Story C", score: 99, isPinned: true, isHidden: true }),
      makeStory({ id: 4, title: "Pinned Story D", score: 70, isPinned: true }),
    ];

    const selected = selectTopStories(stories);
    assert.deepEqual(
      selected.map((s) => s.id),
      [4, 1],
    );
  });

  it("caps unpinned stories at 5 per source family while allowing pinned picks", () => {
    const stories: NewsletterStory[] = [];
    for (let i = 1; i <= 7; i++) {
      stories.push(
        makeStory({
          id: i,
          title: `Same Source Story ${i}`,
          sourceGroupKey: "openai.com",
          isPinned: i === 7,
        }),
      );
    }

    const selected = selectTopStories(stories);
    // Story 7 is pinned (comes first), plus 4 unpinned from openai.com to reach source cap of 5
    assert.equal(selected[0]?.id, 7);
    assert.equal(selected.length, 5);
  });
});

describe("buildNewsletterHtml and buildNewsletterText", () => {
  const recipient: NewsletterRecipient = {
    userId: 2,
    email: "subscriber@example.com",
    profileId: 1,
    profileName: "Founding analyst",
  };

  it("renders Michael's Take, Pinned Pick badges, and one-click unsubscribe links", () => {
    const stories = [
      makeStory({
        id: 10,
        title: "Agent Sandbox Runtime <v2>",
        isPinned: true,
        curatorNote: "Critical primitive for multi-tenant code execution & tool isolation.",
        whyRelevant: "AI generated note that should be overridden by curatorNote.",
      }),
    ];
    const unsubscribeUrl = "https://example.com/feed/unsubscribe?token=abc123token";
    const trendBullets = ["MoE specialization and NVMe streaming are eroding the H100 moat."];

    const html = buildNewsletterHtml(recipient, stories, "2026-11-07", unsubscribeUrl, "UTC", trendBullets);
    const text = buildNewsletterText(recipient, stories, "2026-11-07", unsubscribeUrl, "UTC", trendBullets);

    assert.match(html, /Michael's Daily AI Intelligence Brief/);
    assert.match(html, /What AI Engineers Should Read Today/);
    assert.match(html, /Today's Industry Trend · Macro Signal &amp; Insights/);
    assert.match(html, /MoE specialization and NVMe streaming are eroding the H100 moat\./);
    assert.match(html, /Pinned Pick/);
    assert.match(html, /Michael's Take/);
    assert.match(html, /Critical primitive for multi-tenant code execution &amp; tool isolation\./);
    assert.doesNotMatch(html, /AI generated note that should be overridden/);
    assert.match(html, /Agent Sandbox Runtime &lt;v2&gt;/);
    assert.match(html, /href="https:\/\/example\.com\/feed\/unsubscribe\?token=abc123token"/);

    assert.match(text, /Michael's Daily AI Intelligence Brief \(2026-11-07\)/);
    assert.match(text, /TODAY'S INDUSTRY TREND · MACRO SIGNAL & INSIGHTS/);
    assert.match(text, /- MoE specialization and NVMe streaming are eroding the H100 moat\./);
    assert.match(text, /1\. Agent Sandbox Runtime <v2> \[Pinned Pick\]/);
    assert.match(text, /Michael's Take: Critical primitive for multi-tenant code execution & tool isolation\./);
    assert.match(text, /Unsubscribe: https:\/\/example\.com\/feed\/unsubscribe\?token=abc123token/);
  });
});
