import { getDb, schema } from "@ai-intel/db";
import { and, desc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import {
  ScoringModelPool,
  decideRetry,
  extractBodyError,
  isFreeTierModel,
  renderScoreDocumentsPrompt,
  scoringConfig,
  type PromptCandidate,
  type ScoreDocumentsPayload,
} from "@ai-intel/shared";
import { logger } from "../logger";
import { loadWorkerEnv } from "../env";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
// Free-pool endpoints can hang indefinitely, so every request is bounded and a
// timeout is treated like any other model failure.
const REQUEST_TIMEOUT_MS = 60_000;
const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;
const DAY_MS = 24 * 60 * 60 * 1000;

function stripHtml(value: string): string {
  return value
    .replace(/<\/(p|div|li|section|article|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractPreview(summary: string | null, bodyText: string | null): string {
  const bodyParagraphs = bodyText
    ? stripHtml(bodyText).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    : [];
  if (bodyParagraphs.length > 0) return bodyParagraphs[0]!.slice(0, 300);
  const summaryText = summary ? stripHtml(summary) : "";
  return summaryText ? summaryText.slice(0, 300) : "";
}

interface ScoreResult {
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

function formatWhyRelevant(result: ScoreResult) {
  const metadata = [
    result.confidence ? `Confidence: ${result.confidence}` : null,
    result.matchedSignals.length > 0 ? `Signals: ${result.matchedSignals.join(", ")}` : null,
  ].filter(Boolean);

  return metadata.length > 0
    ? `${result.whyRelevant}\n\n${metadata.join(" | ")}`
    : result.whyRelevant;
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
  const env = loadWorkerEnv();
  scoringPool ??= new ScoringModelPool({
    apiKey: env.OPENROUTER_API_KEY ?? null,
    onWarn: (message) => logger.warn({ msg: message }, "OpenRouter model pool"),
  });
  return scoringPool;
}

async function callLlm(interestStatement: string, candidates: PromptCandidate[]): Promise<{ model: string; scores: ScoreResult[] }> {
  const env = loadWorkerEnv();
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");

  const prompt = renderScoreDocumentsPrompt({ interestStatement, candidates });
  const headers = {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": env.APP_BASE_URL,
    "X-Title": "AI Builder Intelligence",
  };

  const pool = getScoringPool();
  await pool.refresh();

  const models = Array.from(new Set([...pool.candidates(), env.OPENROUTER_MODEL]));
  const parked = pool.health();
  if (parked.length > 0) logger.debug({ parked }, "Skipping parked OpenRouter models");

  let lastError: Error | null = null;

  for (const model of models) {
    const freeTier = isFreeTierModel(model);
    const body = JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 4000,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.info({ attempt, backoff, model }, "Retrying OpenRouter request");
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
          // Timeouts and connection failures are transient, not entitlement problems.
          pool.recordFailure(model, 408);
          logger.warn({ model, msg: lastError.message }, "Free-tier model network failure");
          break;
        }
        continue;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const errObj = payload?.error;
        const msg = errObj && typeof errObj === "object" && typeof (errObj as Record<string, unknown>).message === "string"
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
          logger.warn({ status: response.status, msg, model }, "Retryable OpenRouter error");
          continue;
        }

        pool.recordFailure(model, response.status);
        if (response.status === 429 && freeTier) {
          logger.info({ model }, "Free-tier quota exhausted, parked and falling through");
        } else {
          logger.warn({ status: response.status, msg, model }, "OpenRouter model failed");
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
          logger.warn({ status: bodyError.status, msg: bodyError.message, model }, "Retryable OpenRouter upstream error");
          continue;
        }

        pool.recordFailure(model, bodyError.status);
        logger.warn({ status: bodyError.status, msg: bodyError.message, model }, "OpenRouter model unavailable");
        break;
      }

      const choices = payload.choices as unknown[];
      const firstChoice = choices[0] as Record<string, unknown>;
      const message = firstChoice.message as Record<string, unknown> | undefined;
      const content = typeof message?.content === "string" ? message.content.trim() : null;
      if (!content) {
        lastError = new Error("Empty content returned");
        pool.recordFailure(model, 502);
        logger.warn({ model }, "OpenRouter returned empty content");
        break;
      }

      const parsed = JSON.parse(extractJson(content)) as unknown;
      const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
      const rawScores = Array.isArray(record?.scores) ? record.scores : [];

      const scores: ScoreResult[] = rawScores
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const r = entry as Record<string, unknown>;
          const documentId = Number(r.documentId);
          const score = Number(r.score);
          const confidence = parseConfidence(r.confidence);
          const matchedSignals = parseMatchedSignals(r.matchedSignals);
          const whyRelevant = typeof r.whyRelevant === "string" ? r.whyRelevant.trim() : "";
          if (!Number.isInteger(documentId) || !Number.isFinite(score) || !whyRelevant) return null;
          return { documentId, score: Math.max(1, Math.min(100, Math.round(score))), confidence, matchedSignals, whyRelevant };
        })
        .filter((e): e is ScoreResult => e !== null);

      pool.recordSuccess(model);
      return { model: typeof payload.model === "string" ? payload.model : model, scores };
    }
  }

  throw lastError ?? new Error("OpenRouter request failed after retries");
}

