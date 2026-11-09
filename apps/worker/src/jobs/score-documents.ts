import { getDb, schema } from "@ai-intel/db";
import { and, desc, eq, gt, inArray, isNull, like, notInArray, sql } from "drizzle-orm";
import {
  OPINION_PENDING_TEXT,
  applyOpinionToStoredWhyRelevant,
  classifyStoryTopicsBatch,
  decideRetry,
  decideStoryRelevanceBatch,
  deduplicateScoringCandidates,
  extractBodyError,
  extractDocumentPreview,
  isFreeTierModel,
  parseStoryOpinionsResponse,
  renderStoryOpinionsPrompt,
  scoringConfig,
  selectOpinionModelCandidates,
  type ParsedStoryOpinion,
  type PromptCandidate,
  type ScoreDocumentsPayload,
  type StoryRelevanceInput,
  type StoryRelevanceOutcome,
} from "@ai-intel/shared";
import { logger } from "../logger";
import { loadWorkerEnv } from "../env";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
// DeepSeek opinion calls can stall, so every chat request stays bounded.
const REQUEST_TIMEOUT_MS = 60_000;
const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;
const DAY_MS = 24 * 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeStoryOpinions(
  profileName: string | null,
  interestStatement: string,
  candidates: PromptCandidate[],
): Promise<{ model: string; opinions: ParsedStoryOpinion[] }> {
  const env = loadWorkerEnv();
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
  if (candidates.length === 0) return { model: selectOpinionModelCandidates()[0] ?? env.OPENROUTER_MODEL, opinions: [] };

  const prompt = renderStoryOpinionsPrompt({ profileName, interestStatement, candidates });
  const allowedIds = new Set(candidates.map((c) => c.id));
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
    const maxTokens = Math.min(8192, Math.max(2048, candidates.length * 300));
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

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.info({ attempt, backoff, model }, "Retrying DeepSeek opinion request");
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
          logger.warn({ model, msg: lastError.message }, "Opinion model network failure");
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
          logger.warn({ status: response.status, msg, model }, "Retryable opinion-model error");
          continue;
        }
        logger.warn({ status: response.status, msg, model }, "Opinion model failed");
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
          logger.warn({ status: bodyError.status, msg: bodyError.message, model }, "Retryable opinion-model upstream error");
          continue;
        }
        logger.warn({ status: bodyError.status, msg: bodyError.message, model }, "Opinion model unavailable");
        break;
      }

      const choices = payload.choices as unknown[];
      const firstChoice = choices[0] as Record<string, unknown>;
      const message = firstChoice.message as Record<string, unknown> | undefined;
      const content = typeof message?.content === "string" ? message.content.trim() : null;
      if (!content) {
        lastError = new Error("Empty content returned");
        logger.warn({ model }, "Opinion model returned empty content");
        break;
      }

      try {
        const opinions = parseStoryOpinionsResponse(content, allowedIds);
        return { model: typeof payload.model === "string" ? payload.model : model, opinions };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Invalid opinion JSON response");
        logger.warn({ model, msg: lastError.message }, "Opinion model returned invalid JSON");
        break;
      }
    }
  }

  throw lastError ?? new Error("Opinion request failed after retries");
}

async function persistTopics(topics: Array<{ documentId: number; topic: string }>) {
  if (topics.length === 0) return;
  const db = getDb();
  for (const topic of topics) {
    await db
      .update(schema.documents)
      .set({ storyTopic: topic.topic })
      .where(and(eq(schema.documents.id, topic.documentId), isNull(schema.documents.storyTopic)));
  }
}

async function persistOpinions(
  profileId: number,
  model: string,
  opinions: ParsedStoryOpinion[],
  duplicateIdsByRepresentative: Map<number, number[]>,
  storedWhyRelevantByDocument: Map<number, string>,
) {
  if (opinions.length === 0) return;
  const db = getDb();
  for (const opinion of opinions) {
    const targetIds = duplicateIdsByRepresentative.get(opinion.documentId) ?? [opinion.documentId];
    for (const documentId of targetIds) {
      const existing = storedWhyRelevantByDocument.get(documentId) ?? storedWhyRelevantByDocument.get(opinion.documentId) ?? "";
      await db
        .update(schema.documentScores)
        .set({
          whyRelevant: applyOpinionToStoredWhyRelevant({
            existingWhyRelevant: existing,
            opinion: opinion.whyRelevant,
            matchedSignals: opinion.matchedSignals,
          }),
          opinionModel: model,
        })
        .where(and(
          eq(schema.documentScores.documentId, documentId),
          eq(schema.documentScores.profileId, profileId),
          like(schema.documentScores.whyRelevant, `${OPINION_PENDING_TEXT}%`),
        ));
    }
  }
}

