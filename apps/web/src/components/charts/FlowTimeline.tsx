'use client';

import { useMemo } from 'react';
import type { TimelinePoint } from '@aml/engine';
import { fillDays } from '@/lib/analysis';
import { fmtInt, fmtUsdCompact } from '@/lib/format';
import { AXIS_BASE, INK, SERIES, SURFACE, TOOLTIP_BASE } from '@/lib/theme';
import { tipRow, tipTitle } from './chartUtils';
import { DataTableToggle } from './DataTableToggle';
import { EChart, type EChartsOption } from './EChart';

/** Daily inflow (up) and outflow (down) around a shared zero baseline; one y-axis. */
export function FlowTimeline({ timeline, height = 280 }: { timeline: TimelinePoint[]; height?: number }) {
  const days = useMemo(() => fillDays([...timeline].sort((a, b) => a.date.localeCompare(b.date))), [timeline]);
  const zoom = days.length > 60;

  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 8, right: 12, top: 36, bottom: zoom ? 40 : 8 },
      legend: {
        top: 0,
        left: 0,
        itemWidth: 10,
        itemHeight: 10,
        icon: 'rect',
        textStyle: { color: INK.secondary, fontSize: 12 },
        data: ['流入', '流出'],
      },
      tooltip: {
        ...TOOLTIP_BASE,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(148,163,184,0.08)' } },
        formatter: (ps: unknown) => {
          const arr = ps as { dataIndex: number }[];
          const p = arr.length ? days[arr[0].dataIndex] : undefined;
          if (!p) return '';
          const net = p.inUsd - p.outUsd;
          return (
            tipTitle(`${p.date}（UTC）· ${fmtInt(p.count)} 筆交易`) +
            tipRow(SERIES.inflow, '流入', fmtUsdCompact(p.inUsd)) +
            tipRow(SERIES.outflow, '流出', fmtUsdCompact(p.outUsd)) +
            tipRow(INK.muted, '淨流量', `${net >= 0 ? '+' : ''}${fmtUsdCompact(net)}`)
          );
        },
      },
      xAxis: {
        type: 'category',
        data: days.map((p) => p.date.slice(5)),
        ...AXIS_BASE,
        splitLine: { show: false },
        axisLabel: { ...AXIS_BASE.axisLabel, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        ...AXIS_BASE,
        axisLine: { show: false },
        axisLabel: { ...AXIS_BASE.axisLabel, formatter: (v: number) => fmtUsdCompact(Math.abs(v)) },
      },
      dataZoom: zoom
        ? [
            {
              type: 'slider',
              xAxisIndex: 0,
              startValue: Math.max(0, days.length - 60),
              height: 16,
              bottom: 6,
              borderColor: SURFACE.border,
              backgroundColor: SURFACE.page,
              fillerColor: 'rgba(57,135,229,0.15)',
              dataBackground: { lineStyle: { color: SURFACE.axis }, areaStyle: { color: SURFACE.raised } },
              handleStyle: { color: INK.secondary, borderColor: SURFACE.card },
              textStyle: { color: INK.muted, fontSize: 10 },
            },
          ]
        : [],
      series: [
        {
          type: 'bar',
          name: '流入',
          stack: 'flow',
          barMaxWidth: 24,
          data: days.map((p) => p.inUsd),
          itemStyle: { color: SERIES.inflow, borderRadius: [4, 4, 0, 0] },
        },
        {
          type: 'bar',
          name: '流出',
          stack: 'flow',
          barMaxWidth: 24,
          data: days.map((p) => -p.outUsd),
          itemStyle: { color: SERIES.outflow, borderRadius: [0, 0, 4, 4] },
        },
      ],
    }),
    [days, zoom],
  );

  return (
    <>
      <EChart option={option} height={height} ariaLabel="每日資金流入（上）與流出（下）長條圖，單位美元" />
      <DataTableToggle
        caption="每日資金流入與流出"
        columns={['日期（UTC）', '流入', '流出', '筆數']}
        rows={[...timeline]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((p) => [p.date, fmtUsdCompact(p.inUsd), fmtUsdCompact(p.outUsd), p.count])}
      />
    </>
  );
}
