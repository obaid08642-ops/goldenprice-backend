// Validates src/data/costs-manual.json: every figure needs an official-looking https source, a recent date and a plausible value.
// Usage (from web/): node scripts/check-costs.mjs     (needs network for exchange rates; set FX_JSON=path to use a saved copy)
import fs from "node:fs";
const BLOCK = /globalpetrolprices|numbeo|zahabprice|goodreturns|statista|tradingeconomics|wikipedia|quora|reddit/i;
const data = JSON.parse(fs.readFileSync("src/data/costs-manual.json", "utf8"));
const fx = process.env.FX_JSON ? JSON.parse(fs.readFileSync(process.env.FX_JSON, "utf8")) : await (await fetch("https://open.er-api.com/v6/latest/USD")).json();
const usd = (v, cur) => v / (cur === "USD" ? 1 : fx.rates[cur]);
const errs = []; const now = Date.now();
// every figure must carry the verbatim sentence it was read from, and that sentence must contain the number
const numIn = (q, v) => { const f = [String(v), Number(v).toFixed(1), Number(v).toFixed(2), Number(v).toFixed(3), Number(v).toLocaleString("en"), String(v).replace(".", ",")]; return f.some((x) => q.includes(x)); };
const days = (d) => (now - new Date(d).getTime()) / 864e5;
for (const [cc, e] of Object.entries(data)) {
  if (!/^[A-Z]{2}$/.test(cc)) { errs.push(`${cc}: bad country code`); continue; }
  for (const k of ["fuel", "electricity"]) {
    const x = e[k]; if (!x) continue;
    const when = x.date || x.period;
    if (!/^https:\/\//.test(x.url || "") || BLOCK.test(x.url)) errs.push(`${cc}.${k}: url must be an official https page (not an aggregator): ${x.url}`);
    if (typeof x.quote !== "string" || x.quote.length < 20) errs.push(`${cc}.${k}: quote (verbatim sentence from the page, 20+ chars) is required`);
    else { const vals = k === "fuel" ? ["petrol95", "diesel", "lpg"].filter((f) => x[f] != null).map((f) => x[f]) : [x.kwh]; for (const v of vals) if (!numIn(x.quote, v)) errs.push(`${cc}.${k}: the quote does not contain the number ${v}`); }
    if (/\b(report|reports|reported|news|wire|according to)\b/i.test(x.src || "")) errs.push(`${cc}.${k}: src must name the official body that publishes the figure, not a report about it`);
    if (!x.src || BLOCK.test(x.src)) errs.push(`${cc}.${k}: src name missing or an aggregator`);
    if (!/^\d{4}-\d{2}(-\d{2})?/.test(when || "") || days(when.length === 7 ? when + "-28" : when) > 550 || days(when.length === 7 ? when + "-28" : when) < -2) errs.push(`${cc}.${k}: date must be within the last 18 months`);
    if (!fx.rates[x.cur] && x.cur !== "USD") errs.push(`${cc}.${k}: unknown currency ${x.cur}`);
    if (k === "fuel") for (const f of ["petrol95", "diesel", "lpg"]) if (x[f] != null) { const u = usd(x[f], x.cur); if (!(u > 0.05 && u < 4)) errs.push(`${cc}.fuel.${f}: ${x[f]} ${x.cur}/litre = ${u.toFixed(2)} USD is implausible (per litre, not per gallon)`); }
    if (k === "electricity") { const u = usd(x.kwh, x.cur); if (!(u > 0.005 && u < 1)) errs.push(`${cc}.electricity: ${x.kwh} ${x.cur}/kWh = ${u.toFixed(3)} USD is implausible`); }
  }
}
console.log(errs.length ? "FAIL\n" + errs.join("\n") : `OK (${Object.keys(data).length} countries)`); process.exit(errs.length ? 1 : 0);
