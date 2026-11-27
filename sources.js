// Free public sources for metals that have no exchange feed on Yahoo (LME base metals, battery metals, uranium, iron ore, steel).
// Primary: Trading Economics commodity pages (near real-time, shown in the first sentence). Cross-check: Westmetall LME official cash prices (previous trading day).
// Both are public web pages: scraping is rate-limited (every few hours), attributed on the site, and can be switched off with INDUSTRIAL_SCRAPE=0. A paid feed is the clean long-term replacement.
import * as cheerio from "cheerio";
import { execFile } from "node:child_process";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TE = { NICKEL: "nickel", ZINC: "zinc", LEAD: "lead", TIN: "tin", COBALT: "cobalt", LITHIUM: "lithium", URANIUM: "uranium", IRON: "iron-ore", STEEL: "steel" };
const num = (s) => Number(String(s).replace(/,/g, ""));
async function page(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return cheerio.load(await r.text())("body").text().replace(/\s+/g, " ");
}
/** returns { SYM: { price, cur, unit } } in the page's own currency/unit */
export async function fetchTradingEconomics() {
  const out = {};
  for (const [sym, slug] of Object.entries(TE)) {
    try {
      const t = await page(`https://tradingeconomics.com/commodity/${slug}`);
      const m = /(?:rose|fell|climbed|dropped|increased|decreased|gained|slipped|edged|declined|advanced|surged|jumped|eased|held|traded|retreated|rebounded)[^.]{0,40}?\bto\s+([\d,.]+)\s+(USD|CNY)\/(T|Lbs)/i.exec(t);
      if (m) out[sym] = { price: num(m[1]), cur: m[2].toUpperCase(), unit: m[3] };
    } catch (e) { console.warn(`tradingeconomics ${slug}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return out;
}
/** LME official cash settlement, USD per tonne (previous trading day) */
export async function fetchWestmetall() {
  const t = await page("https://www.westmetall.com/en/markdaten.php");
  const n = "([\\d,]+(?:\\.\\d+)?)";
  const m = new RegExp(`Copper\\s+${n}\\s+${n}\\s+Tin\\s+${n}\\s+${n}\\s+Lead\\s+${n}\\s+${n}\\s+Zinc\\s+${n}\\s+${n}\\s+Aluminium\\s+${n}\\s+${n}\\s+Nickel\\s+${n}`).exec(t);
  if (!m) throw new Error("westmetall layout changed");
  return { COPPER: num(m[1]), TIN: num(m[3]), LEAD: num(m[5]), ZINC: num(m[7]), ALUMINUM: num(m[9]), NICKEL: num(m[11]) };
}
/** merged result in USD per canonical unit (ton, lb for uranium); `rates` = USD base rates */
export async function fetchIndustrial(rates) {
  const [te, lme] = await Promise.all([fetchTradingEconomics().catch(() => ({})), fetchWestmetall().catch((e) => { console.warn("westmetall:", e.message); return {}; })]);
  const out = {};
  for (const sym of Object.keys(TE)) {
    const t = te[sym];
    let usd = null;
    if (t) usd = t.cur === "CNY" ? (rates.CNY ? t.price / rates.CNY : null) : t.price;
    const ref = lme[sym];
    if (usd != null && ref != null && Math.abs(usd - ref) / ref > 0.12) { console.warn(`${sym}: Trading Economics ${usd} vs LME ${ref} differ >12%, skipped`); continue; }
    if (usd != null) out[sym] = { price: usd, src: ref != null ? "tradingeconomics+lme" : "tradingeconomics" };
    else if (ref != null) out[sym] = { price: ref, src: "lme:westmetall" };
  }
  return out;
}
// Monthly IMF series from FRED (free CSV) for 5-year history of metals without a futures feed.
export const FRED = { NICKEL: "PNICKUSDM", ZINC: "PZINCUSDM", LEAD: "PLEADUSDM", TIN: "PTINUSDM", URANIUM: "PURANUSDM", IRON: "PIORECRUSDM" };
export async function fetchFred(id) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;
  let csv;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`FRED ${id} HTTP ${r.status}`);
    csv = await r.text();
  } catch {
    // some networks stall Node's fetch on this host; curl is a reliable fallback
    csv = await new Promise((res, rej) => execFile("curl", ["-sL", "-m", "40", "-A", UA, url], { maxBuffer: 5e6 }, (e, out) => (e ? rej(e) : res(out))));
  }
  const rows = csv.trim().split("\n").slice(1).map((l) => l.split(","));
  return rows.filter((x) => x[1] && x[1] !== ".").map(([d, v]) => ({ day: d, close: Number(v) })).filter((x) => x.close > 0);
}
