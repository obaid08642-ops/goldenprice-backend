// db.js - Neon Postgres storage for price history (optional: no-op without DATABASE_URL)
import { neon } from "@neondatabase/serverless";

const URL = process.env.DATABASE_URL || "";
const sql = URL ? neon(URL) : null;
export const dbEnabled = !!sql;
export { sql };

const TICK_MIN_GAP_MS = 5 * 60 * 1000; // at most one raw tick per symbol per 5 min
const lastTick = new Map();

export async function initDb() {
  if (!sql) return false;
  await sql`CREATE TABLE IF NOT EXISTS price_ticks (
    symbol TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    price DOUBLE PRECISION NOT NULL, src TEXT)`;
  await sql`CREATE INDEX IF NOT EXISTS price_ticks_sym_ts ON price_ticks (symbol, ts DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS price_daily (
    symbol TEXT NOT NULL, day DATE NOT NULL,
    open DOUBLE PRECISION, high DOUBLE PRECISION, low DOUBLE PRECISION, close DOUBLE PRECISION,
    n INT NOT NULL DEFAULT 1, src TEXT, PRIMARY KEY (symbol, day))`;
  await sql`CREATE TABLE IF NOT EXISTS contact_messages (id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(), name TEXT, email TEXT, message TEXT, ip TEXT)`;
  await sql`CREATE TABLE IF NOT EXISTS api_keys (key TEXT PRIMARY KEY, email TEXT NOT NULL, purpose TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), disabled BOOLEAN NOT NULL DEFAULT false)`;
  await sql`CREATE TABLE IF NOT EXISTS alerts (id SERIAL PRIMARY KEY, email TEXT NOT NULL, sym TEXT NOT NULL, dir TEXT NOT NULL, target DOUBLE PRECISION NOT NULL, label TEXT, lang TEXT, token TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), fired_at TIMESTAMPTZ)`;
  await sql`CREATE INDEX IF NOT EXISTS alerts_active ON alerts (sym) WHERE fired_at IS NULL`;
  await sql`CREATE TABLE IF NOT EXISTS api_clients (
    id SERIAL PRIMARY KEY, email TEXT NOT NULL, purpose TEXT, requested_plan TEXT NOT NULL DEFAULT 'free', requested_scopes TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending', plan TEXT NOT NULL DEFAULT 'free', scopes TEXT[] NOT NULL DEFAULT '{}', api_key TEXT UNIQUE, status_token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), approved_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, provider TEXT, provider_ref TEXT, note TEXT)`;
  await sql`CREATE INDEX IF NOT EXISTS api_clients_status ON api_clients (status)`;
  return true;
}

// Record a price. Daily OHLC is kept forever (tiny); raw ticks are pruned after 30 days.
export async function recordPrice(symbol, price, src = "", force = false) {
  if (!sql) return;
  const nowMs = Date.now();
  const gap = nowMs - (lastTick.get(symbol) || 0);
  if (!force && gap < TICK_MIN_GAP_MS) return;
  lastTick.set(symbol, nowMs);
  await sql`INSERT INTO price_ticks (symbol, price, src) VALUES (${symbol}, ${price}, ${src})`;
  await sql`INSERT INTO price_daily (symbol, day, open, high, low, close, src)
    VALUES (${symbol}, (now() AT TIME ZONE 'UTC')::date, ${price}, ${price}, ${price}, ${price}, ${src})
    ON CONFLICT (symbol, day) DO UPDATE SET
      high = GREATEST(price_daily.high, EXCLUDED.high),
      low = LEAST(price_daily.low, EXCLUDED.low),
      close = EXCLUDED.close, n = price_daily.n + 1, src = EXCLUDED.src`;
}

export async function pruneTicks() {
  if (!sql) return;
  await sql`DELETE FROM price_ticks WHERE ts < now() - interval '30 days'`;
}

export async function dailyHistory(symbol, days = 365) {
  if (!sql) return null;
  const rows = await sql`SELECT to_char(day,'YYYY-MM-DD') AS date, close AS value, open, high, low, src
    FROM price_daily WHERE symbol = ${symbol} AND day >= (now() AT TIME ZONE 'UTC')::date - ${days}::int
    ORDER BY day`;
  return rows;
}

