import type { Metadata } from 'next';
import {
  CHAIN_ZH,
  FEATURE_NAMES,
  FEATURE_ZH,
  fmtDuration,
  fmtUsd,
  LEVEL_ZH,
  MIN_SAMPLES,
  RULE_CONFIG,
  ruleCatalog,
  SANCTIONS_SNAPSHOT_DATE,
  type Chain,
} from '@aml/engine';
import { BookOpen } from 'lucide-react';
import { ArchitectureDiagram } from '@/components/methodology/ArchitectureDiagram';
import { PageHeader } from '@/components/ui/Card';
import { ChainBadge, RISK_BG, SeverityChip } from '@/components/ui/badges';
import { TOOL_ZH } from '@/lib/agent';
import { cn } from '@/lib/cn';
import { RISK_ORDER } from '@/lib/theme';

export const metadata: Metadata = {
  title: '方法說明',
  description: '系統架構、資料來源、21 條 AML 偵測規則、風險評分公式、Isolation Forest 異常偵測與 GLM AI Agent 設計。',
};

const TOC = [
  { id: 'overview', label: '1. 系統概述' },
  { id: 'architecture', label: '2. 系統架構' },
  { id: 'sources', label: '3. 資料來源' },
  { id: 'rules', label: '4. 偵測規則' },
  { id: 'thresholds', label: '5. 關鍵門檻' },
  { id: 'scoring', label: '6. 風險評分' },
  { id: 'ml', label: '7. 機器學習異常偵測' },
  { id: 'agent', label: '8. AI Agent 設計' },
  { id: 'limitations', label: '9. 限制' },
  { id: 'disclaimer', label: '10. 免責聲明' },
];

const C = RULE_CONFIG;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Thresholds rendered straight from RULE_CONFIG so the documentation tracks the code. */
const THRESHOLDS: [string, string, string][] = [
  ['R03', '1-hop 追蹤的主要交易對手', `依金額前 ${C.indirect.topN} 名（BSC 前 ${C.indirect.topNBsc} 名）；強度下限 ${C.indirect.minIntensity}`],
  ['R05', 'CoinJoin 特徵', `輸入 ≥ ${C.coinjoin.minIn}、輸出 ≥ ${C.coinjoin.minOut}、等額輸出 ≥ ${C.coinjoin.minEqual}（每筆 ≥ ${C.coinjoin.minValueBtc} BTC）`],
  ['R05', 'Whirlpool 池面額', `${C.coinjoin.whirlpoolBtc.join(' / ')} BTC`],
  ['R06', '結構化：申報門檻', C.structuring.thresholdsUsd.map((v) => fmtUsd(v)).join('、')],
  ['R06', '結構化：門檻區間與頻率', `門檻 ${pct(C.structuring.band)}–100%，${fmtDuration(C.structuring.windowSec)}內 ≥ ${C.structuring.minCount} 筆`],
  ['R06', 'Smurfing（小額匯集）', `${fmtDuration(C.structuring.smurf.windowSec)}內 ≥ ${C.structuring.smurf.minSenders} 個來源、單筆 < ${fmtUsd(C.structuring.smurf.smallUsd)}、合計 ≥ ${fmtUsd(C.structuring.smurf.minTotalUsd)}`],
  ['R07', '快速過帳', `轉入後 ${fmtDuration(C.passThrough.windowSec)}（BTC ${fmtDuration(C.passThrough.windowSecBtc)}）內轉出 ≥ ${pct(C.passThrough.minShare)}；≥ ${C.passThrough.minEvents} 次；單次轉入 ≥ ${fmtUsd(C.passThrough.minInflowUsd)}`],
  ['R08', '剝離鏈', `≥ ${C.peel.minCount} 次「小額支付 + 大額找零」，小額/大額比 < ${C.peel.maxRatio}`],
  ['R09A/B', '資金匯集／分散', `24 小時內 ≥ ${C.fan.minDistinct24h} 個或 7 天內 ≥ ${C.fan.minDistinct7d} 個不同地址`],
  ['R10', '交易速度突增', `單日筆數穩健 z > ${C.velocity.minZ} 且 ≥ ${C.velocity.minCount} 筆；基線 ${C.velocity.minDays}–${C.velocity.maxDays} 天`],
  ['R11', '整數金額偏好', `整數金額占比 ≥ ${pct(C.round.minShare)}，樣本 ≥ ${C.round.minN} 筆`],
  ['R12', '休眠後活化', `沉寂 ≥ ${fmtDuration(C.dormant.gapSec)}，之後 ${fmtDuration(C.dormant.windowSec)}內移動 ≥ ${fmtUsd(C.dormant.minUsd)}`],
  ['R13', '新地址大額', `地址年齡 < ${fmtDuration(C.newAddress.maxAgeSec)}，金額 ≥ ${fmtUsd(C.newAddress.minUsd)}（≥ ${fmtUsd(C.newAddress.highUsd)} 升為高）`],
  ['R14A/B/C', '地址投毒', `粉塵 < ${fmtUsd(C.poisoning.dustUsd)}；攻擊者：對象 ≥ ${C.poisoning.attackerMinReceivers} 個、投毒轉帳占比 ≥ ${pct(C.poisoning.attackerMinShare)}；相似地址 = 首尾各 4 字元相同`],
  ['R16', '跨鏈橋跳轉', `${fmtDuration(C.bridge.windowSec)}內 ≥ ${C.bridge.minHops} 次跨鏈橋進出`],
  ['R18', '統計離群金額', `log 金額穩健 z > ${C.outlier.minZ}、≥ ${fmtUsd(C.outlier.minUsd)}、≥ 中位數 ${C.outlier.minMedianMultiple} 倍；樣本 ≥ ${C.outlier.minN}`],
  ['A', '統計異常指數', `金額/間隔/單日筆數穩健 z ≥ ${C.anomaly.minZ}（間隔 < ${C.anomaly.rapidGapSec} 秒、爆量日 ≥ ${C.anomaly.burstMinCount} 筆）；最多加成 ${pct(C.anomaly.maxLift)}`],
  ['—', '交易所／服務商減權', `×${C.dampener.factor}，適用 ${C.dampener.rules.join('、')}`],
];

