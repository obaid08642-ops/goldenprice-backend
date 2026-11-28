// Refreshes gold bar premiums in src/data/retail/<CC>.json from the dealers in scripts/dealers.json.
// Run from web/:  PW_PATH=... node scripts/update-retail.mjs [CC ...]   (CI: see .github/workflows/retail.yml)
// Rule: nothing is invented. A size is written only if the dealer page shows it; premium = dealer ask per gram vs live spot per gram.
import fs from "node:fs";
import { createRequire } from "node:module";
import { extract, bars } from "./scrape-bars.mjs";
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || "playwright");
const API = process.env.API_URL || "https://goldenprice-backend.onrender.com";
const only = process.argv.slice(2);
const dealers = JSON.parse(fs.readFileSync("scripts/dealers.json", "utf8")).filter((d) => !only.length || only.includes(d.cc));
const ov = await (await fetch(API + "/api/overview")).json(), fx = await (await fetch(API + "/api/rates")).json();
const usdOz = ov.items.GOLD.price, today = new Date().toISOString().slice(0, 10);
const num = (s) => { const t = s.replace(/[\s ]/g, "").replace(/,/g, "."); return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const b = await chromium.launch({ proxy: proxy ? { server: proxy } : undefined });
const ctx = await b.newContext({ ignoreHTTPSErrors: true, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
for (const d of dealers) {
  const rate = d.cur === "USD" ? 1 : fx.rates[d.cur]; const spotG = (usdOz / 31.1035) * rate;
  const p = await ctx.newPage(); let rows = [];
  try {
    await p.goto(d.url, { waitUntil: "domcontentloaded", timeout: 45000 }); await p.waitForTimeout(4000);
    if (d.mode === "text") { const txt = await p.evaluate(() => document.body.innerText); for (const l of txt.split("\n")) { const c = l.split("\t").map((x) => x.trim()); if (c.length === 3) { const [g, a, z] = c.map(num); if (g && a && z) rows.push({ grams: g, prices: [a, z] }); } } }
    else rows = bars(await extract(p)).filter((r) => r.prices.length >= 2).map((r) => ({ grams: r.grams, prices: r.prices.slice(-2) }));
  } catch (e) { console.log(d.cc, "ERR", String(e.message).split("\n")[0]); }
  await p.close();
  const best = {}, buy = {};
  for (const r of rows) {
    const g = Math.round(r.grams * 10) / 10; if (g < 1 || g > 1000) continue;
    const [lo, hi] = [Math.min(...r.prices), Math.max(...r.prices)], k = (String(g).replace(/\.0$/, "")) + "g";
    const per = (x) => (d.perGram ? x : x / r.grams);
    const prem = (per(hi) / spotG - 1) * 100;
    if (!(k in best) || prem < best[k]) { best[k] = prem; buy[k] = (1 - per(lo) / spotG) * 100; }
  }
  const keys = Object.keys(best).filter((k) => best[k] > -2 && best[k] < 60);
  if (keys.length < 3) { console.log(d.cc, "skipped: only", keys.length, "valid sizes"); continue; }
  // history: one row per size per day (ask/bid per gram in local currency + the spot used), kept in git so the premium can be measured over time
  fs.mkdirSync("src/data/retail-history", { recursive: true });
  const hf = `src/data/retail-history/${d.cc}.csv`;
  if (!fs.existsSync(hf)) fs.writeFileSync(hf, "date,spot_usd_oz,fx,grams,ask_per_g,bid_per_g\n");
  const seen = new Set(fs.readFileSync(hf, "utf8").split("\n").map((l) => l.split(",").slice(0, 4).join(",")));
  const hrows = {};
  for (const r of rows) { const g = Math.round(r.grams * 10) / 10; const [lo, hi] = [Math.min(...r.prices), Math.max(...r.prices)]; const per = (x) => (d.perGram ? x : x / r.grams); const k = `${today},${usdOz.toFixed(2)},${rate},${g}`; if (g >= 1 && g <= 1000 && !seen.has(k) && !(g in hrows)) hrows[g] = `${k},${per(hi).toFixed(4)},${per(lo).toFixed(4)}\n`; }
  fs.appendFileSync(hf, Object.values(hrows).join(""));
  // premium = median over the last 30 days of history when there are at least 10 dated samples per size, otherwise today's snapshot
  const hist = fs.readFileSync(hf, "utf8").trim().split("\n").slice(1).map((l) => l.split(",")).filter((a) => a.length === 6 && (Date.now() - new Date(a[0]).getTime()) / 864e5 <= 30);
  const bySize = {}; for (const a of hist) { const spotG = (Number(a[1]) / 31.1035) * Number(a[2]); (bySize[a[3]] ??= { p: [], b: [] }).p.push((Number(a[4]) / spotG - 1) * 100); bySize[a[3]].b.push((1 - Number(a[5]) / spotG) * 100); }
  const med = (v) => { const x = [...v].sort((p, q) => p - q); return x[Math.floor(x.length / 2)]; };
  let basis = "today";
  for (const k of keys) { const h = bySize[parseFloat(k)]; if (h && h.p.length >= 10) { best[k] = med(h.p); buy[k] = med(h.b); basis = `median of ${h.p.length} days`; } }
  const f = `src/data/retail/${d.cc}.json`;
  const j = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { country: d.cc, tier: 2, confidence: "medium", gold: { vatJewelryPct: null, vatBullionPct: null, importDutyPct: null, makingPct: null, barBuybackDiscountPct: null, usedGoldDiscountPct: null }, silver: { vatJewelryPct: null, vatBullionPct: null, importDutyPct: null, makingPct: null, barPremiumPct: {}, barBuybackDiscountPct: null, usedGoldDiscountPct: null }, sources: [], notes: "Bar prices read automatically from the dealer's public price list." };
  j.gold.barPremiumPct = Object.fromEntries(keys.sort((a, b) => parseFloat(a) - parseFloat(b)).map((k) => [k, +best[k].toFixed(1)]));
  const bb = keys.map((k) => buy[k]).filter((v) => v >= 0 && v < 40).sort((a, b) => a - b); if (bb.length) j.gold.barBuybackDiscountPct = { typical: +bb[Math.floor(bb.length / 2)].toFixed(1) };
  j.verifiedAt = today; j.sources = j.sources.filter((s) => s.url !== d.url); j.sources.unshift({ name: d.name, url: d.url, what: `Gold bar ask${d.perGram ? " per gram" : ""} by size vs live spot, read automatically ${today} (premium basis: ${basis})`, quote: `${d.name} price table rows (grams, prices): ${rows.slice(0, 3).map((r) => `${r.grams} g ${r.prices.join(" / ")}`).join("; ")}` });
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n"); console.log(d.cc, "updated", keys.join(","));
}
await b.close();
