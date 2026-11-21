import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@ai-intel/db";
import {
  decideRetry,
  detectNonEnglishContent,
  extractBodyError,
  extractDocumentPreview,
  isFreeTierModel,
  parseTranslateStoriesResponse,
  readDocumentTranslation,
  renderTranslateStoriesPrompt,
  selectOpinionModelCandidates,
  type DocumentTranslationMetadata,
  type ParsedStoryTranslation,
  type TranslationPromptCandidate,
} from "@ai-intel/shared";
import { loadWorkerEnv } from "../env";
import { logger } from "../logger";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const REQUEST_TIMEOUT_MS = 60_000;
const TRANSLATION_BATCH_SIZE = 12;
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_MAX_PER_RUN = 36;
const CANDIDATE_QUERY_LIMIT = 400;
const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateStoryBatchWithOpenRouter(
  candidates: readonly TranslationPromptCandidate[],
): Promise<{ model: string; translations: ParsedStoryTranslation[] }> {
  const env = loadWorkerEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  if (candidates.length === 0) {
    return { model: selectOpinionModelCandidates()[0] ?? env.OPENROUTER_MODEL, translations: [] };
  }

  const prompt = renderTranslateStoriesPrompt(candidates);
  const allowedIds = new Set(candidates.map((candidate) => candidate.id));
  const headers = {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": env.APP_BASE_URL,
    "X-Title": "AI Builder Intelligence",
  };
  const models = Array.from(new Set([...selectOpinionModelCandidates(), env.OPENROUTER_MODEL]));
  let lastError: Error | null = null;

  for (const model of models) {
    const freeTier = isFreeTierModel(model);
    const maxTokens = Math.min(8192, Math.max(2048, candidates.length * 420));
    const body = JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: maxTokens,
      reasoning: { effort: "low" },
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (attempt > 0) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.info({ attempt, backoff, model }, "Retrying OpenRouter story translation request");
        await sleep(backoff);
      }

      let response: Response;
      try {
        response = await fetch(OPENROUTER_CHAT_URL, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Network error");
        if (freeTier) {
          logger.warn({ model, msg: lastError.message }, "Translation model network failure");
          break;
        }
        continue;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const errObj = payload?.error;
        const msg =
          errObj &&
          typeof errObj === "object" &&
          typeof (errObj as Record<string, unknown>).message === "string"
            ? ((errObj as Record<string, unknown>).message as string)
            : `HTTP ${response.status}`;
        lastError = new Error(msg);
        const decision = decideRetry({
          status: response.status,
          attempt,
          maxRetries: MAX_RETRIES,
          isFreeTier: freeTier,
        });
        if (decision === "retry") {
          logger.warn({ status: response.status, msg, model }, "Retryable translation model error");
          continue;
        }
        logger.warn({ status: response.status, msg, model }, "Translation model failed");
        break;
      }

      let payload: Record<string, unknown>;
      try {
        payload = (await response.json()) as Record<string, unknown>;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Response body error");
        if (freeTier) break;
        continue;
      }

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
          logger.warn(
            { status: bodyError.status, msg: bodyError.message, model },
            "Retryable translation upstream error",
          );
          continue;
        }
        logger.warn(
          { status: bodyError.status, msg: bodyError.message, model },
          "Translation model unavailable",
        );
        break;
      }

      const choices = payload.choices as unknown[];
      const firstChoice = choices[0] as Record<string, unknown>;
      const message = firstChoice.message as Record<string, unknown> | undefined;
      const content = typeof message?.content === "string" ? message.content.trim() : null;
      if (!content) {
        lastError = new Error("Empty content returned");
        logger.warn({ model }, "Translation model returned empty content");
        break;
      }

      try {
        const translations = parseTranslateStoriesResponse(content, allowedIds);
        return { model: typeof payload.model === "string" ? payload.model : model, translations };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Invalid translation JSON response");
        logger.warn({ model, msg: lastError.message }, "Translation model returned invalid JSON");
        break;
      }
    }
  }

  throw lastError ?? new Error("Translation request failed after retries");
}