const SOURCES: { what: string; source: string; detail: string; chains?: Chain[] }[] = [
  { what: 'Ethereum 鏈上資料', source: 'Zerion API（未設定金鑰時改用 Blockscout）', detail: '錢包交易：ETH 與 ERC-20 轉帳（含合約內部轉出），附交易當時 USD 價值、應用名稱與垃圾代幣標記', chains: ['eth'] },
  { what: 'BNB Smart Chain 鏈上資料', source: 'Zerion API（需 API 金鑰）', detail: '錢包交易：BNB 與 BEP-20 轉帳；未設定金鑰時 BSC 僅提供內建情境', chains: ['bsc'] },
  { what: 'TRON 鏈上資料', source: 'TronGrid', detail: '帳戶資訊、TRX 與 TRC-20（USDT/USDC）轉帳', chains: ['tron'] },
  { what: 'Bitcoin 鏈上資料', source: 'mempool.space', detail: '地址統計與 UTXO 交易（輸入/輸出明細，用於 CoinJoin 與剝離鏈判斷）', chains: ['btc'] },
  { what: '制裁名單', source: 'OFAC SDN（github.com/0xB10C/ofac-sanctioned-digital-currency-addresses）', detail: `ETH / USDT / USDC / BSC / TRX / XBT 地址；引擎內建快照日期 ${SANCTIONS_SNAPSHOT_DATE}，Worker 排程更新` },
  { what: '地址標籤', source: '內建策展名單 + Zerion 應用名稱 / Blockscout 標籤', detail: '交易所、混幣器（Tornado Cash）、跨鏈橋、穩定幣合約；外部標籤以關鍵字對應類別' },
  { what: 'AI 報告', source: 'Z.ai GLM（OpenAI 相容 API）', detail: '工具呼叫（function calling）蒐集證據後撰寫中文報告；不可用時改用規則模板' },
];

