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
  // Scoring is the high-volume caller, so it exhausts the free pool before
  // spending anything, with the paid model as the guaranteed backstop.
  scoringModelCandidates: [...freeScoringModelPool, deepseekFlashLatestModel],
  // Summaries are low volume and user-facing prose, so they stay on the paid
  // model rather than trading quality for a negligible saving.
  summaryModelCandidates: [deepseekFlashLatestModel],
} as const;

export function selectScoringModelCandidates() {
  return [...scoringConfig.scoringModelCandidates];
}

export function selectSummaryModelCandidates() {
  return [...scoringConfig.summaryModelCandidates];
}
