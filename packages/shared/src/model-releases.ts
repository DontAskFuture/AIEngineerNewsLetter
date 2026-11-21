import { isHumanReadableStoryTitle, normalizeStoryTitle } from "./prompts";
import type { SourceCategory } from "./types";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const NEW_RELEASE_BADGE_WINDOW_MS = 48 * 60 * 60 * 1000;

export const WATCHED_MODEL_PROVIDER_IDS = [
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
] as const;

export type WatchedModelProviderId = (typeof WATCHED_MODEL_PROVIDER_IDS)[number];

export interface WatchedModelProvider {
  id: WatchedModelProviderId;
  label: string;
  shortLabel: string;
  openRouterPrefixes: readonly string[];
  officialSourceSlugs: readonly string[];
  titlePattern: RegExp;
}

export const WATCHED_MODEL_PROVIDERS: readonly WatchedModelProvider[] = [
  {
    id: "google",
    label: "Google",
    shortLabel: "Google",
    openRouterPrefixes: ["google"],
    officialSourceSlugs: ["deepmind-blog", "google-ai-blog", "google-research-blog"],
    titlePattern:
      /\b(?:google(?:\s+deepmind)?|deepmind|gemini(?:\s+[\d.]|\s+omni|\s+flash|\s+pro|\s+ultra)?|gemma(?:\s*[\d.])|imagen(?:\s*[\d.])|veo(?:\s*[\d.])|medgemma)\b/i,
  },
  {
    id: "xai",
    label: "xAI",
    shortLabel: "xAI",
    openRouterPrefixes: ["x-ai", "xai"],
    officialSourceSlugs: ["xai-news"],
    titlePattern: /\b(?:xai|x\.ai|grok(?:[-\s]*[\d.]|\s+code|\s+bot)?)\b/i,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    shortLabel: "Anthropic",
    openRouterPrefixes: ["anthropic"],
    officialSourceSlugs: ["anthropic-news"],
    titlePattern: /\b(?:anthropic|claude(?:\s+(?:opus|sonnet|haiku|fable|mythos|[\d.]))?)\b/i,
  },
  {
    id: "openai",
    label: "OpenAI",
    shortLabel: "OpenAI",
    openRouterPrefixes: ["openai"],
    officialSourceSlugs: ["openai-news"],
    titlePattern:
      /\b(?:openai|gpt[-\s]*\d(?:\.\d)?(?:\s*(?:astra|sol|mini|pro|nano|turbo|codex|live|oss))?|gpt-oss|gpt-live|o[134](?:-mini|-pro)?|sora(?:\s*[\d.])?)\b/i,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    shortLabel: "DeepSeek",
    openRouterPrefixes: ["deepseek"],
    officialSourceSlugs: ["deepseek-updates"],
    titlePattern: /\bdeepseek(?:[-\s]*(?:v\d|r\d|coder|vl|prover|math))?\b/i,
  },
  {
    id: "tencent",
    label: "Tencent",
    shortLabel: "Tencent",
    openRouterPrefixes: ["tencent"],
    officialSourceSlugs: [],
    titlePattern:
      /\b(?:tencent(?:\s+(?:hunyuan|hy\d))?|hunyuan(?:[-\s]*(?:video|3d|turbo|large|t1|a13b))?|hy\d(?:\.\d)?(?:\s*(?:flash|pro|flagship))?)\b|腾讯混元|混元/i,
  },
  {
    id: "mai",
    label: "Microsoft AI (MAI)",
    shortLabel: "MAI",
    openRouterPrefixes: ["microsoft", "mai"],
    officialSourceSlugs: ["microsoft-ai-mai", "microsoft-ai-blog"],
    titlePattern:
      /\b(?:microsoft\s+ai|mai(?:[-\s]*(?:1|2|code|cyber|image|voice|realtime|licensed))|phi[-\s]*[345](?:\.\d)?)\b/i,
  },
  {
    id: "nvidia",
    label: "NVIDIA",
    shortLabel: "NVIDIA",
    openRouterPrefixes: ["nvidia"],
    officialSourceSlugs: ["nvidia-ai-blog"],
    titlePattern:
      /\b(?:nvidia\s+(?:nemotron|cosmos|parakeet|canary|llama-nemotron)|nemotron(?:[-\s]*[\d.])?|llama-nemotron|cosmos(?:[-\s]*[\d.])?)\b/i,
  },
  {
    id: "glm",
    label: "Zhipu (GLM)",
    shortLabel: "GLM",
    openRouterPrefixes: ["z-ai", "thudm", "zhipu"],
    officialSourceSlugs: [],
    titlePattern:
      /\b(?:zhipu(?:\s+ai)?|z\.ai|thudm|chatglm|glm[-\s]*\d(?:\.\d)?|autoglm|cogvideox?|cogview)\b|智谱/i,
  },
  {
    id: "kimi",
    label: "Moonshot (Kimi)",
    shortLabel: "Kimi",
    openRouterPrefixes: ["moonshotai", "moonshot"],
    officialSourceSlugs: [],
    titlePattern:
      /\b(?:moonshot(?:\s*ai)?|kimi(?:[-\s]*(?:k\d|vl|audio|dev|researcher|linear))?)\b|月之暗面/i,
  },
  {
    id: "xiaomi",
    label: "Xiaomi",
    shortLabel: "Xiaomi",
    openRouterPrefixes: ["xiaomi"],
    officialSourceSlugs: [],
    titlePattern: /\b(?:xiaomi\s+(?:mimo|milm|model|ai)|mimo[-\s]*v?\d(?:\.\d)?|milm)\b|小米.*(?:mimo|大模型|模型)/i,
  },
  {
    id: "alibaba",
    label: "Alibaba (Qwen)",
    shortLabel: "Alibaba",
    openRouterPrefixes: ["qwen", "alibaba"],
    officialSourceSlugs: ["qwen-blog"],
    titlePattern:
      /\b(?:alibaba(?:\s+(?:qwen|wan|tongyi))?|qwen(?:\s*[\d.]|-?max|-?plus|-?turbo|-?flash|-?coder|-?vl|-?omni|-?image|-?tts)?|qwq(?:[-\s]*\d+)?|wan\s*2(?:\.\d)?|tongyi)\b|通义千问|千问\d/i,
  },
  {
    id: "cohere",
    label: "Cohere",
    shortLabel: "Cohere",
    openRouterPrefixes: ["cohere"],
    officialSourceSlugs: ["cohere-blog"],
    titlePattern:
      /\b(?:cohere|command[-\s]*(?:a|r)(?:\+|\s+plus|\s+vision)?|aya[-\s]*(?:expanse|vision|\d)|embed[-\s]*\d|rerank[-\s]*\d)\b/i,
  },
  {
    id: "mistral",
    label: "Mistral",
    shortLabel: "Mistral",
    openRouterPrefixes: ["mistralai", "mistral"],
    officialSourceSlugs: ["mistral-news"],
    titlePattern:
      /\b(?:mistral(?:\s+ai)?|mixtral|pixtral|codestral|devstral|magistral|ministral|voxtral|mathstral|saba)\b/i,
  },
] as const;

