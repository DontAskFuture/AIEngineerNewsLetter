import { decideRetry } from "./openrouter-retry";
import {
  formatWhyRelevant,
  MAX_INTEREST_STATEMENT_LENGTH,
  normalizeStoryTitle,
  parseWhyRelevantMetadata,
  TAKE_WITHHELD_TEXT,
  isTakePlaceholder,
  type ScoreConfidence,
} from "./prompts";
import { scoringConfig } from "./scoring-config";

/**
 * Story topics Jev assigns so the top-stories shortlist can mix subjects
 * instead of filling up with one kind of announcement.
 *
 * The keys are stored on `documents.story_topic`. Descriptions are the choice
 * criteria sent to Jev, so they are the classification spec.
 */
export const STORY_TOPICS = {
  models:
    "A new or updated model, weights, checkpoint, architecture announcement, or benchmark leaderboard.",
  research:
    "A paper, training method, or evaluation result that is not primarily a product or model launch.",
  infrastructure:
    "Inference, serving, GPUs, compilers, training systems, or deployment tooling.",
  agents: "Agents, tool use, coding assistants, or orchestration workflows.",
  products: "A product launch, API, pricing change, or platform announcement.",
  practice: "An engineering how-to, postmortem, or production workflow for people building with AI.",
  industry: "Funding, acquisitions, policy, regulation, or organizational news.",
  other: "None of the topics above.",
} as const;

export type StoryTopic = keyof typeof STORY_TOPICS;

const STORY_TOPIC_KEYS = new Set<string>(Object.keys(STORY_TOPICS));

/** Unclassified or unrecognized topics share one bucket so they cannot flood the shortlist. */
export const UNCATEGORIZED_TOPIC_KEY = "uncategorized";

/** Top-10 shortlists keep at most this many stories from one topic before backfilling. */
export const MAX_TOP_STORIES_PER_TOPIC = 2;

export const OFF_TOPIC_WHY_RELEVANT = "Off-topic for this profile.";

/** Stored on document_scores.opinion_model when the score is too low for a take. */
export const OPINION_NOT_REQUIRED = "not_required";

/**
 * Ordered relevance levels, lowest first. Jev returns a probability-weighted
 * index on this scale. The anchors match the historical 1-100 rubric bands
 * (off-topic, adjacent, strong, direct) so `score >= 40` still means the
 * story can appear in the top stories.
 */
export const RELEVANCE_LEVELS = [
  "Off-topic or low-signal for this profile: no concrete link in the supplied text, or generic funding, hiring, consumer news, or vague commentary.",
  "Adjacent or partial match: general AI or software news with only an indirect or high-level link to the profile.",
  "Strong thematic match: clearly useful to the profile's domain or workflows, but less directly actionable or missing deep specifics.",
  "Direct actionable match: concrete specifics on a tool, workflow, bottleneck, pricing shift, or system the profile names.",
] as const;

const RELEVANCE_LEVEL_SCORES = [20, 55, 80, 95] as const;

const JEV_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const MAX_TITLE_CHARS = 240;
const MAX_EXCERPT_CHARS = 1200;
const MAX_SOURCE_CHARS = 160;

export function isStoryTopic(value: string | null | undefined): value is StoryTopic {
  return typeof value === "string" && STORY_TOPIC_KEYS.has(value);
}

export function storyTopicKey(topic: string | null | undefined): string {
  return isStoryTopic(topic) ? topic : UNCATEGORIZED_TOPIC_KEY;
}

export function storyTopicAtCap(
  counts: ReadonlyMap<string, number>,
  topic: string | null | undefined,
  maxPerTopic: number = MAX_TOP_STORIES_PER_TOPIC,
): boolean {
  return (counts.get(storyTopicKey(topic)) ?? 0) >= maxPerTopic;
}

