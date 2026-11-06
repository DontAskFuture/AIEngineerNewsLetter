import {
  ScoringModelPool,
  decideRetry,
  extractBodyError,
  isFreeTierModel,
  parseScoreDocumentsResponse,
  parseSummarizeTopStoriesResponse,
  renderScoreDocumentsPrompt,
  renderSummarizeTopStoriesPrompt,
  selectSummaryModelCandidates,
  type ParsedDocumentScore,
  type ParsedTopStoriesSummary,
  type PromptCandidate,
  type TopStoriesSummaryCandidate,
} from "@ai-intel/shared";
import { loadWebEnv } from "@/lib/env";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
// Free-pool endpoints can hang indefinitely, so every request is bounded and a
// timeout is treated like any other model failure.
const REQUEST_TIMEOUT_MS = 60_000;

export type InterestRankingCandidate = PromptCandidate;
export type BatchScoreResult = ParsedDocumentScore;
export type ProfileTopStoriesSummaryResponse = ParsedTopStoriesSummary;

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

async function chatCompletion<T>(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  parse: (content: string) => T,
  modelCandidates?: string[],
  pool?: ScoringModelPool,
): Promise<{ parsed: T; model: string; responseId: string | null }> {
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
      response_format: { type: "json_object" },
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

      let parsed: T;
      try {
        parsed = parse(content);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Invalid JSON response");
        pool?.recordFailure(model, 502);
        console.warn(`[openrouter] ${model} returned invalid JSON contract: ${lastError.message}`);
        break;
      }

      pool?.recordSuccess(model);

      return {
        parsed,
        model: typeof payload.model === "string" ? payload.model : model,
        responseId: typeof payload.id === "string" ? payload.id : null,
      };
    }
  }

  throw lastError ?? new Error("OpenRouter request failed after retries");
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
  const result = await chatCompletion(
    prompt.system,
    prompt.user,
    2000,
    parseSummarizeTopStoriesResponse,
    [...selectSummaryModelCandidates(), env.openRouterModel],
  );

  return {
    model: result.model,
    responseId: result.responseId,
    summary: result.parsed,
  };
}

export async function scoreDocumentBatch({
  profileName,
  interestStatement,
  candidates,
}: {
  profileName?: string | null | undefined;
  interestStatement: string;
  candidates: InterestRankingCandidate[];
}): Promise<{ model: string; scores: BatchScoreResult[] }> {
  const prompt = renderScoreDocumentsPrompt({
    profileName: profileName ?? null,
    interestStatement,
    candidates,
  });
  const allowedIds = new Set(candidates.map((c) => c.id));

  const { models, pool } = await resolveScoringCandidates();
  const result = await chatCompletion(
    prompt.system,
    prompt.user,
    4000,
    (content) => parseScoreDocumentsResponse(content, allowedIds),
    models,
    pool,
  );

  return { model: result.model, scores: result.parsed };
}
