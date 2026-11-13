import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });

export const dbFile = path.join(config.dataDir, "eloheaven.db");
export const db = new DatabaseSync(dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA temp_store = MEMORY;
`);

/**
 * Append-only migrations. Never edit an entry that has shipped; add a new one.
 */
const migrations: string[] = [
  `
  CREATE TABLE users (
    id              INTEGER PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT,
    discord_id      TEXT UNIQUE,
    avatar_url      TEXT,
    role            TEXT NOT NULL DEFAULT 'customer'
                    CHECK (role IN ('owner','admin','moderator','booster','customer')),
    trust_rate      INTEGER NOT NULL DEFAULT 50 CHECK (trust_rate BETWEEN 0 AND 100),
    bio             TEXT NOT NULL DEFAULT '',
    main_roles      TEXT NOT NULL DEFAULT '[]',
    main_champions  TEXT NOT NULL DEFAULT '[]',
    prefs           TEXT NOT NULL DEFAULT '{}',
    client_key      TEXT UNIQUE,
    banned          INTEGER NOT NULL DEFAULT 0,
    ban_reason      TEXT,
    register_ip     TEXT,
    last_ip         TEXT,
    created_at      INTEGER NOT NULL,
    last_seen_at    INTEGER
  );

  CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,           -- sha256(token)
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    ip          TEXT,
    user_agent  TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX sessions_expires ON sessions(expires_at);

  CREATE TABLE subscriptions (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    starts_at   INTEGER NOT NULL,
    ends_at     INTEGER NOT NULL,
    note        TEXT,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX subscriptions_user ON subscriptions(user_id, ends_at);

  CREATE TABLE accounts (
    id              INTEGER PRIMARY KEY,
    pool            TEXT NOT NULL DEFAULT 'booster' CHECK (pool IN ('booster','community')),
    owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    active          INTEGER NOT NULL DEFAULT 1,
    riot_id         TEXT NOT NULL,
    server          TEXT NOT NULL,
    puuid           TEXT,
    login_enc       TEXT NOT NULL,
    password_enc    TEXT NOT NULL,
    trust_required  INTEGER NOT NULL DEFAULT 0,
    notes           TEXT NOT NULL DEFAULT '',

    level           INTEGER,
    profile_icon    INTEGER,
    solo_tier       TEXT,
    solo_division   TEXT,
    solo_lp         INTEGER NOT NULL DEFAULT 0,
    solo_wins       INTEGER NOT NULL DEFAULT 0,
    solo_losses     INTEGER NOT NULL DEFAULT 0,
    flex_tier       TEXT,
    flex_division   TEXT,
    flex_lp         INTEGER NOT NULL DEFAULT 0,
    flex_wins       INTEGER NOT NULL DEFAULT 0,
    flex_losses     INTEGER NOT NULL DEFAULT 0,
    solo_score      INTEGER NOT NULL DEFAULT 0,
    flex_score      INTEGER NOT NULL DEFAULT 0,

    be              INTEGER,
    rp              INTEGER,
    refunds         INTEGER,
    champions       TEXT NOT NULL DEFAULT '[]',
    champion_count  INTEGER NOT NULL DEFAULT 0,
    flash_on_f      INTEGER NOT NULL DEFAULT 0,

    banned          INTEGER NOT NULL DEFAULT 0,
    ban_info        TEXT,
    in_game         INTEGER NOT NULL DEFAULT 0,

    refresh_token_enc TEXT,
    token_status    TEXT NOT NULL DEFAULT 'none' CHECK (token_status IN ('none','ok','invalid')),
    store_synced_at INTEGER,
    rank_synced_at  INTEGER,
    riotid_synced_at INTEGER,
    sync_error      TEXT,

    in_use_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    in_use_since    INTEGER,
    lease_expires_at INTEGER,

    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE INDEX accounts_pool ON accounts(pool, active, solo_score DESC);
  CREATE INDEX accounts_in_use ON accounts(in_use_by);
  CREATE UNIQUE INDEX accounts_riot ON accounts(server, riot_id COLLATE NOCASE);

  CREATE TABLE submissions (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    login_enc     TEXT NOT NULL,
    password_enc  TEXT NOT NULL,
    server        TEXT NOT NULL,
    riot_id       TEXT,
    note          TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    reviewer_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    review_note   TEXT,
    account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    created_at    INTEGER NOT NULL,
    reviewed_at   INTEGER
  );
  CREATE INDEX submissions_status ON submissions(status, created_at);
  CREATE INDEX submissions_user ON submissions(user_id);

  CREATE TABLE activity (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    details     TEXT,
    ip          TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX activity_created ON activity(created_at DESC);
  CREATE INDEX activity_user ON activity(user_id, created_at DESC);
  CREATE INDEX activity_account ON activity(account_id, created_at DESC);

  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  `,
];

function migrate() {
  const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = current; v < migrations.length; v++) {
    tx(() => {
      db.exec(migrations[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
    console.log(`[db] applied migration ${v + 1}`);
  }
}

let txDepth = 0;
/** Run fn inside a transaction (nested calls join the outer transaction). */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  db.exec("BEGIN IMMEDIATE");
  txDepth++;
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    txDepth--;
  }
}

type Params = SQLInputValue[] | Record<string, SQLInputValue>;

const cache = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
function stmt(sql: string) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

function call<R>(sql: string, params: Params | undefined, fn: (s: ReturnType<typeof stmt>, p: any[]) => R): R {
  const s = stmt(sql);
  if (params === undefined) return fn(s, []);
  if (Array.isArray(params)) return fn(s, params);
  return fn(s, [params]);
}

export const q = {
  get<T = Record<string, any>>(sql: string, params?: Params): T | undefined {
    return call(sql, params, (s, p) => s.get(...p)) as T | undefined;
  },
  all<T = Record<string, any>>(sql: string, params?: Params): T[] {
    return call(sql, params, (s, p) => s.all(...p)) as T[];
  },
  run(sql: string, params?: Params) {
    return call(sql, params, (s, p) => s.run(...p));
  },
};

migrate();

/** Periodic housekeeping: drop expired sessions, trim very old activity. */
export function housekeeping() {
  const now = Date.now();
  q.run("DELETE FROM sessions WHERE expires_at < ?", [now]);
  q.run("DELETE FROM activity WHERE created_at < ?", [now - 180 * 86400_000]);
  db.exec("PRAGMA optimize");
}

export function closeDb() {
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {}
  db.close();
}
