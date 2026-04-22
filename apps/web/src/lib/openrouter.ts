import { loadWebEnv } from "@/lib/env";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export interface InterestRankingCandidate {
  id: number;
  title: string;
  previewParagraph: string;
}

export interface InterestRankingSelection {
  documentId: number;
  score: number;
  whyRelevant: string;
}

export interface InterestRankingResponse {
  shortlistSummary: string;
  selectedDocuments: InterestRankingSelection[];
}

const MAX_CANDIDATE_TEXT_CHARS = 2000;

function truncateToLimit(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

function buildCandidateList(candidates: InterestRankingCandidate[]) {
  return candidates
    .map((candidate) => {
      const entry = [
        `ID: ${candidate.id}`,
        `Title: ${candidate.title}`,
        `First paragraph: ${candidate.previewParagraph || "No first paragraph was available."}`,
      ].join("\n");
      return truncateToLimit(entry, MAX_CANDIDATE_TEXT_CHARS);
    })
    .join("\n\n---\n\n");
}

function extractJson(rawText: string): string {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{")) return trimmed;

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) return match[0];

  throw new SyntaxError(`No JSON object found in LLM response: ${trimmed.slice(0, 200)}...`);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function chatCompletion(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
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

  const body = JSON.stringify({
    model: env.openRouterModel,
    temperature: 0.1,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.log(`[openrouter] Retry ${attempt}/${MAX_RETRIES} after ${backoff}ms`);
      await sleep(backoff);
    }

    let response: Response;
    try {
      response = await fetch(OPENROUTER_CHAT_URL, {
        method: "POST",
        cache: "no-store",
        headers,
        body,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Network error");
      continue;
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const errorObj = payload?.error;
      const errorMessage =
        errorObj && typeof errorObj === "object" && typeof (errorObj as Record<string, unknown>).message === "string"
          ? ((errorObj as Record<string, unknown>).message as string)
          : `OpenRouter request failed with HTTP ${response.status}`;

      if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
        console.warn(`[openrouter] HTTP ${response.status}: ${errorMessage} (will retry)`);
        lastError = new Error(errorMessage);
        continue;
      }

      throw new Error(errorMessage);
    }

    const payload = (await response.json()) as Record<string, unknown>;

    const choices = payload.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error("OpenRouter returned no choices");
    }

    const firstChoice = choices[0] as Record<string, unknown>;
    const message = firstChoice.message as Record<string, unknown> | undefined;
    const content = typeof message?.content === "string" ? message.content.trim() : null;

    if (!content) {
      throw new Error("OpenRouter returned empty content");
    }

    return {
      content,
      model: typeof payload.model === "string" ? payload.model : env.openRouterModel,
      responseId: typeof payload.id === "string" ? payload.id : null,
    };
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
          const whyRelevant = typeof record.whyRelevant === "string" ? record.whyRelevant.trim() : "";

          if (!Number.isInteger(documentId) || !Number.isFinite(score) || !whyRelevant) {
            return null;
          }

          return {
            documentId,
            score: Math.max(1, Math.min(100, Math.round(score))),
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

const SYSTEM_PROMPT = [
  "You rank AI and software news stories against one user's stated interests.",
  "Use only each story title and first paragraph.",
  "Select the 10 most relevant stories from the candidate list.",
  "Prefer direct matches to the user's domains, workflows, pain points, tools, companies, and product priorities.",
  "Do not invent document IDs and do not include any IDs that are not present in the input.",
  "For each selected story, write a 'whyRelevant' explanation in 2 or 3 sentences.",
  "Keep every explanation grounded in the supplied text only, and connect it back to the user's saved interests.",
  "You MUST respond with ONLY a valid JSON object, no other text before or after.",
  'The JSON must have this exact shape: {"shortlistSummary": "...", "selectedDocuments": [{"documentId": <int>, "score": <int 1-100>, "whyRelevant": "..."}]}',
].join(" ");

export async function rankDocumentsForInterest({
  interestStatement,
  profileSlug,
  windowLabel,
  candidates,
}: {
  interestStatement: string;
  profileSlug: string;
  windowLabel: string;
  candidates: InterestRankingCandidate[];
}) {
  const userMessage = [
    `User interest profile:\n${interestStatement}`,
    `Window:\n${windowLabel}`,
    `Candidates:\n${buildCandidateList(candidates)}`,
  ].join("\n\n");

  const result = await chatCompletion(SYSTEM_PROMPT, userMessage, 2000);
  const ranking = parseRankingResponse(result.content);

  return {
    model: result.model,
    responseId: result.responseId,
    ranking,
  };
}

export interface BatchScoreResult {
  documentId: number;
  score: number;
  whyRelevant: string;
}

const BATCH_SCORE_SYSTEM_PROMPT = [
  "You score AI and software news stories against one user's stated interests.",
  "Use only each story title and first paragraph.",
  "Score EVERY document in the candidate list on a 1-100 relevance scale.",
  "Prefer direct matches to the user's domains, workflows, pain points, tools, companies, and product priorities.",
  "Do not invent document IDs and do not include any IDs that are not present in the input.",
  "For each document, write a 'whyRelevant' explanation in 1 or 2 sentences.",
  "Keep every explanation grounded in the supplied text only, and connect it back to the user's saved interests.",
  "You MUST respond with ONLY a valid JSON object, no other text before or after.",
  'The JSON must have this exact shape: {"scores": [{"documentId": <int>, "score": <int 1-100>, "whyRelevant": "..."}]}',
].join(" ");

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
      const whyRelevant = typeof record.whyRelevant === "string" ? record.whyRelevant.trim() : "";

      if (!Number.isInteger(documentId) || !Number.isFinite(score) || !whyRelevant) return null;

      return {
        documentId,
        score: Math.max(1, Math.min(100, Math.round(score))),
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
  const userMessage = [
    `User interest profile:\n${interestStatement}`,
    `Documents to score:\n${buildCandidateList(candidates)}`,
  ].join("\n\n");

  const result = await chatCompletion(BATCH_SCORE_SYSTEM_PROMPT, userMessage, 4000);
  const scores = parseBatchScoreResponse(result.content);

  return { model: result.model, scores };
}