export async function scoreDocuments(payload: ScoreDocumentsPayload) {
  const db = getDb();
  const env = loadWorkerEnv();
  const { profileId } = payload;
  const targetedDocumentIds = Array.from(
    new Set((payload.documentIds ?? []).filter((id) => Number.isInteger(id) && id > 0)),
  );

  const [profile] = await db
    .select({ id: schema.userProfiles.id, interestStatement: schema.userProfiles.interestStatement })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.id, profileId))
    .limit(1);

  if (!profile || !profile.interestStatement.trim()) {
    throw new Error(`Profile ${profileId} not found or has no interest statement`);
  }

  const alreadyScoredIds = db
    .select({ documentId: schema.documentScores.documentId })
    .from(schema.documentScores)
    .where(eq(schema.documentScores.profileId, profileId));

  const documentFilters = [notInArray(schema.documents.id, alreadyScoredIds)];
  if (targetedDocumentIds.length > 0) {
    documentFilters.push(inArray(schema.documents.id, targetedDocumentIds));
  } else {
    const cutoff = new Date(Date.now() - env.SCORING_LOOKBACK_DAYS * DAY_MS);
    documentFilters.push(gt(documentSortKey, cutoff));
  }

  const unscoredDocs = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      summary: schema.documents.summary,
      bodyText: schema.documents.bodyText,
      sourceName: schema.sources.name,
      sourceCategory: schema.sources.category,
      sortTime: documentSortKey,
    })
    .from(schema.documents)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .where(and(...documentFilters))
    .orderBy(desc(documentSortKey), desc(schema.documents.id))
    .limit(env.SCORING_MAX_DOCUMENTS_PER_RUN);

  const totalBatches = Math.ceil(unscoredDocs.length / scoringConfig.batchSize);

  if (unscoredDocs.length === 0) {
    logger.info({ profileId }, "No unscored documents");
    return;
  }

  // Create scoring job row
  const [jobRow] = await db
    .insert(schema.scoringJobs)
    .values({ profileId, status: "running", totalDocuments: unscoredDocs.length, totalBatches })
    .returning({ id: schema.scoringJobs.id });
  const jobId = jobRow!.id;

  try {
    for (let i = 0; i < unscoredDocs.length; i += scoringConfig.batchSize) {
      const batch = unscoredDocs.slice(i, i + scoringConfig.batchSize);
      const batchNumber = Math.floor(i / scoringConfig.batchSize) + 1;

      const candidates: PromptCandidate[] = batch.map((doc) => ({
        id: doc.id,
        title: doc.title,
        previewParagraph: extractPreview(doc.summary, doc.bodyText),
        sourceName: doc.sourceName,
        sourceCategory: doc.sourceCategory,
        publishedAt: doc.sortTime,
      }));

      try {
        const result = await callLlm(profile.interestStatement, candidates);
        const validScores = result.scores.filter((s) => batch.some((doc) => doc.id === s.documentId));

        if (validScores.length > 0) {
          await db
            .insert(schema.documentScores)
            .values(validScores.map((s) => ({
              documentId: s.documentId,
              profileId,
              score: s.score,
              whyRelevant: formatWhyRelevant(s),
              model: result.model,
            })))
            .onConflictDoUpdate({
              target: [schema.documentScores.documentId, schema.documentScores.profileId],
              set: {
                score: sql`excluded.score`,
                whyRelevant: sql`excluded.why_relevant`,
                model: sql`excluded.model`,
                scoredAt: new Date(),
              },
            });
        }

        const missed = batch.length - validScores.length;

        await db
          .update(schema.scoringJobs)
          .set({
            currentBatch: batchNumber,
            scoredDocuments: sql`${schema.scoringJobs.scoredDocuments} + ${validScores.length}`,
            failedDocuments: sql`${schema.scoringJobs.failedDocuments} + ${missed}`,
          })
          .where(eq(schema.scoringJobs.id, jobId));

        logger.info({ batchNumber, totalBatches, scored: validScores.length, total: batch.length }, "Scored batch");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error({ batchNumber, error: message }, "Batch scoring failed");

        await db
          .update(schema.scoringJobs)
          .set({
            currentBatch: batchNumber,
            failedDocuments: sql`${schema.scoringJobs.failedDocuments} + ${batch.length}`,
          })
          .where(eq(schema.scoringJobs.id, jobId));
      }
    }

    await db
      .update(schema.scoringJobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(schema.scoringJobs.id, jobId));

    logger.info({ jobId, profileId }, "Scoring job completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(schema.scoringJobs)
      .set({ status: "failed", completedAt: new Date(), errorMessage: message })
      .where(eq(schema.scoringJobs.id, jobId));

    logger.error({ jobId, error: message }, "Scoring job failed");
    throw error;
  }
}
