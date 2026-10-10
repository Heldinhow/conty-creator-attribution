// Cross-runtime SQLite handle. Bun has no node:sqlite and Vitest workers
// (Node) cannot resolve bun:sqlite, so load the matching driver lazily.
export interface DatabaseHandle {
  exec(script: string): void;
  run(sql: string, params?: unknown[]): { lastInsertRowid: number };
  all<T>(sql: string, params?: unknown[]): T[];
  get<T>(sql: string, params?: unknown[]): T | undefined;
  transaction<T>(fn: () => T): T;
  close(): void;
}

function isBun(): boolean {
  return typeof process !== "undefined" && (process.versions as Record<string, string | undefined>).bun !== undefined;
}

export async function openDatabase(path: string): Promise<DatabaseHandle> {
  // @vite-ignore keeps Vitest from resolving the non-Node specifier statically.
  const driver = isBun() ? "bun:sqlite" : "node:sqlite";
  const mod = (await import(/* @vite-ignore */ driver)) as Record<string, any>;

  if (isBun()) {
    const db = new mod.Database(path);
    return {
      exec: (script) => db.exec(script),
      run: (sql, params = []) => {
        const result = db.query(sql).run(...params);
        return { lastInsertRowid: Number(result.lastInsertRowid) };
      },
      all: (sql, params = []) => db.query(sql).all(...params),
      get: (sql, params = []) => db.query(sql).get(...params) ?? undefined,
      // bun:sqlite runs synchronously, so statements already serialize.
      transaction: <T>(fn: () => T): T => db.transaction(fn)(),
      close: () => db.close(),
    };
  }

  const db = new mod.DatabaseSync(path);
  return {
    exec: (script) => db.exec(script),
    run: (sql, params = []) => {
      const result = db.prepare(sql).run(...params);
      return { lastInsertRowid: Number(result.lastInsertRowid) };
    },
    all: (sql, params = []) => db.prepare(sql).all(...params),
    get: (sql, params = []) => db.prepare(sql).get(...params) ?? undefined,
    // DatabaseSync is synchronous: one thread, no interleaving, serial by construction.
    transaction: <T>(fn: () => T): T => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    close: () => db.close(),
  };
}

export function migrate(db: DatabaseHandle): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      coupon_code TEXT NOT NULL UNIQUE,
      utm_campaign TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      total_cents INTEGER NOT NULL,
      coupon TEXT,
      utm_source TEXT,
      utm_campaign TEXT,
      store_status TEXT,
      creator_id INTEGER REFERENCES creators(id),
      attribution_status TEXT NOT NULL
    );
  `);
}
