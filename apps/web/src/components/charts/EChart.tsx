'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import {
  BarChart,
  GaugeChart,
  GraphChart,
  LineChart,
  ScatterChart,
  type BarSeriesOption,
  type GaugeSeriesOption,
  type GraphSeriesOption,
  type LineSeriesOption,
  type ScatterSeriesOption,
} from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  type DataZoomComponentOption,
  type GridComponentOption,
  type LegendComponentOption,
  type TooltipComponentOption,
  type VisualMapComponentOption,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  GaugeChart,
  BarChart,
  LineChart,
  ScatterChart,
  GraphChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export type EChartsOption = echarts.ComposeOption<
  | GaugeSeriesOption
  | BarSeriesOption
  | LineSeriesOption
  | ScatterSeriesOption
  | GraphSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | DataZoomComponentOption
  | VisualMapComponentOption
>;

export type EChartsEventHandler = (params: echarts.ECElementEvent) => void;

interface EChartProps {
  option: EChartsOption;
  /** CSS height including axis bands (never a fixed height that clips axis labels). */
  height?: number | string;
  className?: string;
  /** Accessible summary; charts also ship a table view elsewhere on the page. */
  ariaLabel: string;
  onClick?: EChartsEventHandler;
  /** Replace instead of merge on update (default true). */
  notMerge?: boolean;
}

/**
 * Thin ECharts wrapper: tree-shaken registration, init on mount, resize with the container
 * (ResizeObserver), dispose on unmount.
 */
export function EChart({ option, height = 280, className, ariaLabel, onClick, notMerge = true }: EChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);

  useEffect(() => {
    clickRef.current = onClick;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, null, { renderer: 'canvas' });
    chartRef.current = chart;
    chart.on('click', (p) => clickRef.current?.(p as echarts.ECElementEvent));
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!chart.isDisposed()) chart.resize();
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) return;
    chart.setOption(option, { notMerge, lazyUpdate: true });
  }, [option, notMerge]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ width: '100%', height, minWidth: 0 }}
    />
  );
}
