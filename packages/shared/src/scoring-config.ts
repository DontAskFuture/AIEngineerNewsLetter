const deepseekV4FlashModel = "deepseek/deepseek-v4-flash";
const hy3PreviewModel = "tencent/hy3-preview";

export const scoringConfig = {
  batchSize: 20,
  maxDocumentsPerRun: 20,
  preferredModel: deepseekV4FlashModel,
  modelPool: [
    { model: deepseekV4FlashModel, trafficWeight: 0.5 },
    { model: hy3PreviewModel, trafficWeight: 0.5 },
  ],
} as const;

export function selectScoringModelCandidates() {
  const totalWeight = scoringConfig.modelPool.reduce((total, entry) => total + entry.trafficWeight, 0);
  let cursor = Math.random() * totalWeight;
  const selected =
    scoringConfig.modelPool.find((entry) => {
      cursor -= entry.trafficWeight;
      return cursor <= 0;
    }) ?? scoringConfig.modelPool[0];

  return [
    selected.model,
    ...scoringConfig.modelPool
      .map((entry) => entry.model)
      .filter((model) => model !== selected.model),
  ];
}