const FEATURE_NOTE: Record<(typeof FEATURE_NAMES)[number], string> = {
  log_usd: 'log₁₀(1 + 美元金額)',
  direction: '轉入 0、轉出 1、自轉 0.5',
  hour_sin: '交易時刻（UTC）的正弦編碼',
  hour_cos: '交易時刻（UTC）的餘弦編碼',
  log_gap_prev: 'log₁₀(1 + 與前一筆的秒數)',
  log_hold: '轉出距最近一次轉入的持有秒數（log）',
  cp_frequency: '該交易對手出現次數 / 總筆數',
  first_interaction: '是否為首次往來的對手（0/1）',
  label_risk: '對手標籤風險（制裁 1、混幣 0.9…未標記 0.15）',
  amount_z: 'log 金額的穩健 z 分數（截斷於 ±10）',
  round_amount: '是否為整數金額（0/1）',
  degree_24h: 'log₁₀(1 + 24 小時內不同對手數)',
};

const TOOL_DESC: Record<string, string> = {
  get_address_profile: '餘額、交易數、首次／最近活動時間與地址標籤',
  get_transactions: '近期交易摘要（方向、對手、金額、時間），供報告引用',
  run_aml_analysis: '執行 21 條規則與評分；回傳分數、等級、命中規則與證據（分數以此為準）',
  screen_sanctions: '檢查地址是否列於 OFAC SDN 名單',
  trace_counterparties: '追蹤主要交易對手的 1-hop 曝險（是否接觸制裁地址或混幣器）',
};