export const WATCHED_OFFICIAL_SOURCE_SLUGS: readonly string[] = WATCHED_MODEL_PROVIDERS.flatMap(
  (provider) => provider.officialSourceSlugs,
);

const PROVIDER_BY_OPENROUTER_PREFIX = new Map<string, WatchedModelProvider>();
const PROVIDER_BY_OFFICIAL_SLUG = new Map<string, WatchedModelProvider>();

for (const provider of WATCHED_MODEL_PROVIDERS) {
  for (const prefix of provider.openRouterPrefixes) {
    PROVIDER_BY_OPENROUTER_PREFIX.set(prefix.toLowerCase(), provider);
  }
  for (const slug of provider.officialSourceSlugs) {
    PROVIDER_BY_OFFICIAL_SLUG.set(slug.toLowerCase(), provider);
  }
}

const EXCLUDED_ANNOUNCEMENT_SOURCES = new Set([
  "reddit-local-llama",
  "reddit-machine-learning",
  "reddit-artificial",
  "reddit-openai",
  "lesswrong",
  "alignment-forum",
  "zvi-substack",
  "tldr-ai",
  "bens-bites",
  "the-neuron",
  "last-week-in-ai",
  "simon-willison-llms",
]);

const NON_RELEASE_TITLE_PATTERN =
  /\b(?:prompting tips|rumor|forecast|should you switch|flop at|scores below|near chance|why is |how good|how we|i hope|making .* think|how .* evolved|ran neck and neck|system card|vs\.?\s|versus|fine[- ]?tune|benchmark|leaderboard|stealth models|promised|turns to|revenue|pricing tips|outlines|roadmap|defying|extract how|trained on|partner network|partnership|partnering with|incident|using |building with|guide to|policy|governance|funding|hiring|careers|recap|year in review)\b|^llm-[a-z0-9-]+ \d/i;

