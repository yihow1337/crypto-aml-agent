'use client';

import { useMemo } from 'react';
import { CATEGORY_ZH, shortAddress, type GraphEdge, type GraphNode } from '@aml/engine';
import { riskTier, type RiskTier } from '@/components/ui/badges';
import { fmtInt, fmtUsdCompact } from '@/lib/format';
import { INK, RISK_COLOR, SURFACE, TOOLTIP_BASE } from '@/lib/theme';
import { tipLine, tipTitle } from './chartUtils';
import { EChart, type EChartsOption } from './EChart';

const SUBJECT_COLOR = INK.primary;
const UNKNOWN_COLOR = '#6b7a94';

const CATEGORIES: { key: 'subject' | RiskTier; name: string; color: string }[] = [
  { key: 'subject', name: '調查對象', color: SUBJECT_COLOR },
  { key: 'critical', name: '極高風險', color: RISK_COLOR.critical },
  { key: 'high', name: '高風險', color: RISK_COLOR.high },
  { key: 'medium', name: '中風險', color: RISK_COLOR.medium },
  { key: 'low', name: '低風險（已知實體）', color: RISK_COLOR.low },
  { key: 'unknown', name: '未標記', color: UNKNOWN_COLOR },
];

export function nodeTier(n: GraphNode): RiskTier {
  if (n.category === 'sanctioned') return 'critical';
  return riskTier(n.risk, n.category !== 'unknown' && n.category !== 'other');
}

interface NodeDatum {
  id: string;
  name: string;
  value: number;
  symbolSize: number;
  category: number;
  symbol?: string;
  display: string;
  node: GraphNode;
  label?: { show: boolean };
  itemStyle?: Record<string, unknown>;
}

/**
 * Force-directed counterparty graph. Node size ∝ √volume; colour = risk tier (status scale,
 * named in the legend); the subject is an ink-coloured diamond. Labels are selective: the
 * subject, labelled entities and the five largest counterparties.
 */
export function CounterpartyGraph({
  nodes,
  edges,
  subjectId,
  onNodeClick,
  height = 460,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  subjectId: string;
  onNodeClick?: (node: GraphNode) => void;
  height?: number;
}) {
  const option = useMemo<EChartsOption>(() => {
    const maxVol = Math.max(1, ...nodes.map((n) => n.volumeUsd || 0));
    const maxEdge = Math.max(1, ...edges.map((e) => e.usd || 0));
    const subjectKey = subjectId.toLowerCase();
    const top = new Set(
      [...nodes]
        .filter((n) => n.id.toLowerCase() !== subjectKey)
        .sort((a, b) => b.volumeUsd - a.volumeUsd)
        .slice(0, 5)
        .map((n) => n.id),
    );
    const data: NodeDatum[] = nodes.map((n) => {
      const isSubject = n.category === 'subject' || n.id.toLowerCase() === subjectKey;
      const tier = nodeTier(n);
      const catIdx = isSubject ? 0 : CATEGORIES.findIndex((c) => c.key === tier);
      const size = isSubject ? 46 : 12 + 34 * Math.sqrt(Math.max(0, n.volumeUsd) / maxVol);
      const labelled = n.category !== 'unknown' && n.category !== 'other';
      return {
        id: n.id,
        name: n.id,
        value: n.volumeUsd,
        symbolSize: Math.round(size),
        category: catIdx,
        symbol: isSubject ? 'diamond' : 'circle',
        display: isSubject ? '調查對象' : n.label || shortAddress(n.id),
        node: n,
        label: { show: isSubject || labelled || top.has(n.id) },
        itemStyle: isSubject
          ? { color: SUBJECT_COLOR, borderColor: '#5598e7', borderWidth: 3 }
          : { borderColor: SURFACE.card, borderWidth: 2 },
      };
    });
    const known = new Set(nodes.map((n) => n.id));
    const links = edges
      .filter((e) => known.has(e.source) && known.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        value: e.usd,
        count: e.count,
        lineStyle: {
          width: 1 + 3.5 * (Math.log10(1 + Math.max(0, e.usd)) / Math.log10(1 + maxEdge)),
        },
      }));

    return {
      legend: {
        top: 0,
        left: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: INK.secondary, fontSize: 12 },
        data: CATEGORIES.map((c) => ({ name: c.name, icon: c.key === 'subject' ? 'diamond' : 'circle' })),
      },
      tooltip: {
        ...TOOLTIP_BASE,
        trigger: 'item',
        formatter: (p: unknown) => {
          const q = p as { dataType: 'node' | 'edge'; data: NodeDatum & { source?: string; target?: string; count?: number } };
          if (q.dataType === 'edge') {
            const d = q.data;
            const inbound = d.target?.toLowerCase() === subjectKey;
            return (
              tipTitle(inbound ? '資金流入調查對象' : '資金流出調查對象') +
              tipLine('路徑', `${shortAddress(d.source ?? '')} → ${shortAddress(d.target ?? '')}`, true) +
              tipLine('金額', fmtUsdCompact(d.value)) +
              tipLine('筆數', fmtInt(d.count))
            );
          }
          const n = q.data.node;
          return (
            tipTitle(q.data.display) +
            tipLine('地址', n.id, true) +
            tipLine('類別', CATEGORY_ZH[n.category] ?? n.category) +
            tipLine('往來總額', fmtUsdCompact(n.volumeUsd)) +
            tipLine('風險係數', n.risk.toFixed(2)) +
            (onNodeClick && n.id.toLowerCase() !== subjectKey
              ? `<div style="color:#8b98b0;font-size:11px;margin-top:4px">點擊節點可調查此地址</div>`
              : '')
          );
        },
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          top: 40,
          bottom: 8,
          left: 8,
          right: 8,
          categories: CATEGORIES.map((c) => ({ name: c.name, itemStyle: { color: c.color } })),
          data,
          links,
          edgeSymbol: ['none', 'arrow'],
          edgeSymbolSize: [0, 7],
          force: { repulsion: 280, edgeLength: [70, 180], gravity: 0.12, friction: 0.25 },
          lineStyle: { color: '#4b5d7d', opacity: 0.75, curveness: 0.15 },
          label: {
            position: 'right',
            color: INK.secondary,
            fontSize: 11,
            formatter: (p: unknown) => (p as { data: NodeDatum }).data.display,
          },
          labelLayout: { hideOverlap: true },
          emphasis: { focus: 'adjacency', lineStyle: { opacity: 1 } },
          blur: { itemStyle: { opacity: 0.25 }, lineStyle: { opacity: 0.1 } },
        },
      ],
    };
  }, [nodes, edges, subjectId, onNodeClick]);

  return (
    <EChart
      option={option}
      height={height}
      ariaLabel={`交易對手關聯圖：調查對象與 ${Math.max(0, nodes.length - 1)} 個主要交易對手的資金往來`}
      onClick={(p) => {
        if (p.dataType !== 'node' || !onNodeClick) return;
        const d = p.data as NodeDatum | undefined;
        if (d && d.node && d.id.toLowerCase() !== subjectId.toLowerCase()) onNodeClick(d.node);
      }}
    />
  );
}