export function recordStoryTopic(
  counts: Map<string, number>,
  topic: string | null | undefined,
): void {
  const key = storyTopicKey(topic);
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

export interface DiverseShortlistStory {
  id: number;
  title: string;
  sourceGroupKey: string;
  storyTopic: string | null;
  isPinned: boolean;
  isHidden: boolean;
}

/**
 * Picks the daily shortlist. Pins go first and bypass the topic cap. Unpinned
 * stories then fill the list with at most `maxPerTopic` from one topic and
 * `maxPerSource` from one source family. A short list backfills past the topic
 * cap. Input order is the rank order within pins and within the rest.
 */
export function selectDiverseShortlist<T extends DiverseShortlistStory>(
  stories: readonly T[],
  options?: {
    limit?: number;
    maxPerSource?: number;
    maxPerTopic?: number;
  },
): T[] {
  const limit = options?.limit ?? scoringConfig.dailyTakeCount;
  const maxPerSource = options?.maxPerSource ?? scoringConfig.dailyTakeMaxPerSource;
  const maxPerTopic = options?.maxPerTopic ?? MAX_TOP_STORIES_PER_TOPIC;
  const sourceCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  const seenIds = new Set<number>();
  const seenTitles = new Set<string>();
  const selected: T[] = [];

  const pinnedStories = stories.filter((story) => story.isPinned && !story.isHidden);
  const regularStories = stories.filter((story) => !story.isPinned && !story.isHidden);

  const tryAdd = (story: T, relaxTopic: boolean) => {
    if (selected.length >= limit || seenIds.has(story.id)) return;

    const normalizedTitle = normalizeStoryTitle(story.title);
    if (normalizedTitle && seenTitles.has(normalizedTitle)) return;

    const count = sourceCounts.get(story.sourceGroupKey) ?? 0;
    if (!story.isPinned && count >= maxPerSource) return;
    if (!story.isPinned && !relaxTopic && storyTopicAtCap(topicCounts, story.storyTopic, maxPerTopic)) {
      return;
    }

    selected.push(story);
    seenIds.add(story.id);
    sourceCounts.set(story.sourceGroupKey, count + 1);
    recordStoryTopic(topicCounts, story.storyTopic);
    if (normalizedTitle) seenTitles.add(normalizedTitle);
  };

  for (const story of pinnedStories) tryAdd(story, true);
  for (const story of regularStories) tryAdd(story, false);
  if (selected.length < limit) {
    for (const story of regularStories) tryAdd(story, true);
  }

  return selected;
}

export function hasStoredPractitionerTake(
  whyRelevant: string | null | undefined,
  opinionModel: string | null | undefined,
): boolean {
  if (opinionModel && opinionModel !== OPINION_NOT_REQUIRED) return true;
  const cleaned = parseWhyRelevantMetadata(whyRelevant).whyRelevant.trim();
  if (!cleaned || isTakePlaceholder(cleaned) || cleaned === OFF_TOPIC_WHY_RELEVANT) return false;
  return true;
}

export function mapJevConfidence(confidence: number | null | undefined): ScoreConfidence {
  if (confidence == null || !Number.isFinite(confidence)) return "low";
  if (confidence >= 0.66) return "high";
  if (confidence >= 0.4) return "medium";
  return "low";
}

/**
 * Maps Jev's probability-weighted level index onto the 1-100 score the feed
 * already ranks with. A low-confidence decision is capped at 65 so a shaky
 * call cannot outrank a well-supported one.
 */
export function mapJevRelevanceScore(
  position: number,
  confidence: number | null | undefined,
): { score: number; confidence: ScoreConfidence } {
  const levels = RELEVANCE_LEVEL_SCORES;
  const maxIndex = levels.length - 1;
  const clamped = Math.max(0, Math.min(maxIndex, Number.isFinite(position) ? position : 0));
  const lower = Math.floor(clamped);
  const upper = Math.min(maxIndex, lower + 1);
  const fraction = clamped - lower;
  const interpolated = levels[lower]! * (1 - fraction) + levels[upper]! * fraction;
  let score = Math.max(1, Math.min(100, Math.round(interpolated)));
  const band = mapJevConfidence(confidence);
  if (band === "low" && score > 65) score = 65;
  return { score, confidence: band };
}

export interface StoryRelevanceInput {
  id: number;
  title: string;
  excerpt: string;
  sourceName: string;
  sourceCategory: string;
  /** When set, the topic question is skipped and this value is kept. */
  storyTopic: string | null;
}

export interface JevDecisionsRequest {
  model: string;
  state: {
    title: string;
    source: string;
    excerpt: string;
  };
  questions: {
    topic?: {
      type: "choice";
      instructions: string;
      criteria: typeof STORY_TOPICS;
    };
    relevance?: {
      type: "score";
      instructions: string;
      criteria: readonly string[];
    };
  };
}

function clip(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).trim();
}

