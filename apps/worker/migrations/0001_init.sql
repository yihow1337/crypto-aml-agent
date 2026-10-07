-- Crypto AML Agent — initial schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  created_ip TEXT,
  last_scanned_at INTEGER,
  last_score INTEGER,
  last_level TEXT,
  UNIQUE (chain, address)
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  source TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  tx_hash TEXT NOT NULL DEFAULT '',
  counterparty TEXT,
  usd REAL,
  created_at INTEGER NOT NULL,
  UNIQUE (chain, tx_hash, rule_id, address)
);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_chain_sev ON alerts (chain, severity);

CREATE TABLE IF NOT EXISTS sanctions_lists (
  asset TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  addresses_json TEXT NOT NULL,
  count INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_cursors (
  job TEXT PRIMARY KEY,
  cursor TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  mode TEXT NOT NULL,
  scenario_id TEXT,
  score INTEGER NOT NULL,
  level TEXT NOT NULL,
  hits_json TEXT NOT NULL,
  report_md TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT,
  trace_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_investigations_created ON investigations (created_at DESC);

CREATE TABLE IF NOT EXISTS analysis_cache (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quotas (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prices (
  symbol TEXT PRIMARY KEY,
  usd REAL NOT NULL,
  fetched_at INTEGER NOT NULL
);
