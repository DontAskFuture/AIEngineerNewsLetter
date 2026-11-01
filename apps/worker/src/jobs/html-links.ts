import type { JSDOM } from "jsdom";
import { canonicalizeUrl } from "@ai-intel/shared";

export interface HtmlParserConfig {
  selectors: string[];
  pathPattern?: RegExp;
}

/**
 * Source-specific listing-page strategies. Only needed when a listing page links
 * to article paths that differ from the listing path itself; simple listings
 * (for example `/blog` linking to `/blog/<slug>`) are handled by the generic
 * same-path fallback in `extractArticleLinks`.
 */
export const htmlParserConfigs: Record<string, HtmlParserConfig> = {
  "anthropic-news": {
    selectors: ['a[href^="/news/"]'],
    pathPattern: /^\/news\/[^/]+\/?$/,
  },
  "cerebras-blog": {
    selectors: ['a[href^="/blog/"]'],
    pathPattern: /^\/blog\/[^/]+\/?$/,
  },
  "cohere-blog": {
    selectors: ['a[href*="/blog/"]'],
    pathPattern: /^\/blog\/[^/]+\/?$/,
  },
  "langchain-blog": {
    selectors: ['a[href^="/blog/"]'],
    pathPattern: /^\/blog\/[^/]+\/?$/,
  },
  "mistral-news": {
    selectors: ['a[href^="/news/"]'],
    pathPattern: /^\/news\/[^/]+\/?$/,
  },
  // Epoch AI's /blog index links out to sibling content sections rather than
  // to /blog/<slug>, so the generic same-path strategy finds nothing.
  "epoch-ai": {
    selectors: ['a[href^="/gradient-updates/"]', 'a[href^="/data-insights/"]', 'a[href^="/publications/"]'],
    pathPattern: /^\/(gradient-updates|data-insights|publications)\/[^/]+\/?$/,
  },
  // LMArena's blog is served from the site root, so the listing path is "" and
  // the generic strategy rejects the extra /blog/ path segment.
  "lmarena-blog": {
    selectors: ['a[href^="/blog/"]'],
    pathPattern: /^\/blog\/[^/]+\/?$/,
  },
  // Physical Intelligence publishes model notes under /blog and papers under
  // /research from the same listing, so the generic same-path strategy drops
  // the research posts.
  "physical-intelligence": {
    selectors: ['a[href^="/blog/"]', 'a[href^="/research/"]'],
    pathPattern: /^\/(blog|research)\/[^/]+\/?$/,
  },
};

export function getHtmlParserConfig(parserKey: string | null): HtmlParserConfig | undefined {
  return parserKey ? htmlParserConfigs[parserKey] : undefined;
}

export function extractArticleLinks(dom: JSDOM, baseUrl: string, parserKey: string | null): string[] {
  const parsed = new URL(baseUrl);
  const baseDomain = parsed.hostname;
  const basePath = parsed.pathname.replace(/\/$/, "");
  const seen = new Set<string>();
  const links: string[] = [];
  const parserConfig = getHtmlParserConfig(parserKey);
  const selectors = parserConfig?.selectors ?? ["a[href]"];

  const anchors = selectors.flatMap((selector) => Array.from(dom.window.document.querySelectorAll<HTMLAnchorElement>(selector)));

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) continue;

    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      continue;
    }

    if (resolved.hostname !== baseDomain) continue;

    const resolvedPath = resolved.pathname.replace(/\/$/, "");

    if (parserConfig?.pathPattern) {
      if (!parserConfig.pathPattern.test(resolvedPath)) continue;
    } else if (!resolvedPath.startsWith(basePath + "/")) {
      continue;
    }

    const remainder = resolvedPath.slice(basePath.length + 1);
    if (!parserConfig && (!remainder || remainder.includes("/"))) continue;

    const normalized = canonicalizeUrl(resolved.toString());
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    links.push(normalized);
  }

  return links;
}
