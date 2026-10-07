import { DAY, HOUR } from '../stats';

/** All detection thresholds in one place; rendered on the methodology page. */
export const RULE_CONFIG = {
  indirect: { topN: 5, topNBsc: 3, minIntensity: 0.3, shareMultiplier: 5 },
  coinjoin: { minIn: 5, minOut: 5, minEqual: 5, minValueBtc: 0.001, whirlpoolBtc: [0.001, 0.01, 0.05, 0.5] },
  structuring: {
    /** CTR-style reporting thresholds in USD: US$10k, US$3k travel-rule style, NT$500k ≈ US$15.5k. */
    thresholdsUsd: [10_000, 3_000, 15_500],
    band: 0.85,
    minCount: 3,
    windowSec: 7 * DAY,
    smurf: { minSenders: 10, smallUsd: 1_000, windowSec: DAY, minTotalUsd: 10_000 },
  },
  passThrough: { windowSec: HOUR, windowSecBtc: 6 * HOUR, minShare: 0.8, minEvents: 3, minInflowUsd: 100 },
  peel: { minCount: 3, maxRatio: 0.2 },
  fan: { minDistinct24h: 20, minDistinct7d: 50 },
  velocity: { minZ: 3.5, minCount: 10, minDays: 7, maxDays: 90 },
  round: { minShare: 0.5, minN: 5 },
  dormant: { gapSec: 180 * DAY, windowSec: 7 * DAY, minUsd: 50_000 },
  newAddress: { maxAgeSec: 30 * DAY, minUsd: 100_000, highUsd: 1_000_000 },
  poisoning: { dustUsd: 1, attackerMinReceivers: 10, attackerMinShare: 0.8 },
  bridge: { windowSec: 2 * HOUR, minHops: 2 },
  outlier: { minZ: 3.5, minUsd: 10_000, minN: 10, minMedianMultiple: 5 },
  anomaly: { minZ: 3.5, minN: 10, maxLift: 0.1, minMedianMultiple: 5, rapidGapSec: 600, burstMinCount: 10 },
  dampener: { factor: 0.3, rules: ['R06', 'R07', 'R09A', 'R09B', 'R10', 'R11', 'R18'] },
  levels: { medium: 25, high: 50, critical: 75 },
  floors: { subjectSanctioned: 100, directSanctions: 80, critical: 75, high: 50 },
} as const;