async function backfillStoryTopics({
  targetedDocumentIds,
  cutoff,
}: {
  targetedDocumentIds: number[];
  cutoff: Date;
}) {
  const env = loadWorkerEnv();
  if (!env.OPENROUTER_API_KEY) return;
  const db = getDb();
  const filters = [isNull(schema.documents.storyTopic)];
  if (targetedDocumentIds.length > 0) {
    filters.push(inArray(schema.documents.id, targetedDocumentIds));
  } else {
    filters.push(gt(documentSortKey, cutoff));
  }

  const rows = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      summary: schema.documents.summary,
      bodyText: sql<string | null>`left(${schema.documents.bodyText}, 2000)`,
      sourceName: schema.sources.name,
      sourceCategory: schema.sources.category,
    })
    .from(schema.documents)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .where(and(...filters))
    .orderBy(desc(documentSortKey), desc(schema.documents.id))
    .limit(scoringConfig.batchSize);

  if (rows.length === 0) return;

  const classified = await classifyStoryTopicsBatch({
    apiKey: env.OPENROUTER_API_KEY,
    referer: env.APP_BASE_URL,
    stories: rows.map((row) => ({
      id: row.id,
      title: row.title,
      excerpt: extractDocumentPreview(row.summary, row.bodyText),
      sourceName: row.sourceName,
      sourceCategory: row.sourceCategory,
      storyTopic: null,
    })),
  });
  await persistTopics(
    classified.flatMap((row) => (row.topic ? [{ documentId: row.documentId, topic: row.topic }] : [])),
  );
  logger.info(
    { classified: classified.filter((row) => row.topic).length, considered: rows.length },
    "Classified story topics",
  );
}