const RELEASE_INTENT_PATTERN =
  /\b(?:introduc(?:ing|es|ed)|launch(?:es|ed|ing)?|releas(?:es|ed|ing)?|unveil(?:s|ed|ing)?|announc(?:es|ed|ing)?|now available|is live on|open[- ]?sourc(?:es|ed|ing)|ships|debuts|weights|new (?:[\w-]+\s+){0,2}models?)\b|发布|开源|上线|正式推出/i;

const OFFICIAL_VERSIONED_MODEL_TITLE_PATTERN =
  /\b(?:gemini|gemma|imagen|veo|grok|claude|gpt|o[134]|sora|deepseek|hunyuan|hy\d|mai|phi|nemotron|cosmos|glm|kimi|mimo|qwen|qwq|wan|command|aya|mistral|mixtral|pixtral|codestral|devstral|magistral|ministral|voxtral)[-\s]+(?:v?\d|bot|opus|sonnet|haiku|flash|pro|ultra|max|mini|nano|code|cyber|image|realtime|large|small|medium|next)\b/i;

export interface WatchedModelRelease {
  key: string;
  providerId: WatchedModelProviderId;
  providerLabel: string;
  modelName: string;
  modelId: string | null;
  url: string;
  releasedAt: Date;
  origin: "openrouter" | "announcement";
  sourceLabel: string;
  contextLabel: string | null;
  pricingLabel: string | null;
  announcementUrl: string | null;
  announcementLabel: string | null;
  isNew: boolean;
}

export interface ModelReleaseDocumentCandidate {
  id: number;
  title: string;
  canonicalUrl: string;
  sourceName: string;
  sourceSlug: string;
  category: SourceCategory | string;
  storyTopic: string | null;
  sortTime: Date;
  isHidden?: boolean;
}

export function formatModelContextLength(tokens: number | null | undefined): string | null {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) {
    return null;
  }
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    const rounded = Math.abs(millions - 1) < 0.06 ? "1" : millions.toFixed(millions >= 10 ? 0 : 2).replace(/\.?0+$/, "");
    return `${rounded}M ctx`;
  }
  if (tokens >= 1_000) {
    const thousands = Math.round(tokens / 1_000);
    return `${thousands}K ctx`;
  }
  return `${Math.round(tokens)} ctx`;
}

function parsePerMillionPrice(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed * 1_000_000;
}

function formatUsd(amount: number): string {
  if (amount === 0) return "$0";
  if (amount < 0.01) return `$${amount.toFixed(3).replace(/0+$/, "")}`;
  return `$${amount.toFixed(2).replace(/\.00$/, "")}`;
}

