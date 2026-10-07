'use client';

import { useMemo } from 'react';
import { LEVEL_ZH, type RiskLevel } from '@aml/engine';
import { INK, RISK_COLOR, SURFACE } from '@/lib/theme';
import { EChart, type EChartsOption } from './EChart';

/** 0–100 gauge with level bands: 低 <25, 中 <50, 高 <75, 極高 ≥75. */
export function RiskGauge({
  score,
  level,
  height = 230,
  compact = false,
}: {
  score: number;
  level: RiskLevel;
  height?: number;
  compact?: boolean;
}) {
  const option = useMemo<EChartsOption>(
    () => ({
      animationDuration: 600,
      series: [
        {
          type: 'gauge',
          min: 0,
          max: 100,
          splitNumber: 4,
          startAngle: 210,
          endAngle: -30,
          radius: compact ? '96%' : '94%',
          center: ['50%', compact ? '56%' : '55%'],
          axisLine: {
            lineStyle: {
              width: compact ? 10 : 14,
              color: [
                [0.25, RISK_COLOR.low],
                [0.5, RISK_COLOR.medium],
                [0.75, RISK_COLOR.high],
                [1, RISK_COLOR.critical],
              ],
            },
          },
          // Surface-coloured split lines act as the 2px gap between level bands.
          splitLine: {
            distance: compact ? -10 : -14,
            length: compact ? 10 : 14,
            lineStyle: { color: SURFACE.card, width: 3 },
          },
          axisTick: { show: false },
          axisLabel: {
            show: !compact,
            distance: 20,
            color: INK.muted,
            fontSize: 11,
          },
          pointer: {
            length: '56%',
            width: compact ? 4 : 5,
            itemStyle: { color: INK.primary },
          },
          anchor: {
            show: true,
            size: compact ? 9 : 12,
            itemStyle: { color: INK.primary, borderColor: SURFACE.card, borderWidth: 2 },
          },
          title: {
            show: !compact,
            offsetCenter: [0, '80%'],
            color: INK.secondary,
            fontSize: 12,
          },
          detail: {
            valueAnimation: true,
            offsetCenter: [0, compact ? '58%' : '50%'],
            fontSize: compact ? 24 : 40,
            fontWeight: 700,
            color: INK.primary,
            formatter: '{value}',
          },
          data: [{ value: Math.round(score), name: '風險分數 / 100' }],
        },
      ],
    }),
    [score, compact],
  );
  return (
    <EChart
      option={option}
      height={height}
      ariaLabel={`風險分數 ${Math.round(score)} 分（滿分 100），風險等級：${LEVEL_ZH[level]}`}
    />
  );
}