export function buildStoryDecisionRequest({
  story,
  interestStatement,
}: {
  story: StoryRelevanceInput;
  interestStatement: string;
}): JevDecisionsRequest {
  const profile = clip(interestStatement, MAX_INTEREST_STATEMENT_LENGTH);
  const includeTopic = !isStoryTopic(story.storyTopic);
  const source = clip(
    `${story.sourceName || "Unknown"} (${story.sourceCategory || "unknown"})`,
    MAX_SOURCE_CHARS,
  );

  const questions: JevDecisionsRequest["questions"] = {
    relevance: {
      type: "score",
      instructions: [
        "How relevant is this story to the reader profile below?",
        "Judge only the title, source, and excerpt in state.",
        "If the profile says to ignore, avoid, or that the reader is not interested in what this story is about, choose the lowest level.",
        "Do not raise the level just because the source is well known.",
        "Short release notes from github, engineering_blog, or lab_blog still count when they match the profile.",
        "research_feed items belong in the top two levels only when the profile asks for research or the paper addresses a bottleneck the profile names.",
        "community_feed items need concrete technical substance in the excerpt, not a clickbait title.",
        "",
        "Profile:",
        profile || "General AI engineering: models, agents, inference, and production tooling.",
      ].join("\n"),
      criteria: RELEVANCE_LEVELS,
    },
  };

  if (includeTopic) {
    questions.topic = {
      type: "choice",
      instructions: "Which single topic best describes this story? Choose other when none of the specific topics fit.",
      criteria: STORY_TOPICS,
    };
  }

  return {
    model: scoringConfig.jevModel,
    state: {
      title: clip(story.title, MAX_TITLE_CHARS) || "Untitled",
      source,
      excerpt: clip(story.excerpt, MAX_EXCERPT_CHARS) || "No excerpt was supplied.",
    },
    questions,
  };
}

export interface ParsedStoryRelevance {
  documentId: number;
  score: number;
  confidence: ScoreConfidence;
  /** Null when this call did not classify, or Jev returned an unknown choice. */
  topic: StoryTopic | null;
  model: string;
}

export function buildTopicDecisionRequest(story: StoryRelevanceInput): JevDecisionsRequest {
  return {
    model: scoringConfig.jevModel,
    state: {
      title: clip(story.title, MAX_TITLE_CHARS) || "Untitled",
      source: clip(`${story.sourceName || "Unknown"} (${story.sourceCategory || "unknown"})`, MAX_SOURCE_CHARS),
      excerpt: clip(story.excerpt, MAX_EXCERPT_CHARS) || "No excerpt was supplied.",
    },
    questions: {
      topic: {
        type: "choice",
        instructions: "Which single topic best describes this story? Choose other when none of the specific topics fit.",
        criteria: STORY_TOPICS,
      },
    },
  };
}

export function parseJevTopic(payload: unknown): StoryTopic | null {
  if (!payload || typeof payload !== "object") return null;
  const answers = (payload as Record<string, unknown>).answers;
  if (!answers || typeof answers !== "object") return null;
  const topicAnswer = (answers as Record<string, unknown>).topic;
  if (!topicAnswer || typeof topicAnswer !== "object") return null;
  const choice = (topicAnswer as Record<string, unknown>).choice;
  if (typeof choice === "string" && isStoryTopic(choice)) return choice;
  return null;
}

