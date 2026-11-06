import { getDb, schema } from "@ai-intel/db";
import { and, desc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import {
  ScoringModelPool,
  decideRetry,
  deduplicateScoringCandidates,
  extractBodyError,
  extractDocumentPreview,
  formatWhyRelevant,
  isFreeTierModel,
  parseScoreDocumentsResponse,
  renderScoreDocumentsPrompt,
  scoringConfig,
  type ParsedDocumentScore,
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

async function callLlm(
  profileName: string | null,
  interestStatement: string,
  candidates: PromptCandidate[],
): Promise<{ model: string; scores: ParsedDocumentScore[] }> {
  const env = loadWorkerEnv();
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");

  const prompt = renderScoreDocumentsPrompt({ profileName, interestStatement, candidates });
  const allowedIds = new Set(candidates.map((c) => c.id));
  const headers = {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": env.APP_BASE_URL,
    "X-Title": "AI Builder Intelligence",
  };

  const pool = getScoringPool();
  await pool.refresh();

  const models = pool.candidates(Date.now(), env.OPENROUTER_MODEL);
  const parked = pool.health();
  if (parked.length > 0) logger.debug({ parked }, "Skipping parked OpenRouter models");

  let lastError: Error | null = null;

  for (const model of models) {
    const freeTier = isFreeTierModel(model);
    const maxTokens = Math.min(2400, Math.max(400, candidates.length * 100));
    const body = JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
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

      let scores: ParsedDocumentScore[];
      try {
        scores = parseScoreDocumentsResponse(content, allowedIds);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Invalid scoring JSON response");
        pool.recordFailure(model, 502);
        logger.warn({ model, msg: lastError.message }, "OpenRouter returned invalid scoring JSON, falling through");
        break;
      }

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
    .select({
      id: schema.userProfiles.id,
      displayName: schema.userProfiles.displayName,
      interestStatement: schema.userProfiles.interestStatement,
    })
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
      bodyText: sql<string | null>`left(${schema.documents.bodyText}, 2000)`,
      sourceName: schema.sources.name,
      sourceCategory: schema.sources.category,
      sortTime: documentSortKey,
    })
    .from(schema.documents)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .where(and(...documentFilters))
    .orderBy(desc(documentSortKey), desc(schema.documents.id))
    .limit(env.SCORING_MAX_DOCUMENTS_PER_RUN);

  if (unscoredDocs.length === 0) {
    logger.info({ profileId }, "No unscored documents");
    return;
  }

  const docsWithPreviews = unscoredDocs.map((doc) => ({
    ...doc,
    previewParagraph: extractDocumentPreview(doc.summary, doc.bodyText),
  }));
  const deduplicatedGroups = deduplicateScoringCandidates(docsWithPreviews);
  const totalBatches = Math.ceil(deduplicatedGroups.length / scoringConfig.batchSize);

  // Create scoring job row
  const [jobRow] = await db
    .insert(schema.scoringJobs)
    .values({ profileId, status: "running", totalDocuments: unscoredDocs.length, totalBatches })
    .returning({ id: schema.scoringJobs.id });
  const jobId = jobRow!.id;

  let scoredTotal = 0;
  let failedTotal = 0;
  let lastBatchError: string | null = null;

  try {
    for (let i = 0; i < deduplicatedGroups.length; i += scoringConfig.batchSize) {
      const batchGroups = deduplicatedGroups.slice(i, i + scoringConfig.batchSize);
      const batchNumber = Math.floor(i / scoringConfig.batchSize) + 1;
      const batchDocumentCount = batchGroups.reduce(
        (sum, group) => sum + group.duplicateIds.length,
        0,
      );

      const duplicateTargetIdsByRepresentative = new Map<number, number[]>();
      const uniqueCandidates: PromptCandidate[] = batchGroups.map((group) => {
        const doc = group.representative;
        duplicateTargetIdsByRepresentative.set(doc.id, group.duplicateIds);
        return {
          id: doc.id,
          title: doc.title,
          previewParagraph: doc.previewParagraph,
          sourceName: doc.sourceName,
          sourceCategory: doc.sourceCategory,
          publishedAt: doc.sortTime,
        };
      });

      try {
        const result = await callLlm(
          profile.displayName,
          profile.interestStatement,
          uniqueCandidates,
        );
        const expandedScores = result.scores.flatMap((s) => {
          const targetIds = duplicateTargetIdsByRepresentative.get(s.documentId) ?? [s.documentId];
          return targetIds.map((documentId) => ({
            ...s,
            documentId,
          }));
        });

        const [currentProfile] = await db
          .select({ interestStatement: schema.userProfiles.interestStatement })
          .from(schema.userProfiles)
          .where(eq(schema.userProfiles.id, profileId))
          .limit(1);

        if (
          !currentProfile ||
          currentProfile.interestStatement.trim() !== profile.interestStatement.trim()
        ) {
          logger.info(
            { profileId, jobId },
            "Aborting scoring run because profile interest statement changed mid-job",
          );
          break;
        }

        if (expandedScores.length > 0) {
          await db
            .insert(schema.documentScores)
            .values(expandedScores.map((s) => ({
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

        const missed = Math.max(0, batchDocumentCount - expandedScores.length);
        scoredTotal += expandedScores.length;
        failedTotal += missed;

        await db
          .update(schema.scoringJobs)
          .set({
            currentBatch: batchNumber,
            scoredDocuments: sql`${schema.scoringJobs.scoredDocuments} + ${expandedScores.length}`,
            failedDocuments: sql`${schema.scoringJobs.failedDocuments} + ${missed}`,
          })
          .where(eq(schema.scoringJobs.id, jobId));

        logger.info(
          {
            jobId,
            profileId,
            batchNumber,
            totalBatches,
            model: result.model,
            scored: expandedScores.length,
            total: batchDocumentCount,
          },
          "Scored batch",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        lastBatchError = message;
        failedTotal += batchDocumentCount;
        logger.error({ jobId, profileId, batchNumber, error }, "Batch scoring failed");

        await db
          .update(schema.scoringJobs)
          .set({
            currentBatch: batchNumber,
            failedDocuments: sql`${schema.scoringJobs.failedDocuments} + ${batchDocumentCount}`,
          })
          .where(eq(schema.scoringJobs.id, jobId));
      }
    }

    const finalStatus = scoredTotal === 0 && failedTotal > 0 ? "failed" : "completed";
    await db
      .update(schema.scoringJobs)
      .set({
        status: finalStatus,
        completedAt: new Date(),
        errorMessage: finalStatus === "failed" ? lastBatchError : null,
      })
      .where(eq(schema.scoringJobs.id, jobId));

    logger.info(
      { jobId, profileId, status: finalStatus, scoredTotal, failedTotal },
      "Scoring job finished",
    );
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
