# Crypto AML Agent — AI 鏈上風險監控與異常交易偵測系統

> 課程專題。輸入 Ethereum / BNB Smart Chain / TRON / Bitcoin 地址，系統即時抓取鏈上交易，以 **21 條 AML 洗錢態樣規則 + OFAC 制裁名單 + 統計異常 + Isolation Forest 機器學習** 計算風險分數，並由 **GLM 大型語言模型 Agent** 透過工具呼叫（function calling）蒐集證據、撰寫繁體中文調查報告。

- 公開網站（Vercel）：https://crypto-aml-agent.vercel.app
- 後端 API（Cloudflare Workers）：https://crypto-aml-api.howard200507.workers.dev/api/health

## 功能

| 功能 | 說明 |
|---|---|
| 多鏈地址調查 | 自動判斷鏈別（0x → ETH/BSC、T… → TRON、bc1/1/3 → BTC），顯示風險儀表、分數組成、規則命中與證據、交易明細、資金流向、交易對手網路圖 |
| 規則引擎 | 21 條規則：制裁直接/間接暴露、混幣器、CoinJoin、結構化拆分、快速過帳、剝離鏈、資金匯集/分散、速度突增、整數金額、休眠活化、新地址大額、地址投毒、詐騙對手、跨鏈橋跳轉、高風險服務、統計離群 |
| 機器學習 | 瀏覽器端 Isolation Forest（12 維交易特徵、100 棵樹、固定種子可重現），標出異常交易並說明最偏離的特徵 |
| AI Agent | GLM 以 5 個工具（地址概況、交易紀錄、AML 分析、制裁篩查、1-hop 追蹤）自主調查，SSE 即時串流每一步；報告依 SAR 格式撰寫 |
| 防幻覺機制 | 風險分數由程式確定性計算；報告最前面插入系統評分卡，LLM 寫錯的分數/等級自動更正，未出現在工具結果中的地址/雜湊標記〔未驗證〕 |
| 即時監控 | Cron 每 10 分鐘掃描 Tornado Cash 存提款與 OFAC 制裁地址動態、每 15 分鐘重掃監控名單，產生警示並顯示於儀表板 |
| 洗錢情境 | 10 個合成教學情境（制裁+混幣、Tornado 過帳、USDT 結構化、剝離鏈、CoinJoin、地址投毒、跨鏈分層、休眠巨鯨、對照組×2），預期結果即單元測試 |

## 系統架構

```
瀏覽器 ──► Vercel（Next.js 16 靜態網站，Isolation Forest 在瀏覽器執行）
   │
   └─fetch / SSE──► Cloudflare Worker（Hono API）
                      ├─ 規則引擎 @aml/engine（與前端共用同一份程式碼）
                      ├─ GLM Agent 迴圈（工具呼叫、子請求預算、防幻覺 guard）
                      ├─ Cron：Tornado/OFAC 掃描、監控名單、每日更新制裁名單
                      ├─ D1（SQLite）：警示、監控名單、調查報告、快取、額度
                      └─ 外部資料：Zerion（ETH/BSC）、Blockscout（ETH 備援與監控掃描）、
                                   TronGrid、mempool.space、OFAC SDN 名單、Z.ai GLM
```

設計重點：Cloudflare Workers 免費方案每次請求只有 10 ms CPU 與 50 個子請求，因此重運算（Isolation Forest、圖表）放在瀏覽器；Worker 只做資料抓取、正規化、規則計算與 Agent 協調，所有外部請求都經過子請求預算控管（上限 45），分析結果快取 10 分鐘。

## 評分方式

```
S_rules = 100 × [1 − Π(1 − w_i × c_i / 100)]          規則貢獻以 noisy-OR 合成
S       = 100 × [1 − (1 − S_rules/100) × (1 − 0.1 × A)] A 為統計異常指數，最多 +10
下限：R01 制裁主體 ⇒ 100；R02 制裁往來 ⇒ ≥80；極高規則 ⇒ ≥75；高規則 ⇒ ≥50
交易所/服務商地址的行為類規則 ×0.3 減權
等級：0–24 低、25–49 中、50–74 高、75–100 極高
```