export async function recentTicks(symbol, hours = 24) {
  if (!sql) return null;
  return sql`SELECT ts, price AS value FROM price_ticks
    WHERE symbol = ${symbol} AND ts >= now() - (${hours}::int * interval '1 hour') ORDER BY ts`;
}

export async function listSymbols() {
  if (!sql) return null;
  return (await sql`SELECT DISTINCT symbol FROM price_daily ORDER BY symbol`).map((r) => r.symbol);
}

// Bulk-insert daily closes (used for history backfill). Never overwrites days already recorded live.
export async function bulkDaily(symbol, rows, src = "backfill") {
  if (!sql || !rows.length) return 0;
  const days = rows.map((r) => r.day), closes = rows.map((r) => r.close);
  const res = await sql`INSERT INTO price_daily (symbol, day, open, high, low, close, src)
    SELECT ${symbol}, d::date, c, c, c, c, ${src} FROM unnest(${days}::text[], ${closes}::float8[]) AS t(d, c)
    ON CONFLICT (symbol, day) DO NOTHING RETURNING 1`;
  return res.length;
}

// One round of queries for the whole catalog: last 12 closes, 52-week range, all-time range and reference closes for performance figures.
export async function overviewStats() {
  if (!sql) return null;
  const [hist, agg, ...refs] = await Promise.all([
    sql`SELECT symbol, to_char(day,'YYYY-MM-DD') AS date, close AS value, src FROM price_daily WHERE day >= (now() AT TIME ZONE 'UTC')::date - 12 ORDER BY symbol, day`,
    sql`SELECT symbol,
        max(close) FILTER (WHERE day >= (now() AT TIME ZONE 'UTC')::date - 365) AS hi52, min(close) FILTER (WHERE day >= (now() AT TIME ZONE 'UTC')::date - 365) AS lo52,
        max(close) AS ath, min(close) AS atl, to_char(min(day),'YYYY-MM-DD') AS since,
        (array_agg(to_char(day,'YYYY-MM-DD') ORDER BY close DESC))[1] AS ath_day, (array_agg(to_char(day,'YYYY-MM-DD') ORDER BY close ASC))[1] AS atl_day
      FROM price_daily GROUP BY symbol`,
    ...[7, 30, 90, 365, 1825].map((n) => sql`SELECT DISTINCT ON (symbol) symbol, close FROM price_daily WHERE day <= (now() AT TIME ZONE 'UTC')::date - ${n}::int ORDER BY symbol, day DESC`),
    sql`SELECT DISTINCT ON (symbol) symbol, close FROM price_daily WHERE day < date_trunc('year', now() AT TIME ZONE 'UTC')::date ORDER BY symbol, day DESC`,
  ]);
  const by = (rows) => Object.fromEntries(rows.map((r) => [r.symbol, r]));
  const names = ["d7", "d30", "d90", "y1", "y5", "ytd"];
  return { hist, agg: by(agg), refs: Object.fromEntries(names.map((n, i) => [n, by(refs[i])])) };
}

// ---- contact, API keys, alerts ----
export async function saveContact(name, email, message, ip) { if (!sql) return false; await sql`INSERT INTO contact_messages (name, email, message, ip) VALUES (${name}, ${email}, ${message}, ${ip})`; return true; }
export async function createKey(key, email, purpose) { if (!sql) return false; await sql`INSERT INTO api_keys (key, email, purpose) VALUES (${key}, ${email}, ${purpose})`; return true; }
export async function keyActive(key) { if (!sql) return false; const r = await sql`SELECT 1 FROM api_keys WHERE key = ${key} AND NOT disabled`; return r.length > 0; }
export async function addAlert(a) { if (!sql) return false; await sql`INSERT INTO alerts (email, sym, dir, target, label, lang, token) VALUES (${a.email}, ${a.sym}, ${a.dir}, ${a.target}, ${a.label}, ${a.lang}, ${a.token})`; return true; }
export async function activeAlerts() { if (!sql) return []; return sql`SELECT id, email, sym, dir, target, label, lang, token FROM alerts WHERE fired_at IS NULL`; }
export async function markAlertFired(id) { if (!sql) return; await sql`UPDATE alerts SET fired_at = now() WHERE id = ${id}`; }
export async function cancelAlert(token) { if (!sql) return 0; return (await sql`DELETE FROM alerts WHERE token = ${token} AND fired_at IS NULL RETURNING 1`).length; }
