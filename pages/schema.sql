-- The D1 tables of src/store.ts (SCHEMA), for creating them before the first request:
--   npx --no-install wrangler d1 execute taste-truce --remote --file schema.sql
-- Every statement is IF NOT EXISTS, so running it again changes nothing. A test keeps this file equal to SCHEMA.
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, used INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ip_days (day TEXT, ip TEXT, kind TEXT, used INTEGER, PRIMARY KEY(day,ip,kind));
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, at REAL NOT NULL, counted INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, busy_until REAL NOT NULL DEFAULT 0, lease TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS sessions_at ON sessions (at);
CREATE TABLE IF NOT EXISTS pace (id INTEGER PRIMARY KEY, next_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY);
