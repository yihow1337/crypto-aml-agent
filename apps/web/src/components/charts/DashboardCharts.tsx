'use client';

import { useMemo } from 'react';
import { CHAINS, LEVEL_ZH, type Alert, type Chain, type RiskLevel } from '@aml/engine';
import { fmtClock, fmtDateTime, fmtInt, toMs } from '@/lib/format';
import { AXIS_BASE, CHAIN_SHORT, INK, RISK_COLOR, RISK_ORDER, SERIES, SURFACE, TOOLTIP_BASE } from '@/lib/theme';
import { tipRow, tipTitle } from './chartUtils';
import { DataTableToggle } from './DataTableToggle';
import { EChart, type EChartsOption } from './EChart';

/**
 * Ordered risk levels (低 → 極高) as columns. The colour *means* the level (status scale),
 * and each column carries its text label on the axis, so colour is never the only cue.
 */
export function RiskLevelBars({
  counts,
  ariaLabel,
  unit = '筆',
  height = 220,
}: {
  counts: Record<RiskLevel, number>;
  ariaLabel: string;
  unit?: string;
  height?: number;
}) {
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 8, right: 8, top: 24, bottom: 4 },
      tooltip: {
        ...TOOLTIP_BASE,
        trigger: 'item',
        formatter: (p: unknown) => {
          const q = p as { dataIndex: number; value: number };
          const lv = RISK_ORDER[q.dataIndex];
          return tipRow(RISK_COLOR[lv], `${LEVEL_ZH[lv]}風險`, `${fmtInt(q.value)} ${unit}`);
        },
      },
      xAxis: {
        type: 'category',
        data: RISK_ORDER.map((l) => LEVEL_ZH[l]),
        ...AXIS_BASE,
        axisLabel: { ...AXIS_BASE.axisLabel, color: INK.secondary, fontSize: 12 },
        splitLine: { show: false },
      },
      yAxis: { type: 'value', minInterval: 1, ...AXIS_BASE, axisLine: { show: false } },
      series: [
        {
          type: 'bar',
          barMaxWidth: 24,
          data: RISK_ORDER.map((l) => ({
            value: counts[l] ?? 0,
            itemStyle: { color: RISK_COLOR[l], borderRadius: [4, 4, 0, 0] },
          })),
          label: { show: true, position: 'top', color: INK.secondary, fontSize: 11, formatter: '{c}' },
          emphasis: { itemStyle: { opacity: 0.85 } },
        },
      ],
    }),
    [counts, unit],
  );
  return (
    <>
      <EChart option={option} height={height} ariaLabel={ariaLabel} />
      <DataTableToggle
        caption={ariaLabel}
        columns={['風險等級', `數量（${unit}）`]}
        rows={RISK_ORDER.map((l) => [LEVEL_ZH[l], counts[l] ?? 0])}
      />
    </>
  );
}