async function backfillPendingOpinions({
  profileId,
  profileName,
  interestStatement,
  targetedDocumentIds,
  cutoff,
}: {
  profileId: number;
  profileName: string;
  interestStatement: string;
  targetedDocumentIds: number[];
  cutoff: Date;
}) {
  const db = getDb();
  const filters = [
    eq(schema.documentScores.profileId, profileId),
    like(schema.documentScores.whyRelevant, `${OPINION_PENDING_TEXT}%`),
  ];
  if (targetedDocumentIds.length > 0) {
    filters.push(inArray(schema.documents.id, targetedDocumentIds));
  } else {
    filters.push(gt(documentSortKey, cutoff));
  }

  const rows = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      summary: schema.documents.summary,
      bodyText: sql<string | null>`left(${schema.documents.bodyText}, 2000)`,
      sourceName: schema.sources.name,
      sourceCategory: schema.sources.category,
      sortTime: documentSortKey,
      whyRelevant: schema.documentScores.whyRelevant,
    })
    .from(schema.documentScores)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentScores.documentId))
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .where(and(...filters))
    .orderBy(desc(documentSortKey), desc(schema.documents.id))
    .limit(scoringConfig.batchSize);

  if (rows.length === 0) return;

  const groups = deduplicateScoringCandidates(
    rows.map((row) => ({
      ...row,
      previewParagraph: extractDocumentPreview(row.summary, row.bodyText),
    })),
  );
  const duplicateTargetIdsByRepresentative = new Map<number, number[]>();
  const storedWhyRelevant = new Map<number, string>();
  const candidates: PromptCandidate[] = groups.map((group) => {
    duplicateTargetIdsByRepresentative.set(group.representative.id, group.duplicateIds);
    for (const documentId of group.duplicateIds) {
      const match = rows.find((row) => row.id === documentId);
      if (match) storedWhyRelevant.set(documentId, match.whyRelevant);
    }
    return {
      id: group.representative.id,
      title: group.representative.title,
      previewParagraph: group.representative.previewParagraph ?? "",
      sourceName: group.representative.sourceName,
      sourceCategory: group.representative.sourceCategory,
      publishedAt: group.representative.sortTime,
    };
  });

  try {
    const opinions = await writeStoryOpinions(profileName, interestStatement, candidates);
    await persistOpinions(
      profileId,
      opinions.model,
      opinions.opinions,
      duplicateTargetIdsByRepresentative,
      storedWhyRelevant,
    );
    logger.info({ profileId, opinions: opinions.opinions.length }, "Backfilled pending opinions");
  } catch (error) {
    logger.error({ profileId, error }, "Pending opinion backfill failed");
  }
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

  const cutoff = new Date(Date.now() - env.SCORING_LOOKBACK_DAYS * DAY_MS);
  const documentFilters = [notInArray(schema.documents.id, alreadyScoredIds)];
  if (targetedDocumentIds.length > 0) {
    documentFilters.push(inArray(schema.documents.id, targetedDocumentIds));
  } else {
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
      storyTopic: schema.documents.storyTopic,
      sortTime: documentSortKey,
    })
    .from(schema.documents)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .where(and(...documentFilters))
    .orderBy(desc(documentSortKey), desc(schema.documents.id))
    .limit(env.SCORING_MAX_DOCUMENTS_PER_RUN);

  if (unscoredDocs.length === 0) {
    await backfillStoryTopics({ targetedDocumentIds, cutoff });
    await backfillPendingOpinions({
      profileId,
      profileName: profile.displayName,
      interestStatement: profile.interestStatement,
      targetedDocumentIds,
      cutoff,
    });
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
      const stories: StoryRelevanceInput[] = batchGroups.map((group) => {
        const doc = group.representative;
        duplicateTargetIdsByRepresentative.set(doc.id, group.duplicateIds);
        return {
          id: doc.id,
          title: doc.title,
          excerpt: doc.previewParagraph,
          sourceName: doc.sourceName,
          sourceCategory: doc.sourceCategory,
          storyTopic: doc.storyTopic,
        };
      });

      try {
        if (!env.OPENROUTER_API_KEY) {
          throw new Error("OPENROUTER_API_KEY is not set");
        }

        const outcomes = await decideStoryRelevanceBatch({
          apiKey: env.OPENROUTER_API_KEY,
          interestStatement: profile.interestStatement,
          stories,
          referer: env.APP_BASE_URL,
        });
        const successes = outcomes.filter((outcome): outcome is Extract<StoryRelevanceOutcome, { ok: true }> => outcome.ok);
        const failures = outcomes.filter((outcome) => !outcome.ok);

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

        if (successes.length === 0) {
          throw new Error(failures[0] && "error" in failures[0] ? failures[0].error : "Jev returned no relevance scores");
        }

        const expandedScores = successes.flatMap((decision) => {
          const targetIds = duplicateTargetIdsByRepresentative.get(decision.documentId) ?? [decision.documentId];
          return targetIds.map((documentId) => ({
            documentId,
            score: decision.score,
            whyRelevant: decision.whyRelevant,
            model: decision.model,
            opinionModel: decision.opinionModel,
          }));
        });

        await db
          .insert(schema.documentScores)
          .values(expandedScores.map((s) => ({
            documentId: s.documentId,
            profileId,
            score: s.score,
            whyRelevant: s.whyRelevant,
            model: s.model,
            opinionModel: s.opinionModel,
          })))
          .onConflictDoUpdate({
            target: [schema.documentScores.documentId, schema.documentScores.profileId],
            set: {
              score: sql`excluded.score`,
              whyRelevant: sql`excluded.why_relevant`,
              model: sql`excluded.model`,
              opinionModel: sql`excluded.opinion_model`,
              scoredAt: new Date(),
            },
          });

        const topicWrites = successes.flatMap((decision) => {
          const story = stories.find((candidate) => candidate.id === decision.documentId);
          if (!decision.topic || story?.storyTopic) return [];
          const targetIds = duplicateTargetIdsByRepresentative.get(decision.documentId) ?? [decision.documentId];
          return targetIds.map((documentId) => ({ documentId, topic: decision.topic as string }));
        });
        await persistTopics(topicWrites);

        const opinionStories = successes.filter((decision) => decision.needsOpinion);
        if (opinionStories.length > 0) {
          const storedWhyRelevant = new Map<number, string>();
          const opinionCandidates: PromptCandidate[] = opinionStories.map((decision) => {
            const story = stories.find((candidate) => candidate.id === decision.documentId);
            const targetIds = duplicateTargetIdsByRepresentative.get(decision.documentId) ?? [decision.documentId];
            for (const documentId of targetIds) storedWhyRelevant.set(documentId, decision.whyRelevant);
            return {
              id: decision.documentId,
              title: story?.title ?? "Untitled",
              previewParagraph: story?.excerpt ?? "",
              sourceName: story?.sourceName ?? null,
              sourceCategory: story?.sourceCategory ?? null,
            };
          });

          try {
            const opinions = await writeStoryOpinions(
              profile.displayName,
              profile.interestStatement,
              opinionCandidates,
            );
            await persistOpinions(
              profileId,
              opinions.model,
              opinions.opinions,
              duplicateTargetIdsByRepresentative,
              storedWhyRelevant,
            );
          } catch (error) {
            logger.error({ jobId, profileId, batchNumber, error }, "Opinion generation failed; Jev scores were kept");
          }
        }

        const scoredDocuments = expandedScores.length;
        const missed = Math.max(0, batchDocumentCount - scoredDocuments);
        scoredTotal += scoredDocuments;
        failedTotal += missed;

        await db
          .update(schema.scoringJobs)
          .set({
            currentBatch: batchNumber,
            scoredDocuments: sql`${schema.scoringJobs.scoredDocuments} + ${scoredDocuments}`,
            failedDocuments: sql`${schema.scoringJobs.failedDocuments} + ${missed}`,
          })
          .where(eq(schema.scoringJobs.id, jobId));

        logger.info(
          {
            jobId,
            profileId,
            batchNumber,
            totalBatches,
            model: successes[0]?.model,
            scored: scoredDocuments,
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

    await backfillStoryTopics({ targetedDocumentIds, cutoff });
    await backfillPendingOpinions({
      profileId,
      profileName: profile.displayName,
      interestStatement: profile.interestStatement,
      targetedDocumentIds,
      cutoff,
    });

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