完整規則表與門檻見 [`docs/rules.md`](docs/rules.md)，網站「方法說明」頁也會直接由程式碼產生規則表。

## 專案結構

```
packages/engine   共用 TypeScript 引擎：型別、地址驗證、21 條規則、評分、Isolation Forest、情境、模板報告、API 型別
apps/worker       Cloudflare Worker：鏈上資料轉接器、Investigator、GLM Agent、路由、Cron、D1 migrations
apps/web          Next.js 前端：儀表板、地址調查、洗錢情境、監控名單、調查報告、方法說明
docs              rules.md（自動產生）、design.md（設計文件）
```

## 本機開發

需求：Node.js 22 以上。

```bash
npm install
npm test            # 引擎 134、前端 56、Worker 48 個測試
npm run typecheck

# 後端（http://localhost:8787）
cd apps/worker
cp .dev.vars.example .dev.vars          # 填入金鑰（不會進版控）
npx wrangler d1 migrations apply crypto-aml-db --local
npx wrangler dev

# 前端（http://localhost:3000）
cd apps/web
NEXT_PUBLIC_API_BASE=http://localhost:8787 npx next dev
```

## 部署

1. `npx wrangler login`、`npx vercel login`
2. `npx wrangler d1 create crypto-aml-db`，把 `database_id` 填入 `apps/worker/wrangler.jsonc`，再 `npx wrangler d1 migrations apply crypto-aml-db --remote`
3. `cd apps/worker && npx wrangler deploy`
4. 設定金鑰（在自己的終端機輸入，不要寫進檔案）：
   ```bash
   npx wrangler secret put ZERION_API_KEY    # ETH / BSC 鏈上資料（Zerion 免費 Developer 方案）
   npx wrangler secret put GLM_API_KEY       # Z.ai GLM
   npx wrangler secret put ADMIN_TOKEN       # 管理用權杖（自訂亂碼）
   ```
5. Vercel：在 repo 根目錄 `npx vercel link`，設定環境變數 `NEXT_PUBLIC_API_BASE` = Worker 網址，`npx vercel deploy --prod`（根目錄的 `vercel.json` 會以 Next.js 靜態匯出建置 `apps/web/out`）
6. 把 Vercel 網域加入 `wrangler.jsonc` 的 `ALLOWED_ORIGINS` 後重新 `wrangler deploy`

GLM 端點與模型可在 `wrangler.jsonc` 調整：`GLM_BASE_URL`（預設 Coding Plan 端點 `https://api.z.ai/api/coding/paas/v4`；一般 API 為 `https://api.z.ai/api/paas/v4`）、`GLM_MODEL`（預設 `glm-5.3`）。未設定金鑰或 GLM 失敗時，自動改用確定性模板報告。

## 濫用防護

- 每個 IP：一般 API 30 次/分、AI 調查 3 次/分與每日 15 次；GLM 全站每日 300 次上限
- Zerion 每日請求上限（預設 1,800，免費方案為 2,000）、監控名單最多 30 筆（每 IP 每日新增 3 筆，刪除需管理員權杖）
- CORS 僅允許本專案的 Vercel 網域與 localhost；金鑰只存在 Cloudflare Secrets

## 限制

- 地址標籤與制裁名單不可能完整，「未標記」不代表無風險；ETH/BSC 的 USD 為交易當時價值（Zerion），TRON/BTC 以目前市價估算。
- 為控制免費額度，每次分析僅抓取最近一頁交易（約 100 筆），較早的歷史未納入。
- 合成情境的地址與交易雜湊為隨機產生，僅供教學展示。
- 本系統僅供風險評估與學術展示，不構成法律意見或對任何人之犯罪認定。

## 資料來源

[Zerion API](https://developers.zerion.io/) · [Blockscout](https://docs.blockscout.com/) · [TronGrid](https://developers.tron.network/) · [mempool.space](https://mempool.space/docs/api) · [OFAC SDN 數位貨幣地址（0xB10C 整理）](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses) · [Z.ai GLM](https://docs.z.ai/)