/** Chain × severity stacked columns from a sample of recent alerts. */
export function ChainSeverityChart({ alerts, height = 240 }: { alerts: Alert[]; height?: number }) {
  const matrix = useMemo(() => {
    const m: Record<Chain, Record<RiskLevel, number>> = {
      eth: { low: 0, medium: 0, high: 0, critical: 0 },
      bsc: { low: 0, medium: 0, high: 0, critical: 0 },
      tron: { low: 0, medium: 0, high: 0, critical: 0 },
      btc: { low: 0, medium: 0, high: 0, critical: 0 },
    };
    for (const a of alerts) if (m[a.chain] && a.severity in m[a.chain]) m[a.chain][a.severity]++;
    return m;
  }, [alerts]);

  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 8, right: 8, top: 36, bottom: 4 },
      legend: {
        top: 0,
        left: 0,
        itemWidth: 10,
        itemHeight: 10,
        icon: 'rect',
        textStyle: { color: INK.secondary, fontSize: 12 },
        data: RISK_ORDER.map((l) => LEVEL_ZH[l]),
      },
      tooltip: {
        ...TOOLTIP_BASE,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(148,163,184,0.08)' } },
        formatter: (ps: unknown) => {
          const arr = ps as { axisValue: string; seriesIndex: number; value: number }[];
          if (!arr.length) return '';
          const total = arr.reduce((s, p) => s + (p.value || 0), 0);
          return (
            tipTitle(`${arr[0].axisValue} · 共 ${total} 筆`) +
            [...arr]
              .reverse()
              .map((p) => tipRow(RISK_COLOR[RISK_ORDER[p.seriesIndex]], LEVEL_ZH[RISK_ORDER[p.seriesIndex]], fmtInt(p.value)))
              .join('')
          );
        },
      },
      xAxis: {
        type: 'category',
        data: CHAINS.map((c) => CHAIN_SHORT[c]),
        ...AXIS_BASE,
        axisLabel: { ...AXIS_BASE.axisLabel, color: INK.secondary, fontSize: 12 },
        splitLine: { show: false },
      },
      yAxis: { type: 'value', minInterval: 1, ...AXIS_BASE, axisLine: { show: false } },
      series: RISK_ORDER.map((lv) => ({
        type: 'bar' as const,
        name: LEVEL_ZH[lv],
        stack: 'total',
        barMaxWidth: 24,
        data: CHAINS.map((c) => matrix[c][lv]),
        // Surface-coloured border = the 2px gap between stacked segments.
        itemStyle: { color: RISK_COLOR[lv], borderColor: SURFACE.card, borderWidth: 1 },
        emphasis: { focus: 'series' as const },
      })),
    }),
    [matrix],
  );

  return (
    <>
      <EChart option={option} height={height} ariaLabel="各鏈警示依嚴重度分布（堆疊長條圖）" />
      <DataTableToggle
        caption="各鏈警示依嚴重度分布"
        columns={['鏈', ...RISK_ORDER.map((l) => LEVEL_ZH[l]), '合計']}
        rows={CHAINS.map((c) => {
          const row = RISK_ORDER.map((l) => matrix[c][l]);
          return [CHAIN_SHORT[c], ...row, row.reduce((a, b) => a + b, 0)];
        })}
      />
    </>
  );
}

/** Hourly alert counts over the last 24 h (single series line with a 10% area wash). */
export function HourlyAlertsChart({
  hourly,
  height = 220,
}: {
  hourly: { hour: number; count: number }[];
  height?: number;
}) {
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 8, right: 16, top: 16, bottom: 4 },
      tooltip: {
        ...TOOLTIP_BASE,
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: INK.muted, width: 1 } },
        formatter: (ps: unknown) => {
          const arr = ps as { value: [number, number] }[];
          if (!arr.length) return '';
          const [t, c] = arr[0].value;
          return tipTitle(`${fmtDateTime(t)} 起 1 小時`) + tipRow(SERIES.primary, '警示', `${fmtInt(c)} 筆`);
        },
      },
      xAxis: {
        type: 'time',
        ...AXIS_BASE,
        splitLine: { show: false },
        axisLabel: { ...AXIS_BASE.axisLabel, formatter: (v: number) => fmtClock(v), hideOverlap: true },
      },
      yAxis: { type: 'value', minInterval: 1, ...AXIS_BASE, axisLine: { show: false } },
      series: [
        {
          type: 'line',
          name: '警示數',
          data: hourly.map((h) => [toMs(h.hour), h.count]),
          showSymbol: false,
          symbolSize: 8,
          lineStyle: { width: 2, color: SERIES.primary, cap: 'round', join: 'round' },
          itemStyle: { color: SERIES.primary, borderColor: SURFACE.card, borderWidth: 2 },
          areaStyle: { color: SERIES.primary, opacity: 0.1 },
          emphasis: { focus: 'none' },
        },
      ],
    }),
    [hourly],
  );
  return (
    <>
      <EChart option={option} height={height} ariaLabel="過去 24 小時每小時警示數折線圖" />
      <DataTableToggle
        caption="過去 24 小時每小時警示數"
        columns={['時段（台北時間）', '警示數']}
        rows={hourly.map((h) => [fmtDateTime(h.hour), h.count])}
      />
    </>
  );
}