async function persistDocumentTranslation(
  documentId: number,
  translation: DocumentTranslationMetadata,
): Promise<void> {
  const db = getDb();
  const patch = JSON.stringify({ translation });
  await db
    .update(schema.documents)
    .set({
      metadata: sql`coalesce(${schema.documents.metadata}, '{}'::jsonb) || ${patch}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(schema.documents.id, documentId));
}

export interface TranslatableDocumentInput {
  id: number;
  title: string;
  previewParagraph: string;
  metadata?: unknown;
}

export async function ensureDocumentsTranslated(
  docs: readonly TranslatableDocumentInput[],
): Promise<Map<number, DocumentTranslationMetadata>> {
  const resultMap = new Map<number, DocumentTranslationMetadata>();
  const pending: TranslationPromptCandidate[] = [];

  for (const doc of docs) {
    const existing = readDocumentTranslation(doc.metadata);
    if (existing) {
      resultMap.set(doc.id, existing);
      continue;
    }

    const detected = detectNonEnglishContent(doc.title, doc.previewParagraph);
    if (!detected) {
      continue;
    }

    pending.push({
      id: doc.id,
      title: doc.title,
      previewParagraph: doc.previewParagraph,
      detectedLanguage: detected.label,
    });
  }

  if (pending.length === 0) {
    return resultMap;
  }

  const env = loadWorkerEnv();
  if (!env.OPENROUTER_API_KEY) {
    return resultMap;
  }

  for (let i = 0; i < pending.length; i += TRANSLATION_BATCH_SIZE) {
    const batch = pending.slice(i, i + TRANSLATION_BATCH_SIZE);
    try {
      const { model, translations } = await translateStoryBatchWithOpenRouter(batch);
      const translatedAt = new Date().toISOString();
      for (const item of translations) {
        const record: DocumentTranslationMetadata = {
          sourceLanguage: item.sourceLanguage,
          sourceLanguageCode: item.sourceLanguageCode,
          translatedTitle: item.translatedTitle,
          translatedPreview: item.translatedPreview,
          model,
          translatedAt,
        };
        await persistDocumentTranslation(item.documentId, record);
        resultMap.set(item.documentId, record);
      }
      logger.info(
        { batchSize: batch.length, translated: translations.length, model },
        "Translated non-English stories",
      );
    } catch (error) {
      logger.warn(
        {
          batchSize: batch.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Non-English story translation batch failed cleanly",
      );
    }
  }

  return resultMap;
}

export async function translateRecentNonEnglishDocuments(options?: {
  lookbackDays?: number;
  maxPerRun?: number;
}): Promise<{ detectedCount: number; translatedCount: number }> {
  const env = loadWorkerEnv();
  if (!env.OPENROUTER_API_KEY) {
    return { detectedCount: 0, translatedCount: 0 };
  }

  const db = getDb();
  const lookbackDays = options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const maxPerRun = options?.maxPerRun ?? DEFAULT_MAX_PER_RUN;
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const baseSelect = {
    id: schema.documents.id,
    title: schema.documents.title,
    summary: schema.documents.summary,
    bodyText: sql<string | null>`left(${schema.documents.bodyText}, 2000)`,
    metadata: schema.documents.metadata,
  };

  const [nonAsciiTitleRows, recentRows] = await Promise.all([
    db
      .select(baseSelect)
      .from(schema.documents)
      .where(
        and(
          gt(documentSortKey, cutoff),
          sql`(${schema.documents.metadata}->'translation') IS NULL`,
          sql`octet_length(${schema.documents.title}) > char_length(${schema.documents.title})`,
        ),
      )
      .orderBy(desc(documentSortKey), desc(schema.documents.id))
      .limit(CANDIDATE_QUERY_LIMIT),
    db
      .select(baseSelect)
      .from(schema.documents)
      .where(
        and(
          gt(documentSortKey, cutoff),
          sql`(${schema.documents.metadata}->'translation') IS NULL`,
        ),
      )
      .orderBy(desc(documentSortKey), desc(schema.documents.id))
      .limit(CANDIDATE_QUERY_LIMIT),
  ]);

  const seenIds = new Set<number>();
  const rows = [...nonAsciiTitleRows, ...recentRows].filter((row) => {
    if (seenIds.has(row.id)) return false;
    seenIds.add(row.id);
    return true;
  });

  const nonEnglishCandidates: TranslatableDocumentInput[] = [];
  for (const row of rows) {
    const previewParagraph = extractDocumentPreview(row.summary, row.bodyText, { maxChars: 420 });
    if (!detectNonEnglishContent(row.title, previewParagraph)) {
      continue;
    }
    nonEnglishCandidates.push({
      id: row.id,
      title: row.title,
      previewParagraph,
      metadata: row.metadata,
    });
    if (nonEnglishCandidates.length >= maxPerRun) {
      break;
    }
  }

  if (nonEnglishCandidates.length === 0) {
    return { detectedCount: 0, translatedCount: 0 };
  }

  const translated = await ensureDocumentsTranslated(nonEnglishCandidates);
  return {
    detectedCount: nonEnglishCandidates.length,
    translatedCount: translated.size,
  };
}
