const deepseekFlashLatestModel = "~deepseek/deepseek-flash-latest";

/**
 * Zero-cost OpenRouter models, tried in order ahead of the paid backstop.
 *
 * Every entry has been verified to return the scoring prompt's JSON contract
 * and to rank an off-topic document far below on-topic ones. Free endpoints are
 * individually unreliable — quota exhaustion (429), upstream congestion, and
 * outright hangs are all routine — so the pool trades on breadth: a failure on
 * any one falls straight through to the next with no backoff.
 *
 * Ordered by how closely each tracked the paid model's calibration in probing,
 * with latency as the tiebreak.
 */
const freeScoringModelPool = [
  "minimax/minimax-m3:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "dots-studio/dots-3-note-preview:free",
  "minimax/minimax-m2.7:free",
] as const;

export const scoringConfig = {
  batchSize: 20,
  maxDocumentsPerRun: 20,
  preferredModel: freeScoringModelPool[0],
  // Retained for ScoringModelPool tests and discovery. Relevance scoring no
  // longer consults this list; it goes to Jev.
  scoringModelCandidates: [...freeScoringModelPool, deepseekFlashLatestModel],
  // Industry-trend briefings are user-facing prose, so they stay on DeepSeek.
  summaryModelCandidates: [deepseekFlashLatestModel],
  // Michael's Take is the only generative scoring step, and it stays on DeepSeek.
  opinionModelCandidates: [deepseekFlashLatestModel],
  // TypeSafe Jev via OpenRouter's Decisions API. Cheap structured decisions
  // for relevance scores and story topics.
  jevModel: "typesafe/jev-1.14",
  jevConcurrency: 8,
  jevTimeoutMs: 15_000,
  jevMaxRetries: 3,
  // Stories at or above this score get a DeepSeek opinion. Matches the feed's
  // top-story qualification threshold.
  minOpinionScore: 40,
} as const;

export function selectScoringModelCandidates() {
  return [...scoringConfig.scoringModelCandidates];
}

export function selectSummaryModelCandidates() {
  return [...scoringConfig.summaryModelCandidates];
}

export function selectOpinionModelCandidates() {
  return [...scoringConfig.opinionModelCandidates];
}