export function formatModelPricingPerMillion(
  promptRaw: unknown,
  completionRaw: unknown,
): string | null {
  const promptPerM = parsePerMillionPrice(promptRaw);
  const completionPerM = parsePerMillionPrice(completionRaw);
  if (promptPerM === null || completionPerM === null) {
    return null;
  }
  if (promptPerM === 0 && completionPerM === 0) {
    return "Free";
  }
  return `${formatUsd(promptPerM)} / ${formatUsd(completionPerM)} per 1M`;
}

function stripLeadingProviderPrefix(rawName: string): string {
  const cleaned = rawName.trim().replace(/\s+/g, " ");
  const colonIndex = cleaned.indexOf(":");
  if (colonIndex > 0 && colonIndex <= 28) {
    const remainder = cleaned.slice(colonIndex + 1).trim();
    if (remainder.length >= 2) {
      return remainder;
    }
  }
  return cleaned;
}

function sanitizeHttpUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
  } catch {
    // Invalid URL
  }
  return null;
}

export function matchWatchedProviderFromOpenRouterId(modelId: string): WatchedModelProvider | null {
  const trimmed = modelId.trim();
  if (!trimmed || trimmed.startsWith("~") || trimmed.includes(":")) {
    return null;
  }
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0) {
    return null;
  }
  const prefix = trimmed.slice(0, slashIndex).toLowerCase();
  return PROVIDER_BY_OPENROUTER_PREFIX.get(prefix) ?? null;
}

export function extractWatchedOpenRouterModels(
  payload: unknown,
  options: {
    cutoffDate: Date;
    now?: Date | undefined;
  },
): WatchedModelRelease[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }

  const nowMs = (options.now ?? new Date()).getTime();
  const cutoffMs = options.cutoffDate.getTime();
  const releases: WatchedModelRelease[] = [];
  const seenIds = new Set<string>();

  for (const rawEntry of data) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const rawName = typeof entry.name === "string" ? entry.name.trim() : "";
    const createdSec = typeof entry.created === "number" ? entry.created : Number(entry.created);

    if (!id || !rawName || !Number.isFinite(createdSec) || createdSec <= 0) {
      continue;
    }

    const provider = matchWatchedProviderFromOpenRouterId(id);
    if (!provider) {
      continue;
    }

    const releasedAtMs = createdSec * 1000;
    if (releasedAtMs < cutoffMs || releasedAtMs > nowMs + 24 * 60 * 60 * 1000) {
      continue;
    }

    const lowerId = id.toLowerCase();
    if (seenIds.has(lowerId)) continue;
    seenIds.add(lowerId);

    const pricingObj =
      entry.pricing && typeof entry.pricing === "object"
        ? (entry.pricing as Record<string, unknown>)
        : null;
    const contextLength =
      typeof entry.context_length === "number" ? entry.context_length : null;

    releases.push({
      key: `openrouter:${lowerId}`,
      providerId: provider.id,
      providerLabel: provider.label,
      modelName: stripLeadingProviderPrefix(rawName),
      modelId: id,
      url: `https://openrouter.ai/${id}`,
      releasedAt: new Date(releasedAtMs),
      origin: "openrouter",
      sourceLabel: "OpenRouter API",
      contextLabel: formatModelContextLength(contextLength),
      pricingLabel: pricingObj
        ? formatModelPricingPerMillion(pricingObj.prompt, pricingObj.completion)
        : null,
      announcementUrl: null,
      announcementLabel: null,
      isNew: nowMs - releasedAtMs <= NEW_RELEASE_BADGE_WINDOW_MS,
    });
  }

  return releases.sort((a, b) => b.releasedAt.getTime() - a.releasedAt.getTime());
}