export async function classifyStoryTopicsBatch({
  apiKey,
  stories,
  fetchImpl,
  referer,
  title,
  concurrency = scoringConfig.jevConcurrency,
  timeoutMs,
  maxRetries,
  sleepImpl,
}: {
  apiKey: string;
  stories: readonly StoryRelevanceInput[];
  fetchImpl?: typeof fetch;
  referer?: string;
  title?: string;
  concurrency?: number;
  timeoutMs?: number;
  maxRetries?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}): Promise<Array<{ documentId: number; topic: StoryTopic | null }>> {
  return mapWithConcurrency(stories, concurrency, async (story) => {
    try {
      const payload = await requestJevDecision({
        apiKey,
        request: buildTopicDecisionRequest(story),
        ...(fetchImpl ? { fetchImpl } : {}),
        ...(referer ? { referer } : {}),
        ...(title ? { title } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(maxRetries !== undefined ? { maxRetries } : {}),
        ...(sleepImpl ? { sleepImpl } : {}),
      });
      return { documentId: story.id, topic: parseJevTopic(payload) };
    } catch {
      return { documentId: story.id, topic: null };
    }
  });
}

export function parseJevStoryDecision(
  payload: unknown,
  documentId: number,
): ParsedStoryRelevance {
  if (!payload || typeof payload !== "object") {
    throw new SyntaxError("Jev response is not an object");
  }

  const record = payload as Record<string, unknown>;
  const answers = record.answers;
  if (!answers || typeof answers !== "object") {
    throw new SyntaxError("Jev response is missing answers");
  }

  const answerRecord = answers as Record<string, unknown>;
  const relevance = answerRecord.relevance;
  if (!relevance || typeof relevance !== "object") {
    throw new SyntaxError("Jev response is missing the relevance answer");
  }

  const relevanceRecord = relevance as Record<string, unknown>;
  if (relevanceRecord.type !== "score" || typeof relevanceRecord.score !== "number") {
    throw new SyntaxError("Jev relevance answer is not a score");
  }

  const confidenceValue =
    typeof relevanceRecord.confidence === "number" ? relevanceRecord.confidence : null;
  const mapped = mapJevRelevanceScore(relevanceRecord.score, confidenceValue);

  let topic: StoryTopic | null = null;
  const topicAnswer = answerRecord.topic;
  if (topicAnswer && typeof topicAnswer === "object") {
    const topicRecord = topicAnswer as Record<string, unknown>;
    if (topicRecord.type === "choice" && isStoryTopic(typeof topicRecord.choice === "string" ? topicRecord.choice : null)) {
      topic = topicRecord.choice as StoryTopic;
    }
  }

  const model = typeof record.model === "string" && record.model.trim()
    ? record.model.trim()
    : scoringConfig.jevModel;

  return {
    documentId,
    score: mapped.score,
    confidence: mapped.confidence,
    topic,
    model,
  };
}

export interface StoredRelevance {
  whyRelevant: string;
  opinionModel: string | null;
  needsOpinion: boolean;
}

export function relevanceStorage(decision: {
  score: number;
  confidence: ScoreConfidence;
}): StoredRelevance {
  const note = decision.score >= scoringConfig.minOpinionScore
    ? TAKE_WITHHELD_TEXT
    : OFF_TOPIC_WHY_RELEVANT;

  return {
    whyRelevant: formatWhyRelevant({
      whyRelevant: note,
      confidence: decision.confidence,
      matchedSignals: [],
    }),
    opinionModel: OPINION_NOT_REQUIRED,
    needsOpinion: false,
  };
}

export function applyOpinionToStoredWhyRelevant({
  existingWhyRelevant,
  opinion,
  matchedSignals,
}: {
  existingWhyRelevant: string;
  opinion: string;
  matchedSignals: string[];
}): string {
  const parsed = parseWhyRelevantMetadata(existingWhyRelevant);
  return formatWhyRelevant({
    whyRelevant: opinion.trim(),
    confidence: parsed.confidence,
    matchedSignals,
  });
}

export interface StoryRelevanceSuccess extends ParsedStoryRelevance, StoredRelevance {
  ok: true;
}

export interface StoryRelevanceFailure {
  ok: false;
  documentId: number;
  error: string;
}

export type StoryRelevanceOutcome = StoryRelevanceSuccess | StoryRelevanceFailure;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!, index);
    }
  }

  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export interface DecisionError {
  message: string;
  status: number;
}

