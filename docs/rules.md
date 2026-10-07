# 偵測規則一覽（由 `packages/engine` 規則註冊表自動產生）

| ID | 名稱 | 類型 | 說明 | 預設嚴重度 | 權重 | 適用鏈 |
|---|---|---|---|---|---|---|
| R01 | 制裁名單主體 | 制裁 | 調查地址本身列於 OFAC SDN 制裁名單，任何往來皆可能違反制裁規定。 | 極高 | 100 | ETH、BSC、TRON、BTC |
| R02 | 制裁直接往來 | 制裁 | 與 OFAC 制裁地址有直接轉入或轉出紀錄；轉出至制裁地址視為最嚴重情形。 | 極高 | 90 | ETH、BSC、TRON、BTC |
| R03 | 制裁間接暴露（1-hop） | 制裁 | 主要交易對手（依金額前 N 名）曾與制裁地址或混幣器直接往來，形成間接暴露。 | 高 | 45 | ETH、BSC、TRON、BTC |
| R04 | 混幣器互動 | 混幣/匿名化 | 與 Tornado Cash 等混幣器合約往來。存入（轉出至混幣器）權重高於提領。 | 高 | 60 | ETH、BSC、TRON、BTC |
| R05 | CoinJoin 混幣交易 | 混幣/匿名化 | 比特幣交易具多輸入、多輸出且大量輸出金額相同（Whirlpool/Wasabi 等 CoinJoin 特徵）。 | 中 | 40 | BTC |
| R06 | 結構化/拆分交易 | 結構化 (Structuring) | 7 天內多筆金額落在申報門檻 85%–100% 之間（US$10,000、US$3,000、約 NT$500,000），或 24 小時內大量小額來源匯集超過門檻（Smurfing）。 | 中 | 40 | ETH、BSC、TRON、BTC |
| R07 | 快速過帳/分層 | 分層 (Layering) | 資金轉入後短時間（EVM/TRON 1 小時、BTC 6 小時）內 80% 以上即轉出，且整體留存率極低，屬典型過水帳戶行為。 | 高 | 45 | ETH、BSC、TRON、BTC |
| R08 | 剝離鏈 (Peel Chain) | 分層 (Layering) | 比特幣交易反覆以「小額支付 + 大額找零」方式逐步剝離資金（小額/大額輸出比 < 0.2），常見於駭客與勒索款洗錢。 | 中 | 35 | BTC |
| R09A | 資金匯集 (Fan-in) | 匯集 | 24 小時內自 20 個以上（或 7 天內 50 個以上）不同地址收款，常見於詐騙收款或車手帳戶。 | 中 | 30 | ETH、BSC、TRON、BTC |
| R09B | 資金分散 (Fan-out) | 分散 | 24 小時內轉出至 20 個以上（或 7 天內 50 個以上）不同地址，常見於分散洗錢或空投洗量。 | 中 | 30 | ETH、BSC、TRON、BTC |
| R10 | 交易速度突增 | 異常行為 | 單日交易筆數相對於歷史基線的穩健 z 分數 > 3.5 且至少 10 筆。 | 中 | 25 | ETH、BSC、TRON、BTC |
| R11 | 整數金額偏好 | 異常行為 | 過半數交易為整數金額（如 10 ETH、5,000 USDT），常見於人工操作的洗錢或詐騙收付。 | 低 | 15 | ETH、BSC、TRON、BTC |
| R12 | 休眠後活化 | 異常行為 | 地址沉寂 180 天以上後，於 7 天內移動 US$50,000 以上資金。 | 中 | 30 | ETH、BSC、TRON、BTC |
| R13 | 新地址大額 | 異常行為 | 建立不到 30 天的地址即轉入或轉出 US$100,000 以上（US$1,000,000 以上為高風險）資金。 | 中 | 25 | ETH、BSC、TRON、BTC |
| R14A | 地址投毒（受害目標） | 詐騙 | 收到與既有交易對手首尾字元相同之「相似地址」發出的零元、粉塵或假冒穩定幣轉帳。 | 中 | 20 | ETH、BSC、TRON |
| R14B | 地址投毒受害轉帳 | 詐騙 | 在投毒事件後，實際轉帳至仿冒的相似地址，資金極可能已遭竊取。 | 高 | 55 | ETH、BSC、TRON |
| R14C | 地址投毒攻擊者 | 詐騙 | 地址活動以零元/粉塵/假代幣轉帳為主，且對象達 10 個以上，符合投毒攻擊者特徵。 | 高 | 60 | ETH、BSC、TRON |
| R15 | 詐騙/釣魚交易對手 | 詐騙 | 交易對手被標記為詐騙、釣魚、駭客或漏洞利用者（Blockscout 標籤、is_scam 或內建名單）。 | 高 | 50 | ETH、BSC、TRON、BTC |
| R16 | 跨鏈橋跳轉 | 分層/跨鏈 | 資金自跨鏈橋轉入後短時間內再轉往跨鏈橋，常見於跨鏈分層以切斷追蹤。 | 中 | 30 | ETH、BSC、TRON、BTC |
| R17 | 高風險服務 | 高風險服務 | 交易對手為高風險服務（如受 FinCEN 311 處分之擔保平台、無 KYC 交易所、線上博弈）。 | 高 | 40 | ETH、BSC、TRON、BTC |
| R18 | 統計離群金額 | 統計異常 | 以 log 金額的穩健 z 分數（MAD）偵測離群交易：z > 3.5、金額 ≥ US$10,000 且為中位數 5 倍以上。 | 低 | 12 | ETH、BSC、TRON、BTC |

