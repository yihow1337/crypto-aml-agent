-- Admin panel: clients blocked by an administrator (identified by salted IP hash).
CREATE TABLE IF NOT EXISTS blocked_clients (
  ip_hash TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_investigations_ip ON investigations (ip_hash, created_at);
