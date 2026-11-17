import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import {
  extractImageFromArticleDom,
  extractImageFromFeedItem,
  shouldSkipStoryPageImageFetch,
  toArxivHtmlUrl,
} from "./article-media";

describe("article-media helpers", () => {
  it("converts arXiv abs URLs to HTML URLs and flags GitHub release tags and Reddit threads for skip", () => {
    assert.equal(toArxivHtmlUrl("https://arxiv.org/abs/2610.33253"), "https://arxiv.org/html/2610.33253");
    assert.equal(toArxivHtmlUrl("https://arxiv.org/abs/2610.33253v2"), "https://arxiv.org/html/2610.33253v2");
    assert.equal(toArxivHtmlUrl("https://openai.com/news/post"), null);

    assert.equal(
      shouldSkipStoryPageImageFetch("https://github.com/ggml-org/llama.cpp/releases/tag/b12391"),
      true,
    );
    assert.equal(
      shouldSkipStoryPageImageFetch("https://www.reddit.com/r/LocalLLaMA/comments/1abc/test"),
      true,
    );
    assert.equal(shouldSkipStoryPageImageFetch("https://developer.nvidia.com/blog/test"), false);
  });

  it("prefers in-article Readability diagram images over generic social cover og:image", () => {
    const pageUrl = "https://www.runpod.io/blog/clone-your-voice-f5-tts";
    const fullHtml = `
      <html>
        <head>
          <meta property="og:image" content="https://cdn.example.com/69e08af826de248f8febd0dc_opengraph-cover-image.jpg" />
        </head>
        <body><p>Wrapper page</p></body>
      </html>
    `;
    const articleHtml = `
      <div>
        <img src="https://cdn.example.com/f5-tts-voice-cloning-pipeline.png" alt="Pipeline diagram: audio prep, fine-tuning, and inference." />
      </div>
    `;

    const dom = new JSDOM(fullHtml, { url: pageUrl });
    const extracted = extractImageFromArticleDom(dom, articleHtml, pageUrl);
    assert.deepEqual(extracted, {
      imageUrl: "https://cdn.example.com/f5-tts-voice-cloning-pipeline.png",
      imageAlt: "Pipeline diagram: audio prep, fine-tuning, and inference.",
    });
  });

  it("resolves arXiv HTML <base> + Figure 1 images and captions cleanly", () => {
    const pageUrl = "https://arxiv.org/html/2610.33253";
    const arxivHtml = `
      <html>
        <head><base href="/html/2610.33253v2/" /></head>
        <body>
          <figure>
            <img src="AIOS_Architecture.png" />
            <figcaption>Figure 1: Zafin AIOS High-Level Architecture</figcaption>
          </figure>
        </body>
      </html>
    `;

    const dom = new JSDOM(arxivHtml, { url: pageUrl });
    const extracted = extractImageFromArticleDom(dom, null, pageUrl);
    assert.deepEqual(extracted, {
      imageUrl: "https://arxiv.org/html/2610.33253v2/AIOS_Architecture.png",
      imageAlt: "Figure 1: Zafin AIOS High-Level Architecture",
    });
  });

  it("skips tiny avatars and falls back to valid og:image when no article figures exist", () => {
    const pageUrl = "https://aws.amazon.com/blogs/machine-learning/agents";
    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://d2908q01vomqb2.cloudfront.net/diagram-hero.png" />
          <meta property="og:image:alt" content="Agent architecture blueprint" />
        </head>
        <body><p>Text</p></body>
      </html>
    `;
    const articleHtml = `
      <div>
        <img src="https://cdn.example.com/author.jpg" width="48" height="48" alt="Author" />
      </div>
    `;

    const dom = new JSDOM(html, { url: pageUrl });
    const extracted = extractImageFromArticleDom(dom, articleHtml, pageUrl);
    assert.deepEqual(extracted, {
      imageUrl: "https://d2908q01vomqb2.cloudfront.net/diagram-hero.png",
      imageAlt: "Agent architecture blueprint",
    });
  });

  it("extracts images from RSS contentEncoded or media:content entries", () => {
    const fromContent = extractImageFromFeedItem(
      {
        contentEncoded: `<p>Intro</p><img src="/charts/vllm-latency.png" alt="Throughput chart" width="900" />`,
      },
      "https://example.com/blog/post",
    );
    assert.deepEqual(fromContent, {
      imageUrl: "https://example.com/charts/vllm-latency.png",
      imageAlt: "Throughput chart",
    });

    const fromMedia = extractImageFromFeedItem(
      {
        mediaContent: [{ $: { url: "https://cdn.example.com/hero.jpg", width: "1200" } }],
      },
      "https://example.com/blog/post",
    );
    assert.deepEqual(fromMedia, {
      imageUrl: "https://cdn.example.com/hero.jpg",
      imageAlt: null,
    });
  });
});
