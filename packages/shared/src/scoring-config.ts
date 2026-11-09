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
  // Web score-all safety ceiling. The worker uses SCORING_MAX_DOCUMENTS_PER_RUN
  // for the same role. A run pages until the lookback window is scored or this
  // ceiling is hit; the next run continues.
  maxDocumentsPerRun: 5_000,
  preferredModel: freeScoringModelPool[0],
  // Retained for ScoringModelPool tests and discovery. Relevance scoring no
  // longer consults this list.
  scoringModelCandidates: [...freeScoringModelPool, deepseekFlashLatestModel],
  // Industry-trend briefings are user-facing prose, so they stay on DeepSeek.
  summaryModelCandidates: [deepseekFlashLatestModel],
  // Michael's Take is the only generative scoring step, and it stays on DeepSeek.
  opinionModelCandidates: [deepseekFlashLatestModel],
  // Perplexity Decider Flash via OpenRouter's Decisions API. Scores relevance
  // and assigns a story topic for every crawled story.
  jevModel: "perplexity/pplx-decider-flash-v1.2",
  jevConcurrency: 8,
  jevTimeoutMs: 15_000,
  jevMaxRetries: 3,
  // Daily shortlist size. DeepSeek writes a take only for these stories.
  dailyTakeCount: 10,
  dailyTakeMaxPerSource: 5,
  // Floor for a non-pinned story to enter that shortlist. Matches the feed.
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