## 評分公式

```
S_rules = 100 × [1 − Π(1 − w_i × c_i / 100)]        （noisy-OR，自然飽和）
S       = 100 × [1 − (1 − S_rules/100) × (1 − 0.1 × A)] （A = 統計異常指數，最多加 10 分）
下限：R01 ⇒ 100；R02 ⇒ ≥ 80；任何極高嚴重度 ⇒ ≥ 75；任何高嚴重度 ⇒ ≥ 50
交易所/服務商減權：R06、R07、R09A、R09B、R10、R11、R18 貢獻 × 0.3
等級：0–24 低、25–49 中、50–74 高、75–100 極高
```

## 門檻設定（`RULE_CONFIG`）

```json
{
  "indirect": {
    "topN": 5,
    "topNBsc": 3,
    "minIntensity": 0.3,
    "shareMultiplier": 5
  },
  "coinjoin": {
    "minIn": 5,
    "minOut": 5,
    "minEqual": 5,
    "minValueBtc": 0.001,
    "whirlpoolBtc": [
      0.001,
      0.01,
      0.05,
      0.5
    ]
  },
  "structuring": {
    "thresholdsUsd": [
      10000,
      3000,
      15500
    ],
    "band": 0.85,
    "minCount": 3,
    "windowSec": 604800,
    "smurf": {
      "minSenders": 10,
      "smallUsd": 1000,
      "windowSec": 86400,
      "minTotalUsd": 10000
    }
  },
  "passThrough": {
    "windowSec": 3600,
    "windowSecBtc": 21600,
    "minShare": 0.8,
    "minEvents": 3,
    "minInflowUsd": 100
  },
  "peel": {
    "minCount": 3,
    "maxRatio": 0.2
  },
  "fan": {
    "minDistinct24h": 20,
    "minDistinct7d": 50
  },
  "velocity": {
    "minZ": 3.5,
    "minCount": 10,
    "minDays": 7,
    "maxDays": 90
  },
  "round": {
    "minShare": 0.5,
    "minN": 5
  },
  "dormant": {
    "gapSec": 15552000,
    "windowSec": 604800,
    "minUsd": 50000
  },
  "newAddress": {
    "maxAgeSec": 2592000,
    "minUsd": 100000,
    "highUsd": 1000000
  },
  "poisoning": {
    "dustUsd": 1,
    "attackerMinReceivers": 10,
    "attackerMinShare": 0.8
  },
  "bridge": {
    "windowSec": 7200,
    "minHops": 2
  },
  "outlier": {
    "minZ": 3.5,
    "minUsd": 10000,
    "minN": 10,
    "minMedianMultiple": 5
  },
  "anomaly": {
    "minZ": 3.5,
    "minN": 10,
    "maxLift": 0.1,
    "minMedianMultiple": 5,
    "rapidGapSec": 600,
    "burstMinCount": 10
  },
  "dampener": {
    "factor": 0.3,
    "rules": [
      "R06",
      "R07",
      "R09A",
      "R09B",
      "R10",
      "R11",
      "R18"
    ]
  },
  "levels": {
    "medium": 25,
    "high": 50,
    "critical": 75
  },
  "floors": {
    "subjectSanctioned": 100,
    "directSanctions": 80,
    "critical": 75,
    "high": 50
  }
}
```

## 內建洗錢情境

| ID | 情境 | 鏈 | 預期等級 | 預期規則 |
|---|---|---|---|---|
| s1 | 制裁地址資金流入後轉入 Tornado Cash | ETH | 極高 | R02, R03, R04 |
| s2 | Tornado Cash 提領後快速過帳 | ETH | 高/極高 | R04, R07 |
| s3 | USDT 結構化拆分 + 高風險擔保平台 | TRON | 高 | R06, R17 |
| s4 | 駭客贓款剝離鏈 (Peel Chain) | BTC | 高/極高 | R08, R15 |
| s5 | Whirlpool CoinJoin 混幣 | BTC | 中/高 | R05 |
| s6 | 地址投毒受害者 | TRON | 高 | R14A, R14B |
| s7 | 跨鏈橋快速分層 + 資金分散 | BSC | 高/極高 | R07, R09B, R16 |
| s8 | 休眠巨鯨活化 | ETH | 中 | R12 |
| s9 | 一般散戶（對照組） | ETH | 低 | — |
| s10 | 交易所熱錢包（減權對照組） | ETH | 低/中 | R09A |