export async function fetchOpenRouterModelsPayload(options?: {
  apiKey?: string | null | undefined;
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}): Promise<unknown | null> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (options?.apiKey?.trim()) {
    headers.Authorization = `Bearer ${options.apiKey.trim()}`;
  }

  try {
    const response = await fetchFn(OPENROUTER_MODELS_URL, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export async function fetchWatchedOpenRouterModelReleases(options: {
  cutoffDate: Date;
  now?: Date | undefined;
  apiKey?: string | null | undefined;
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}): Promise<WatchedModelRelease[]> {
  const payload = await fetchOpenRouterModelsPayload({
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  if (!payload) {
    return [];
  }
  return extractWatchedOpenRouterModels(payload, {
    cutoffDate: options.cutoffDate,
    now: options.now,
  });
}

export function matchWatchedProviderForDocument(
  title: string,
  sourceSlug: string,
  category: string,
): WatchedModelProvider | null {
  const officialProvider = PROVIDER_BY_OFFICIAL_SLUG.get(sourceSlug.toLowerCase()) ?? null;
  if (officialProvider && category === "lab_blog") {
    return officialProvider;
  }

  for (const provider of WATCHED_MODEL_PROVIDERS) {
    if (provider.titlePattern.test(title)) {
      return provider;
    }
  }

  return null;
}

export function extractWatchedDocumentModelReleases(
  docs: readonly ModelReleaseDocumentCandidate[],
  options: {
    cutoffDate: Date;
    now?: Date;
  },
): WatchedModelRelease[] {
  const nowMs = (options.now ?? new Date()).getTime();
  const cutoffMs = options.cutoffDate.getTime();
  const results: WatchedModelRelease[] = [];

  for (const doc of docs) {
    if (doc.isHidden) continue;
    const releasedAt = doc.sortTime instanceof Date ? doc.sortTime : new Date(doc.sortTime);
    const releasedAtMs = releasedAt.getTime();
    if (Number.isNaN(releasedAtMs) || releasedAtMs < cutoffMs) {
      continue;
    }

    const title = doc.title.trim();
    if (!isHumanReadableStoryTitle(title)) {
      continue;
    }

    const lowerSlug = doc.sourceSlug.toLowerCase();
    if (EXCLUDED_ANNOUNCEMENT_SOURCES.has(lowerSlug)) {
      continue;
    }

    const isOfficialLabPost =
      doc.category === "lab_blog" && PROVIDER_BY_OFFICIAL_SLUG.has(lowerSlug);

    if (!isOfficialLabPost && doc.storyTopic !== "models") {
      continue;
    }

    if (NON_RELEASE_TITLE_PATTERN.test(title)) {
      continue;
    }

    const hasOfficialModelTitle =
      isOfficialLabPost && title.length <= 80 && OFFICIAL_VERSIONED_MODEL_TITLE_PATTERN.test(title);
    if (!RELEASE_INTENT_PATTERN.test(title) && !hasOfficialModelTitle) {
      continue;
    }

    const provider = matchWatchedProviderForDocument(title, lowerSlug, String(doc.category));
    if (!provider) {
      continue;
    }

    const safeUrl = sanitizeHttpUrl(doc.canonicalUrl);
    if (!safeUrl) {
      continue;
    }

    results.push({
      key: `doc:${doc.id}`,
      providerId: provider.id,
      providerLabel: provider.label,
      modelName: title,
      modelId: null,
      url: safeUrl,
      releasedAt,
      origin: "announcement",
      sourceLabel: doc.sourceName,
      contextLabel: null,
      pricingLabel: null,
      announcementUrl: isOfficialLabPost ? safeUrl : null,
      announcementLabel: isOfficialLabPost ? doc.sourceName : null,
      isNew: nowMs - releasedAtMs <= NEW_RELEASE_BADGE_WINDOW_MS,
    });
  }

  return results.sort((a, b) => {
    const aOfficial = a.announcementUrl ? 1 : 0;
    const bOfficial = b.announcementUrl ? 1 : 0;
    const dayDiff =
      Math.floor(b.releasedAt.getTime() / (24 * 60 * 60 * 1000)) -
      Math.floor(a.releasedAt.getTime() / (24 * 60 * 60 * 1000));
    if (dayDiff !== 0) return dayDiff;
    if (bOfficial !== aOfficial) return bOfficial - aOfficial;
    return b.releasedAt.getTime() - a.releasedAt.getTime();
  });
}

function significantModelTokens(text: string): string[] {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "now",
    "new",
    "available",
    "model",
    "models",
    "introducing",
    "releases",
    "release",
    "released",
    "launches",
    "launch",
    "launched",
    "announces",
    "unveils",
    "ships",
    "preview",
    "official",
    "weights",
    "open",
    "live",
    "api",
    "gateway",
    "together",
    "ai",
  ]);
  return normalizeStoryTitle(text)
    .split(/\s+/)
    .filter((token) => token.length > 0 && !stopWords.has(token));
}

function announcementMatchesOpenRouterModel(
  announcement: WatchedModelRelease,
  openRouterModel: WatchedModelRelease,
): boolean {
  if (announcement.providerId !== openRouterModel.providerId) {
    return false;
  }

  const normalizedTitle = ` ${normalizeStoryTitle(announcement.modelName)} `;
  const modelTokens = significantModelTokens(openRouterModel.modelName);
  if (modelTokens.length === 0) {
    return false;
  }

  const matchedTokens = modelTokens.filter((token) => normalizedTitle.includes(` ${token} `));
  if (matchedTokens.length === modelTokens.length) {
    return true;
  }

  // Handle combined release posts like "OpenAI launches GPT-6.2 Astra and Sol" matching "GPT-6.2 Astra Pro"
  const coreTokens = modelTokens.filter((token) => token !== "pro" && token !== "mini" && token !== "flash");
  if (coreTokens.length >= 2) {
    const matchedCore = coreTokens.filter((token) => normalizedTitle.includes(` ${token} `));
    if (matchedCore.length === coreTokens.length) {
      return true;
    }
  }

  return false;
}

export function mergeWatchedModelReleases(
  openRouterReleases: readonly WatchedModelRelease[],
  documentReleases: readonly WatchedModelRelease[],
  options?: { limit?: number },
): WatchedModelRelease[] {
  const limit = options?.limit ?? 12;
  const mergedOpenRouter = openRouterReleases.map((item) => ({ ...item }));
  const extraAnnouncements: WatchedModelRelease[] = [];
  const seenAnnouncementTitles = new Set<string>();

  for (const announcement of documentReleases) {
    const matchedModels = mergedOpenRouter.filter((model) =>
      announcementMatchesOpenRouterModel(announcement, model),
    );

    if (matchedModels.length > 0) {
      // Attach official lab blog post URL onto matching OpenRouter models instead of duplicating rows
      if (announcement.announcementUrl) {
        for (const model of matchedModels) {
          if (!model.announcementUrl) {
            model.announcementUrl = announcement.announcementUrl;
            model.announcementLabel = announcement.announcementLabel;
          }
        }
      }
      continue;
    }

    const normalizedTitle = normalizeStoryTitle(announcement.modelName);
    if (normalizedTitle && seenAnnouncementTitles.has(normalizedTitle)) {
      continue;
    }

    const duplicateAnnouncement = extraAnnouncements.some((existing) => {
      if (existing.providerId !== announcement.providerId) return false;
      const existingTokens = significantModelTokens(existing.modelName);
      const nextTokens = significantModelTokens(announcement.modelName);
      if (existingTokens.length === 0 || nextTokens.length === 0) return false;
      const overlap = nextTokens.filter((t) => existingTokens.includes(t));
      return overlap.length >= Math.min(3, Math.min(existingTokens.length, nextTokens.length));
    });
    if (duplicateAnnouncement) {
      continue;
    }

    if (normalizedTitle) {
      seenAnnouncementTitles.add(normalizedTitle);
    }
    extraAnnouncements.push({ ...announcement });
  }

  return [...mergedOpenRouter, ...extraAnnouncements]
    .sort((a, b) => {
      const timeDiff = b.releasedAt.getTime() - a.releasedAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      if (a.origin !== b.origin) return a.origin === "openrouter" ? -1 : 1;
      return a.modelName.localeCompare(b.modelName);
    })
    .slice(0, limit);
}