export function extractDecisionError(payload: unknown): DecisionError | null {
  if (!payload || typeof payload !== "object") {
    return { message: "Jev returned a malformed payload", status: 502 };
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>;
    const code = errorRecord.code;
    const message = typeof errorRecord.message === "string" && errorRecord.message.trim()
      ? errorRecord.message.trim()
      : "Jev request failed";
    return {
      message,
      status: typeof code === "number" && Number.isFinite(code) ? code : 502,
    };
  }

  if (!record.answers || typeof record.answers !== "object") {
    return { message: "Jev returned no answers", status: 502 };
  }

  return null;
}

export async function requestJevDecision({
  apiKey,
  request,
  fetchImpl = fetch,
  referer = "http://localhost:3000",
  title = "AI Builder Intelligence",
  timeoutMs = scoringConfig.jevTimeoutMs,
  maxRetries = scoringConfig.jevMaxRetries,
  sleepImpl = sleep,
}: {
  apiKey: string;
  request: JevDecisionsRequest;
  fetchImpl?: typeof fetch;
  referer?: string;
  title?: string;
  timeoutMs?: number;
  maxRetries?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}): Promise<unknown> {
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": referer,
    "X-Title": title,
  };
  const body = JSON.stringify(request);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      await sleepImpl(1000 * 2 ** (attempt - 1));
    }

    let response: Response;
    try {
      response = await fetchImpl(JEV_DECISIONS_URL, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Network error");
      continue;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Response body error");
      if (decideRetry({ status: 502, attempt, maxRetries, isFreeTier: false }) === "retry") {
        continue;
      }
      break;
    }

    if (!response.ok) {
      const decisionError = extractDecisionError(payload);
      const message = decisionError?.message ?? `Jev request failed with HTTP ${response.status}`;
      lastError = new Error(message);
      if (decideRetry({ status: response.status, attempt, maxRetries, isFreeTier: false }) === "retry") {
        continue;
      }
      break;
    }

    const bodyError = extractDecisionError(payload);
    if (bodyError) {
      lastError = new Error(bodyError.message);
      if (decideRetry({ status: bodyError.status, attempt, maxRetries, isFreeTier: false }) === "retry") {
        continue;
      }
      break;
    }

    return payload;
  }

  throw lastError ?? new Error("Jev request failed");
}

export async function decideStoryRelevanceBatch({
  apiKey,
  interestStatement,
  stories,
  fetchImpl,
  referer,
  title,
  concurrency = scoringConfig.jevConcurrency,
  timeoutMs,
  maxRetries,
  sleepImpl,
}: {
  apiKey: string;
  interestStatement: string;
  stories: readonly StoryRelevanceInput[];
  fetchImpl?: typeof fetch;
  referer?: string;
  title?: string;
  concurrency?: number;
  timeoutMs?: number;
  maxRetries?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}): Promise<StoryRelevanceOutcome[]> {
  return mapWithConcurrency(stories, concurrency, async (story) => {
    try {
      const request = buildStoryDecisionRequest({ story, interestStatement });
      const payload = await requestJevDecision({
        apiKey,
        request,
        ...(fetchImpl ? { fetchImpl } : {}),
        ...(referer ? { referer } : {}),
        ...(title ? { title } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(maxRetries !== undefined ? { maxRetries } : {}),
        ...(sleepImpl ? { sleepImpl } : {}),
      });
      const parsed = parseJevStoryDecision(payload, story.id);
      const stored = relevanceStorage(parsed);
      return {
        ok: true as const,
        ...parsed,
        topic: parsed.topic ?? (isStoryTopic(story.storyTopic) ? story.storyTopic : null),
        ...stored,
      };
    } catch (error) {
      return {
        ok: false as const,
        documentId: story.id,
        error: error instanceof Error ? error.message : "Jev request failed",
      };
    }
  });
}
