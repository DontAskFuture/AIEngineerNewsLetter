const deepseekV4FlashModel = "deepseek/deepseek-v4-flash";
const hy3PreviewModel = "tencent/hy3-preview";

export const scoringConfig = {
  batchSize: 20,
  maxDocumentsPerRun: 20,
  preferredModel: hy3PreviewModel,
  scoringModelCandidates: [hy3PreviewModel, deepseekV4FlashModel],
  summaryModelCandidates: [deepseekV4FlashModel, hy3PreviewModel],
} as const;

export function selectScoringModelCandidates() {
  return [...scoringConfig.scoringModelCandidates];
}

export function selectSummaryModelCandidates() {
  return [...scoringConfig.summaryModelCandidates];
}
