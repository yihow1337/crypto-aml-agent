import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Row = Record<string, unknown>;

class Stmt {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}
  bind(...params: unknown[]): Stmt {
    return new Stmt(this.db, this.sql, params);
  }
  private args(): (string | number | bigint | null | Uint8Array)[] {
    return this.params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p)) as never;
  }
  async first<T = Row>(col?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.args()) as Row | undefined;
    if (!row) return null;
    return (col ? row[col] : { ...row }) as T;
  }
  async all<T = Row>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const rows = this.db.prepare(this.sql).all(...this.args()) as Row[];
    return { results: rows.map((r) => ({ ...r })) as T[], success: true, meta: {} };
  }
  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const r = this.db.prepare(this.sql).run(...this.args());
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async raw<T = unknown[]>(): Promise<T[]> {
    const rows = this.db.prepare(this.sql).all(...this.args()) as Row[];
    return rows.map((r) => Object.values(r)) as T[];
  }
}

/** Minimal D1Database stand-in backed by node:sqlite, with the project's migrations applied. */
export function createTestD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  const dir = join(__dirname, '..', '..', 'migrations');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  const d1 = {
    prepare: (sql: string) => new Stmt(db, sql),
    batch: async (stmts: Stmt[]) => {
      const out = [];
      db.exec('BEGIN');
      try {
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return out;
    },
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
  return d1 as unknown as D1Database;
}
