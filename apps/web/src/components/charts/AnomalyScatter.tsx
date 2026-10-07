'use client';

import { useMemo } from 'react';
import { fmtAmount, fmtUsd, shortAddress, type AnomalyResult, type NormTx } from '@aml/engine';
import { scoreRange } from '@/lib/analysis';
import { fmtDate, fmtDateTime, fmtUsdCompact } from '@/lib/format';
import { AXIS_BASE, INK, SEQ_BLUE, SURFACE, TOOLTIP_BASE } from '@/lib/theme';
import { tipLine, tipTitle } from './chartUtils';
import { EChart, type EChartsOption } from './EChart';

const DIR_ZH = { in: '轉入', out: '轉出', self: '自轉' } as const;

interface Point {
  value: [number, number, number];
  idx: number;
}

/**
 * Time × log(USD) scatter. Colour encodes the Isolation-Forest score on a single-hue
 * sequential ramp (low scores recede into the navy surface, high scores brighten); flagged
 * transactions are additionally drawn as larger diamonds with an ink ring, so the flag never
 * relies on colour alone.
 */
export function AnomalyScatter({
  txs,
  anomaly,
  labelOf,
  onPick,
  height = 340,
}: {
  txs: NormTx[];
  anomaly: AnomalyResult;
  labelOf: (address: string) => string | undefined;
  onPick?: (hash: string) => void;
  height?: number;
}) {
  const { normal, flagged, missing, min, max, reasons } = useMemo(() => {
    const reasons = new Map(anomaly.flagged.map((f) => [f.hash, f.reason]));
    const normal: Point[] = [];
    const flagged: Point[] = [];
    let missing = 0;
    const [min, max] = scoreRange(anomaly);
    txs.forEach((t, idx) => {
      const s = anomaly.scores[t.hash];
      if (s === undefined) return;
      if (!(t.usd && t.usd > 0)) {
        missing++;
        return;
      }
      const p: Point = { value: [t.ts * 1000, t.usd, s], idx };
      (reasons.has(t.hash) ? flagged : normal).push(p);
    });
    return { normal, flagged, missing, min, max, reasons };
  }, [txs, anomaly]);

  const option = useMemo<EChartsOption>(() => {
    const times = [...normal, ...flagged].map((p) => p.value[0]);
    const spanDays = times.length ? (Math.max(...times) - Math.min(...times)) / 86_400_000 : 0;
    const tooltipFor = (p: unknown) => {
      const d = (p as { data: Point }).data;
      const t = txs[d.idx];
      if (!t) return '';
      const label = labelOf(t.counterparty);
      const reason = reasons.get(t.hash);
      return (
        tipTitle(`${fmtDateTime(t.ts)}（台北時間）`) +
        tipLine('方向', DIR_ZH[t.direction]) +
        tipLine('金額', `${fmtAmount(t.amount, t.asset.symbol)} · ${fmtUsd(t.usd)}`) +
        tipLine('對手', `${shortAddress(t.counterparty)}${label ? `（${label}）` : ''}`, true) +
        tipLine('IF 異常分數', d.value[2].toFixed(3)) +
        (reason ? tipLine('標記原因', reason) : '') +
        (onPick ? `<div style="color:#8b98b0;font-size:11px;margin-top:4px">點擊以在交易明細中定位</div>` : '')
      );
    };
    return {
      grid: { left: 8, right: 16, top: 64, bottom: 40 },
      legend: {
        top: 0,
        left: 0,
        itemWidth: 12,
        itemHeight: 12,
        textStyle: { color: INK.secondary, fontSize: 12 },
        data: [
          { name: '一般交易', icon: 'circle', itemStyle: { color: SEQ_BLUE[2] } },
          { name: '異常標記', icon: 'diamond', itemStyle: { color: SEQ_BLUE[5], borderColor: INK.primary, borderWidth: 1 } },
        ],
      },
      visualMap: {
        type: 'continuous',
        dimension: 2,
        seriesIndex: [0, 1],
        min,
        max,
        orient: 'horizontal',
        left: 0,
        top: 26,
        itemWidth: 10,
        itemHeight: 110,
        calculable: false,
        precision: 2,
        text: ['高', 'IF 分數 低'],
        textGap: 6,
        textStyle: { color: INK.muted, fontSize: 11 },
        inRange: { color: [...SEQ_BLUE] },
      },
      tooltip: { ...TOOLTIP_BASE, trigger: 'item', formatter: tooltipFor },
      xAxis: {
        type: 'time',
        ...AXIS_BASE,
        splitLine: { show: false },
        // Short spans need the time of day; longer spans read better as dates.
        axisLabel: {
          ...AXIS_BASE.axisLabel,
          hideOverlap: true,
          formatter: (v: number) => (spanDays <= 3 ? fmtDateTime(v).slice(5) : fmtDate(v).slice(5)),
        },
      },
      yAxis: {
        type: 'log',
        logBase: 10,
        ...AXIS_BASE,
        axisLine: { show: false },
        axisLabel: { ...AXIS_BASE.axisLabel, formatter: (v: number) => fmtUsdCompact(v) },
      },
      dataZoom: [
        {
          type: 'slider',
          xAxisIndex: 0,
          height: 16,
          bottom: 6,
          borderColor: SURFACE.border,
          backgroundColor: SURFACE.page,
          fillerColor: 'rgba(57,135,229,0.15)',
          dataBackground: { lineStyle: { color: SURFACE.axis }, areaStyle: { color: SURFACE.raised } },
          handleStyle: { color: INK.secondary, borderColor: SURFACE.card },
          textStyle: { color: INK.muted, fontSize: 10 },
          labelFormatter: (v: number) => fmtDate(v),
        },
      ],
      series: [
        {
          type: 'scatter',
          name: '一般交易',
          data: normal,
          symbol: 'circle',
          symbolSize: 9,
          itemStyle: { borderColor: SURFACE.card, borderWidth: 1.5, opacity: 0.95 },
          emphasis: { scale: 1.6 },
        },
        {
          type: 'scatter',
          name: '異常標記',
          data: flagged,
          symbol: 'diamond',
          symbolSize: 16,
          z: 3,
          itemStyle: { borderColor: INK.primary, borderWidth: 1.5 },
          emphasis: { scale: 1.4 },
        },
      ],
    };
  }, [normal, flagged, min, max, reasons, txs, labelOf, onPick]);

  return (
    <div>
      <EChart
        option={option}
        height={height}
        ariaLabel={`交易時間與金額散佈圖：共 ${normal.length + flagged.length} 筆，其中 ${flagged.length} 筆被 Isolation Forest 標記為異常`}
        onClick={(p) => {
          const d = p.data as Point | undefined;
          const t = d ? txs[d.idx] : undefined;
          if (t && onPick) onPick(t.hash);
        }}
      />
      <p className="mt-1 text-xs text-ink-3">
        橫軸：時間（台北）；縱軸：美元金額（對數尺度）；顏色：Isolation Forest 異常分數（越亮越異常）；◆ 為超過門檻的異常標記。
        {missing > 0 && ` 另有 ${missing} 筆交易缺少美元估值，未繪於圖中（仍列於交易明細）。`}
      </p>
    </div>
  );
}