export default function MethodologyPage() {
  const rules = ruleCatalog();
  return (
    <div>
      <PageHeader
        title="方法說明"
        icon={BookOpen}
        description="本頁說明 Crypto AML Agent 的系統架構、資料來源、偵測規則、評分公式、機器學習異常偵測與 AI Agent 設計。規則表與門檻直接由程式碼（@aml/engine）產生，確保文件與實作一致。"
      />
      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="本頁目錄" className="hidden lg:block">
          <ol className="sticky top-24 space-y-1 border-l border-line pl-3 text-sm">
            {TOC.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`} className="block py-0.5 text-ink-3 hover:text-ink">
                  {t.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="min-w-0 space-y-12 text-sm leading-7 text-ink-2">
          <Section id="overview" title="1. 系統概述">
            <p>
              Crypto AML Agent 是一套針對加密貨幣地址的<strong className="text-ink">反洗錢（AML）風險監控與調查系統</strong>，支援
              Ethereum、BNB Smart Chain、TRON 與 Bitcoin 四條鏈。使用者輸入地址後，系統會：
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>即時抓取鏈上交易並正規化為統一格式（NormTx）；</li>
              <li>比對 OFAC 制裁名單與地址標籤，執行 21 條以洗錢態樣（typology）為基礎的偵測規則；</li>
              <li>以可解釋的公式計算 0–100 風險分數與四級風險等級；</li>
              <li>在瀏覽器端以 Isolation Forest 找出行為異常的單筆交易（與官方分數分開呈現）；</li>
              <li>由 GLM AI Agent 透過工具呼叫查證後撰寫中文調查報告，並保存執行軌跡供稽核；</li>
              <li>以排程（Cron）持續掃描監控名單，於儀表板顯示警示。</li>
            </ol>
            <p>
              設計原則是<strong className="text-ink">「分數由程式決定、文字由 LLM 撰寫」</strong>：所有數字皆可由規則與證據重現，LLM 只負責整理與敘述。
            </p>
          </Section>

          <Section id="architecture" title="2. 系統架構">
            <ArchitectureDiagram />
            <ul className="list-disc space-y-1 pl-5">
              <li><strong className="text-ink">前端</strong>：Next.js 16（App Router）部署於 Vercel；所有資料皆由瀏覽器直接呼叫 Worker API，頁面本身可靜態產生。</li>
              <li><strong className="text-ink">後端</strong>：Cloudflare Worker（Hono）提供 REST API 與 SSE 串流；D1 儲存警示、監控名單、調查紀錄與快取；Cron Triggers 執行排程掃描。</li>
              <li><strong className="text-ink">共用引擎</strong>：<code className="font-mono text-ink">@aml/engine</code> 為 TypeScript 原始碼套件，Worker 用於評分，前端用於位址偵測、格式化、Isolation Forest 與本頁的規則表。</li>
            </ul>
          </Section>

          <Section id="sources" title="3. 資料來源">
            <Table head={['資料', '來源', '內容']}>
              {SOURCES.map((s) => (
                <tr key={s.what} className="border-t border-line align-top">
                  <td className="px-3 py-2 text-ink">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {s.chains?.map((c) => <ChainBadge key={c} chain={c} />)}
                      {s.what}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink">{s.source}</td>
                  <td className="px-3 py-2">{s.detail}</td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section id="rules" title="4. 偵測規則">
            <p>
              共 {rules.length} 條規則，涵蓋制裁、混幣/匿名化、結構化、分層、詐騙、高風險服務與異常行為。下表由{' '}
              <code className="font-mono text-ink">ruleCatalog()</code> 直接產生；嚴重度為預設值，部分規則會依強度升級（例如 R06 強度 ≥ 0.85 時升為高）。
            </p>
            <Table head={['ID', '名稱', '類型', '說明', '嚴重度', '權重', '適用鏈']} minWidth={980}>
              {rules.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold text-ink">{r.id}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink">{r.title}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.typology}</td>
                  <td className="min-w-[280px] px-3 py-2">{r.description}</td>
                  <td className="px-3 py-2">
                    <SeverityChip level={r.severity} size="xs" />
                  </td>
                  <td className="tabular px-3 py-2 text-right text-ink">{r.weight}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="flex gap-1">
                      {r.chains.length === 4 ? (
                        <span className="text-xs text-ink-3">全部</span>
                      ) : (
                        (r.chains as Chain[]).map((c) => <ChainBadge key={c} chain={c} />)
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section id="thresholds" title="5. 關鍵門檻">
            <p>
              所有偵測門檻集中於 <code className="font-mono text-ink">RULE_CONFIG</code>，下表為程式內的實際值。台灣大額通貨交易申報門檻 NT$500,000 以約 US$15,500 換算。
            </p>
            <Table head={['規則', '項目', '門檻']}>
              {THRESHOLDS.map(([rule, item, value]) => (
                <tr key={`${rule}-${item}`} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink">{rule}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink">{item}</td>
                  <td className="px-3 py-2">{value}</td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section id="scoring" title="6. 風險評分">
            <p>每條命中規則 i 有權重 w<sub>i</sub>（0–100）與強度 c<sub>i</sub>（0–1）。規則分數以 noisy-OR 合成，具飽和性，多條弱訊號不會無限累加：</p>
            <Formula>S_rules = 100 · [ 1 − Π_i ( 1 − w_i · c_i / 100 ) ]</Formula>
            <p>再以統計異常指數 A（0–1；金額離群、短間隔連續交易、爆量日）做有上限的加成（最多 +10%）：</p>
            <Formula>S = 100 · [ 1 − ( 1 − S_rules / 100 ) · ( 1 − 0.1 · A ) ]</Formula>
            <p>最後套用嚴重度下限，避免關鍵訊號被稀釋，並四捨五入為整數：</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>R01（地址本身在制裁名單）⇒ S = {C.floors.subjectSanctioned}</li>
              <li>R02（與制裁地址直接往來）⇒ S ≥ {C.floors.directSanctions}</li>
              <li>任一未減權之「極高」嚴重度規則 ⇒ S ≥ {C.floors.critical}</li>
              <li>任一未減權之「高」嚴重度規則 ⇒ S ≥ {C.floors.high}</li>
            </ul>
            <p>
              <strong className="text-ink">交易所減權</strong>：若調查對象本身為交易所/服務商，行為類規則（{C.dampener.rules.join('、')}）的貢獻乘以 ×{C.dampener.factor}，以降低熱錢包大量收付造成的誤報。
            </p>
            <div className="grid gap-2 sm:grid-cols-4">
              {RISK_ORDER.map((l, i) => {
                const lo = [0, C.levels.medium, C.levels.high, C.levels.critical][i];
                const hi = [C.levels.medium - 1, C.levels.high - 1, C.levels.critical - 1, 100][i];
                return (
                  <div key={l} className="rounded-lg border border-line bg-sunken p-3">
                    <div className={cn('mb-2 h-1.5 rounded-full', RISK_BG[l])} aria-hidden />
                    <SeverityChip level={l} suffix="風險" />
                    <p className="mt-1 text-lg font-bold text-ink">
                      {lo}–{hi}
                    </p>
                    <p className="text-xs text-ink-3">{LEVEL_DESC[l]}</p>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section id="ml" title="7. 機器學習異常偵測（Isolation Forest）">
            <p>
              規則擅長捕捉已知態樣；為了發現「與該地址自身行為模式不同」的交易，系統另以 <strong className="text-ink">Isolation Forest</strong>（Liu, Ting &amp; Zhou, 2008）做非監督式異常偵測。模型在<strong className="text-ink">瀏覽器端</strong>對每個地址即時訓練與評分，不需標註資料。
            </p>
            <h3 className="text-base font-semibold text-ink">特徵（{FEATURE_NAMES.length} 維，每筆交易一列）</h3>
            <Table head={['#', '特徵', '中文名稱', '定義']}>
              {FEATURE_NAMES.map((f, i) => (
                <tr key={f} className="border-t border-line align-top">
                  <td className="tabular px-3 py-2 text-ink-3">{i + 1}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink">{f}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink">{FEATURE_ZH[f]}</td>
                  <td className="px-3 py-2">{FEATURE_NOTE[f]}</td>
                </tr>
              ))}
            </Table>
            <h3 className="text-base font-semibold text-ink">演算法</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>建立 100 棵隔離樹；每棵樹自 n 筆交易中不放回抽樣 ψ = min(256, n) 筆，樹高上限 ⌈log₂ ψ⌉。</li>
              <li>每個節點隨機選擇一個特徵與介於最小、最大值之間的切點遞迴分割；異常點通常較早被「隔離」，路徑長度 h(x) 較短。</li>
              <li>異常分數：</li>
            </ul>
            <Formula>s(x) = 2^( −E[h(x)] / c(ψ) )，c(n) = 2·H(n−1) − 2(n−1)/n，H(i) ≈ ln(i) + 0.5772</Formula>
            <ul className="list-disc space-y-1 pl-5">
              <li>s 接近 1 表示極易被隔離（異常），約 0.5 以下表示正常。<strong className="text-ink">s &gt; 0.6，或位於前 5% 且 s &gt; 0.5</strong> 時標記為異常。</li>
              <li>可解釋性：以各特徵的穩健 z 分數找出偏離最大的特徵作為標記原因（例如「金額規模異常（z=+4.2）」）。</li>
              <li>可重現性：亂數種子由地址決定，同一份資料每次結果相同。</li>
              <li>樣本需 ≥ {MIN_SAMPLES} 筆成功交易，否則顯示「樣本不足」。</li>
              <li>
                <strong className="text-ink">ML 分數與官方風險分數分開呈現</strong>，不影響規則評分；它是協助調查人員排序與聚焦的輔助訊號。
              </li>
            </ul>
          </Section>

          <Section id="agent" title="8. AI Agent 設計（Z.ai GLM）">
            <p>
              調查報告由 GLM 以 function calling 驅動的 Agent 產生。Agent 在 Worker 中執行，事件以 SSE 即時串流到瀏覽器（狀態、工具呼叫與結果、預算、報告）。可用工具：
            </p>
            <Table head={['工具', '名稱', '用途']}>
              {Object.entries(TOOL_ZH).map(([name, zh]) => (
                <tr key={name} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink">{name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink">{zh}</td>
                  <td className="px-3 py-2">{TOOL_DESC[name]}</td>
                </tr>
              ))}
            </Table>
            <h3 className="text-base font-semibold text-ink">防幻覺護欄</h3>
            <ol className="list-decimal space-y-1 pl-5">
              <li><strong className="text-ink">分數由程式計算</strong>：風險分數、等級與規則命中只來自 run_aml_analysis，LLM 無權更改。</li>
              <li><strong className="text-ink">評分卡前置</strong>：報告開頭固定插入由程式產生的評分卡（分數、S_rules、統計加成、下限與規則貢獻表），LLM 的文字接在其後。</li>
              <li><strong className="text-ink">未驗證地址標註</strong>：報告中出現、但未經工具查得的地址會被標記為「未驗證」，並統計數量顯示於報告標頭。</li>
              <li><strong className="text-ink">預算與輪數限制</strong>：限制 Worker 子請求數與 LLM 輪數，避免失控迴圈；預算即時顯示於執行軌跡。</li>
              <li><strong className="text-ink">失效安全</strong>：LLM 無法使用或逾時時，改以規則模板產生完整報告（標示「規則模板（LLM 不可用）」）。</li>
              <li><strong className="text-ink">輸入清洗</strong>：代幣名稱、標籤等鏈上字串先去除控制字元與標記符號，降低提示注入風險；前端不渲染報告中的原始 HTML。</li>
            </ol>
          </Section>

          <Section id="limitations" title="9. 限制">
            <ul className="list-disc space-y-1 pl-5">
              <li>地址標籤與制裁名單並不完整；未標記不代表無風險，制裁名單亦可能有更新延遲。</li>
              <li>受免費 API 分頁與 Worker 子請求上限影響，僅分析最近一段交易；長期歷史可能被截斷（會於「資料品質」標示）。</li>
              <li>美元估值依可取得的價格資料換算，部分代幣（尤其新發行或假冒代幣）可能缺少價格。</li>
              <li>1-hop 曝險僅追蹤主要交易對手，未做多跳圖分析；跨鏈資金流需人工串接。</li>
              <li>規則門檻為一般化設定，可能對特定業務（如做市商、支付服務）產生誤報；交易所減權僅部分緩解。</li>
              <li>Isolation Forest 只比較地址自身的交易分布，對交易筆數少或行為極為一致的地址效果有限。</li>
              <li>LLM 報告可能出現措辭不精確；所有結論應以評分卡與規則證據為準。</li>
              <li>情境資料為合成資料，用於展示偵測邏輯，不代表真實案件。</li>
            </ul>
          </Section>

          <Section id="disclaimer" title="10. 免責聲明">
            <div className="rounded-lg border border-risk-medium/40 bg-risk-medium/[0.06] p-4 text-ink-2">
              本系統為課程專題展示，僅供風險評估參考，不構成法律意見；地址標籤與制裁名單可能不完整。任何凍結、申報（STR）或拒絕往來之決定，應由合格之法令遵循人員依《洗錢防制法》及相關法規綜合判斷。本系統涉及之{' '}
              {(['eth', 'bsc', 'tron', 'btc'] as Chain[]).map((c) => CHAIN_ZH[c]).join('、')} 地址資料均來自公開區塊鏈與公開 API。
            </div>
          </Section>
        </article>
      </div>
    </div>
  );
}

const LEVEL_DESC: Record<(typeof RISK_ORDER)[number], string> = {
  low: `${LEVEL_ZH.low}：一般盡職調查即可`,
  medium: `${LEVEL_ZH.medium}：加入觀察、必要時補充說明`,
  high: `${LEVEL_ZH.high}：啟動加強盡職調查（EDD）`,
  critical: `${LEVEL_ZH.critical}：暫停往來並評估申報 STR`,
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 space-y-4">
      <h2 id={`${id}-h`} className="border-b border-line pb-2 text-xl font-bold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-line bg-sunken px-4 py-3 font-mono text-[13px] text-ink scroll-thin">
      <span className="whitespace-nowrap">{children}</span>
    </div>
  );
}

function Table({ head, children, minWidth = 640 }: { head: string[]; children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-line scroll-thin">
      <table className="w-full text-left text-[13px] leading-6" style={{ minWidth }}>
        <thead className="bg-raised text-xs text-ink-2">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
