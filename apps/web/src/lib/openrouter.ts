import {
  ScoringModelPool,
  decideRetry,
  extractBodyError,
  isFreeTierModel,
  renderRankDocumentsPrompt,
  renderScoreDocumentsPrompt,
  renderSummarizeTopStoriesPrompt,
  selectSummaryModelCandidates,
  type TopStoriesSummaryCandidate,
} from "@ai-intel/shared";
import { loadWebEnv } from "@/lib/env";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
// Free-pool endpoints can hang indefinitely, so every request is bounded and a
// timeout is treated like any other model failure.
const REQUEST_TIMEOUT_MS = 60_000;

export interface InterestRankingCandidate {
  id: number;
  title: string;
  previewParagraph: string;
  sourceName?: string | null;
  sourceCategory?: string | null;
  publishedAt?: string | Date | null;
}

export interface InterestRankingSelection {
  documentId: number;
  score: number;
  confidence: "high" | "medium" | "low" | null;
  matchedSignals: string[];
  whyRelevant: string;
}

export interface InterestRankingResponse {
  shortlistSummary: string;
  selectedDocuments: InterestRankingSelection[];
}

export interface ProfileTopStoriesSummaryResponse {
  summary: string;
  takeaways: string[];
  furtherStudy: string;
}

function extractJson(rawText: string): string {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{")) return trimmed;

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) return match[0];

  throw new SyntaxError(`No JSON object found in LLM response: ${trimmed.slice(0, 200)}...`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Health state is per-process, so the pool is a module-level singleton: a model
// that exhausted its quota on one batch must still be parked on the next.
let scoringPool: ScoringModelPool | null = null;

function getScoringPool(): ScoringModelPool {
  const env = loadWebEnv();
  scoringPool ??= new ScoringModelPool({
    apiKey: env.openRouterApiKey,
    onWarn: (message) => console.warn(`[openrouter] ${message}`),
  });
  return scoringPool;
}

/** Refreshed discovery plus health-filtered order, with the env model last. */
async function resolveScoringCandidates(): Promise<{ models: string[]; pool: ScoringModelPool }> {
  const env = loadWebEnv();
  const pool = getScoringPool();
  await pool.refresh();
  return { models: [...pool.candidates(), env.openRouterModel], pool };
}

async function chatCompletion(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  modelCandidates?: string[],
  pool?: ScoringModelPool,
): Promise<{ content: string; model: string; responseId: string | null }> {
  const env = loadWebEnv();

  if (!env.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const headers = {
    Authorization: `Bearer ${env.openRouterApiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": env.appBaseUrl ?? "http://localhost:3000",
    "X-Title": "AI Builder Intelligence",
  };

  const models = Array.from(new Set(modelCandidates?.length ? modelCandidates : [env.openRouterModel]));
  let lastError: Error | null = null;

  for (const model of models) {
    const freeTier = isFreeTierModel(model);
    const body = JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.log(`[openrouter] Retry ${attempt}/${MAX_RETRIES} for ${model} after ${backoff}ms`);
        await sleep(backoff);
      }

      let response: Response;
      try {
        response = await fetch(OPENROUTER_CHAT_URL, {
          method: "POST",
          cache: "no-store",
          headers,
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Network error");
        if (freeTier) {
          // Timeouts and connection failures are transient, not entitlement problems.
          pool?.recordFailure(model, 408);
          console.warn(`[openrouter] ${model} network failure: ${lastError.message}`);
          break;
        }
        continue;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const errorObj = payload?.error;
        const errorMessage =
          errorObj && typeof errorObj === "object" && typeof (errorObj as Record<string, unknown>).message === "string"
            ? ((errorObj as Record<string, unknown>).message as string)
            : `OpenRouter request failed with HTTP ${response.status}`;

        lastError = new Error(errorMessage);

        const decision = decideRetry({
          status: response.status,
          attempt,
          maxRetries: MAX_RETRIES,
          isFreeTier: freeTier,
        });

        if (decision === "retry") {
          console.warn(`[openrouter] ${model} HTTP ${response.status}: ${errorMessage} (will retry)`);
          continue;
        }

        pool?.recordFailure(model, response.status);
        if (response.status === 429 && freeTier) {
          console.log(`[openrouter] ${model} free-tier quota exhausted, parked and falling through`);
        } else {
          console.warn(`[openrouter] ${model} failed: ${errorMessage}`);
        }
        break;
      }

      const payload = (await response.json()) as Record<string, unknown>;

      // OpenRouter reports upstream provider failures as HTTP 200 with an
      // `error` body, so this must be handled as a model failure (fall through
      // to the next candidate) rather than thrown out of the candidate loop.
      const bodyError = extractBodyError(payload);
      if (bodyError) {
        lastError = new Error(bodyError.message);

        const decision = decideRetry({
          status: bodyError.status,
          attempt,
          maxRetries: MAX_RETRIES,
          isFreeTier: freeTier,
        });

        if (decision === "retry") {
          console.warn(`[openrouter] ${model} upstream error: ${bodyError.message} (will retry)`);
          continue;
        }

        pool?.recordFailure(model, bodyError.status);
        console.warn(`[openrouter] ${model} unavailable: ${bodyError.message}`);
        break;
      }

      const choices = payload.choices as unknown[];
      const firstChoice = choices[0] as Record<string, unknown>;
      const message = firstChoice.message as Record<string, unknown> | undefined;
      const content = typeof message?.content === "string" ? message.content.trim() : null;

      if (!content) {
        lastError = new Error("OpenRouter returned empty content");
        pool?.recordFailure(model, 502);
        console.warn(`[openrouter] ${model} returned empty content`);
        break;
      }

      pool?.recordSuccess(model);

      return {
        content,
        model: typeof payload.model === "string" ? payload.model : model,
        responseId: typeof payload.id === "string" ? payload.id : null,
      };
    }
  }

  throw lastError ?? new Error("OpenRouter request failed after retries");
}

function parseRankingResponse(rawText: string) {
  const parsed = JSON.parse(extractJson(rawText)) as unknown;
  const parsedRecord = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;

  const selectedDocuments = Array.isArray(parsedRecord?.selectedDocuments)
    ? parsedRecord.selectedDocuments
        .map((selection) => {
          if (!selection || typeof selection !== "object") {
            return null;
          }

          const record = selection as Record<string, unknown>;
          const documentId = Number(record.documentId);
          const score = Number(record.score);
          const confidence = parseConfidence(record.confidence);
          const matchedSignals = parseMatchedSignals(record.matchedSignals);
          const whyRelevant = typeof record.whyRelevant === "string" ? record.whyRelevant.trim() : "";

          if (!Number.isInteger(documentId) || !Number.isFinite(score) || !whyRelevant) {
            return null;
          }

          return {
            documentId,
            score: Math.max(1, Math.min(100, Math.round(score))),
            confidence,
            matchedSignals,
            whyRelevant,
          };
        })
        .filter((selection): selection is InterestRankingSelection => selection !== null)
    : [];

  return {
    shortlistSummary:
      typeof parsedRecord?.shortlistSummary === "string" && parsedRecord.shortlistSummary.trim().length > 0
        ? parsedRecord.shortlistSummary.trim()
        : "Selected the stories that best match the saved interest profile.",
    selectedDocuments,
  } satisfies InterestRankingResponse;
}

function parseTopStoriesSummaryResponse(rawText: string): ProfileTopStoriesSummaryResponse {
  const parsed = JSON.parse(extractJson(rawText)) as unknown;
  const parsedRecord = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const summary = typeof parsedRecord?.summary === "string" ? parsedRecord.summary.trim() : "";
  const furtherStudy = typeof parsedRecord?.furtherStudy === "string" ? parsedRecord.furtherStudy.trim() : "";
  const takeaways = Array.isArray(parsedRecord?.takeaways)
    ? parsedRecord.takeaways
        .map((takeaway) => (typeof takeaway === "string" ? takeaway.trim() : ""))
        .filter(Boolean)
        .slice(0, 4)
    : [];

  return {
    summary: summary || "The current top stories are relevant to the selected profile, but no concise summary was returned.",
    takeaways,
    furtherStudy:
      furtherStudy ||
      "Use the top stories as a reading list: compare the recurring technologies, companies, and product decisions they mention, then follow the highest-signal topics into primary docs, technical posts, benchmarks, and market analysis.",
  };
}

export async function rankDocumentsForInterest({
  interestStatement,
  candidates,
}: {
  interestStatement: string;
  candidates: InterestRankingCandidate[];
}) {
  const prompt = renderRankDocumentsPrompt({ interestStatement, candidates });

  const { models, pool } = await resolveScoringCandidates();
  const result = await chatCompletion(prompt.system, prompt.user, 3500, models, pool);
  const ranking = parseRankingResponse(result.content);

  return {
    model: result.model,
    responseId: result.responseId,
    ranking,
  };
}

export async function summarizeTopStoriesForProfile({
  profileName,
  interestStatement,
  candidates,
}: {
  profileName: string;
  interestStatement: string;
  candidates: TopStoriesSummaryCandidate[];
}): Promise<{ model: string; responseId: string | null; summary: ProfileTopStoriesSummaryResponse }> {
  const prompt = renderSummarizeTopStoriesPrompt({ profileName, interestStatement, candidates });
  const env = loadWebEnv();
  const result = await chatCompletion(prompt.system, prompt.user, 2000, [
    ...selectSummaryModelCandidates(),
    env.openRouterModel,
  ]);

  return {
    model: result.model,
    responseId: result.responseId,
    summary: parseTopStoriesSummaryResponse(result.content),
  };
}

export interface BatchScoreResult {
  documentId: number;
  score: number;
  confidence: "high" | "medium" | "low" | null;
  matchedSignals: string[];
  whyRelevant: string;
}

function parseConfidence(value: unknown) {
  return value === "high" || value === "medium" || value === "low" ? value : null;
}

function parseMatchedSignals(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((signal) => (typeof signal === "string" ? signal.trim() : ""))
    .filter(Boolean)
    .slice(0, 4);
}

function parseBatchScoreResponse(rawText: string): BatchScoreResult[] {
  const parsed = JSON.parse(extractJson(rawText)) as unknown;
  const parsedRecord = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;

  const scores = Array.isArray(parsedRecord?.scores) ? parsedRecord.scores : [];

  return scores
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;

      const record = entry as Record<string, unknown>;
      const documentId = Number(record.documentId);
      const score = Number(record.score);
      const confidence = parseConfidence(record.confidence);
      const matchedSignals = parseMatchedSignals(record.matchedSignals);
      const whyRelevant = typeof record.whyRelevant === "string" ? record.whyRelevant.trim() : "";

      if (!Number.isInteger(documentId) || !Number.isFinite(score) || !whyRelevant) return null;

      return {
        documentId,
        score: Math.max(1, Math.min(100, Math.round(score))),
        confidence,
        matchedSignals,
        whyRelevant,
      };
    })
    .filter((entry): entry is BatchScoreResult => entry !== null);
}

export async function scoreDocumentBatch({
  interestStatement,
  candidates,
}: {
  interestStatement: string;
  candidates: InterestRankingCandidate[];
}): Promise<{ model: string; scores: BatchScoreResult[] }> {
  const prompt = renderScoreDocumentsPrompt({ interestStatement, candidates });

  const { models, pool } = await resolveScoringCandidates();
  const result = await chatCompletion(prompt.system, prompt.user, 4000, models, pool);
  const scores = parseBatchScoreResponse(result.content);

  return { model: result.model, scores };
}
