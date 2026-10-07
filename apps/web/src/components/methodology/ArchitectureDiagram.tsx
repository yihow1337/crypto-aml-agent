/** Hand-made system architecture diagram (inline SVG, theme tokens via Tailwind fill/stroke utilities). */

function Box({
  x,
  y,
  w,
  h,
  title,
  lines = [],
  tone = 'default',
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  lines?: string[];
  tone?: 'default' | 'accent' | 'ext' | 'store';
}) {
  const fill = tone === 'accent' ? 'fill-[#15284a]' : tone === 'ext' ? 'fill-sunken' : tone === 'store' ? 'fill-[#1a2440]' : 'fill-raised';
  const stroke = tone === 'accent' ? 'stroke-accent' : 'stroke-line-strong';
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} className={`${fill} ${stroke}`} strokeWidth={1.25} />
      <text x={x + 14} y={y + 24} className="fill-ink" fontSize={14} fontWeight={600}>
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={i} x={x + 14} y={y + 44 + i * 17} className="fill-ink-3" fontSize={12}>
          {l}
        </text>
      ))}
    </g>
  );
}

function Arrow({ d, label, lx, ly, dashed }: { d: string; label?: string; lx?: number; ly?: number; dashed?: boolean }) {
  return (
    <g>
      <path
        d={d}
        className="stroke-ink-3"
        strokeWidth={1.4}
        fill="none"
        markerEnd="url(#arch-arrow)"
        strokeDasharray={dashed ? '5 4' : undefined}
      />
      {label && lx !== undefined && ly !== undefined && (
        <text x={lx} y={ly} className="fill-ink-2" fontSize={11.5} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

const EXTERNAL = [
  { title: 'Zerion', line: 'Ethereum / BNB Chain 錢包交易' },
  { title: 'Blockscout', line: 'ETH 備援資料・地址標籤' },
  { title: 'TronGrid', line: 'TRON：TRX / TRC-20' },
  { title: 'mempool.space', line: 'Bitcoin：UTXO 交易' },
  { title: 'OFAC SDN 名單', line: '制裁地址（每日匯出）' },
  { title: 'Z.ai GLM', line: 'LLM・Tool calling' },
];

export function ArchitectureDiagram() {
  const extX = 740;
  const extW = 200;
  const extH = 56;
  const extY = (i: number) => 36 + i * 74;
  return (
    <figure className="relative overflow-x-auto rounded-xl border border-line bg-surface p-3 scroll-thin">
      <svg
        viewBox="0 0 960 500"
        className="h-auto w-full min-w-[760px]"
        role="img"
        aria-labelledby="arch-title arch-desc"
      >
        <title id="arch-title">Crypto AML Agent 系統架構圖</title>
        <desc id="arch-desc">
          使用者瀏覽器自 Vercel 上的 Next.js 載入前端，並直接以 fetch 呼叫 Cloudflare Worker 的 Hono API 與 SSE 串流。
          Worker 內含 AI Agent、共用規則引擎、Cron 排程掃描與 D1 資料庫，並向 Zerion、Blockscout、TronGrid、mempool.space、
          OFAC 名單與 Z.ai GLM 取得資料。
        </desc>
        <defs>
          <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-ink-3" />
          </marker>
        </defs>

        {/* Client side */}
        <Box x={16} y={36} w={204} h={170} title="使用者瀏覽器" tone="accent" lines={['React UI・ECharts 圖表', 'Isolation Forest（瀏覽器端 ML）', '@aml/engine 位址偵測/格式化', 'SSE 解析（fetch + Stream）']} />
        <Box x={16} y={300} w={204} h={130} title="Vercel・Next.js 16" lines={['App Router 靜態頁面', 'Tailwind CSS v4', '僅提供前端資源，', '資料皆由瀏覽器向 API 取得']} />
        <Arrow d="M118,300 L118,212" label="載入頁面" lx={160} ly={262} />

        {/* Worker */}
        <rect x={300} y={20} width={380} height={460} rx={14} className="fill-[#0e1830] stroke-accent/70" strokeWidth={1.5} strokeDasharray="6 4" />
        <text x={316} y={44} className="fill-accent-ink" fontSize={14} fontWeight={700}>
          Cloudflare Worker
        </text>
        <Box x={320} y={60} w={340} h={64} title="Hono REST API　/api/*" lines={['analyze・alerts・stats・watchlist・investigations']} />
        <Box x={320} y={136} w={340} h={64} title="AI Agent（SSE 串流）" lines={['GLM 工具呼叫迴圈・子請求預算・防幻覺護欄']} />
        <Box x={320} y={212} w={340} h={64} title="@aml/engine 共用規則引擎" lines={['21 條 AML 規則・評分・制裁比對・報告模板']} />
        <Box x={320} y={288} w={340} h={64} title="Cron Triggers 排程" lines={['監控名單／制裁地址掃描・產生警示']} />
        <Box x={320} y={364} w={340} h={92} title="D1（SQLite）" tone="store" lines={['alerts・watchlist・investigations', '分析快取・速率限制']} />

        <Arrow d="M220,104 L318,92" label="REST JSON" lx={262} ly={86} />
        <Arrow d="M220,150 L318,168" label="POST + SSE" lx={262} ly={182} />
        <Arrow d="M490,124 L490,134" />
        <Arrow d="M490,200 L490,210" />
        <Arrow d="M490,352 L490,362" />
        <Arrow d="M470,276 L470,286" dashed />

        {/* External sources */}
        {EXTERNAL.map((e, i) => (
          <g key={e.title}>
            <Box x={extX} y={extY(i)} w={extW} h={extH} title={e.title} lines={[e.line]} tone="ext" />
            <Arrow d={`M682,${extY(i) + extH / 2} L${extX - 2},${extY(i) + extH / 2}`} />
          </g>
        ))}
        <text x={extX} y={24} className="fill-ink-3" fontSize={12}>
          外部資料來源
        </text>
      </svg>
      <figcaption className="mt-2 px-1 text-xs text-ink-3">
        圖：系統架構。實線為主要資料流；虛線框為 Cloudflare Worker 執行環境。規則引擎同時被 Worker（評分）與瀏覽器（位址偵測、Isolation Forest）使用，確保文件、前端與後端邏輯一致。
      </figcaption>
    </figure>
  );
}
