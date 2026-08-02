const deepseekV4Flash0731Model = "deepseek/deepseek-v4-flash-0731";

export const scoringConfig = {
  batchSize: 20,
  maxDocumentsPerRun: 20,
  preferredModel: deepseekV4Flash0731Model,
  scoringModelCandidates: [deepseekV4Flash0731Model],
  summaryModelCandidates: [deepseekV4Flash0731Model],
} as const;

export function selectScoringModelCandidates() {
  return [...scoringConfig.scoringModelCandidates];
}

export function selectSummaryModelCandidates() {
  return [...scoringConfig.summaryModelCandidates];
}
