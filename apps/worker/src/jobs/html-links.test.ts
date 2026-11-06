import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { extractArticleLinks } from "./html-links";

describe("extractArticleLinks", () => {
  it("extracts same-origin article links using generic path prefix matching and strips tracking params", () => {
    const baseUrl = "https://example.com/blog";
    const html = `
      <html>
        <body>
          <a href="/blog">Blog Index</a>
          <a href="/blog/vllm-fp8-kernels?utm_source=rss#benchmarks">vLLM FP8 Kernels</a>
          <a href="/blog/vllm-fp8-kernels">Duplicate Link</a>
          <a href="https://external.example.com/blog/other">External</a>
          <a href="/pricing">Pricing</a>
          <a href="/blog/nested/subpath">Nested subpath</a>
        </body>
      </html>
    `;

    const dom = new JSDOM(html, { url: baseUrl });
    const links = extractArticleLinks(dom, baseUrl, null);
    assert.deepEqual(links, ["https://example.com/blog/vllm-fp8-kernels"]);
  });

  it("uses source-specific parserKey selector strategies when provided", () => {
    const baseUrl = "https://www.physicalintelligence.company/blog";
    const html = `
      <html>
        <body>
          <a href="/blog/pi0-fast">pi0-FAST Model</a>
          <a href="/research/open-vla-scaling">OpenVLA Scaling</a>
          <a href="/careers">Careers</a>
        </body>
      </html>
    `;

    const dom = new JSDOM(html, { url: baseUrl });
    const links = extractArticleLinks(dom, baseUrl, "physical-intelligence");
    assert.deepEqual(links, [
      "https://www.physicalintelligence.company/blog/pi0-fast",
      "https://www.physicalintelligence.company/research/open-vla-scaling",
    ]);
  });
});
