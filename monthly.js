// Monthly commodity prices (World Bank Pink Sheet) -> history + latest value. data/pinksheet.json is refreshed monthly by .github/workflows/pinksheet.yml.
import { CATALOG } from "./catalog.js";
const URL_ = process.env.PINKSHEET_URL || "https://raw.githubusercontent.com/obaid08642-ops/goldenprice-backend/main/data/pinksheet.json";
export async function loadMonthly({ bulkDaily, cache, saveCache }) {
  const r = await fetch(URL_, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`pinksheet HTTP ${r.status}`);
  const j = await r.json(), out = {};
  for (const c of CATALOG) {
    if (!c.monthly) continue;
    const pts = j.series?.[c.sym]; if (!pts?.length) continue;
    const rows = pts.map(([day, v]) => ({ day, close: v * (c.factor || 1) })).filter((x) => x.close >= c.min * 0.4 && x.close <= c.max * 2.5);
    if (!rows.length) continue;
    const last = rows[rows.length - 1];
    if (last.close < c.min || last.close > c.max) { console.warn(`${c.sym} monthly value rejected: ${last.close}`); continue; }
    out[c.sym] = await bulkDaily(c.sym, rows, "worldbank-pinksheet");
    // the entry keeps the data month as its timestamp, so the site shows it as delayed rather than live
    cache.prices[c.sym] = { price: last.close, unit: "usd", src: "worldbank-pinksheet", t: Date.parse(last.day + "T00:00:00Z") };
  }
  saveCache();
  return out;
}
