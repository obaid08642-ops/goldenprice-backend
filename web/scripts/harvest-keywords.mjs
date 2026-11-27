// Harvests real search phrases (Google autocomplete) for every indexable language x country and key asset.
// Usage (from web/): node scripts/harvest-keywords.mjs [--only=lang-cc,...]   (needs network access to suggestqueries.google.com)
import fs from "node:fs";
const root = new URL("..", import.meta.url).pathname;
const countriesSrc = fs.readFileSync(root + "src/data/countries.ts", "utf8");
const COUNTRIES = [...countriesSrc.matchAll(/\{ code: "(\w+)", cur: "(\w+)", langs: \[([^\]]*)\]/g)].map((m) => ({ code: m[1], langs: m[3].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean) }));
const BCP = { zh: "zh-CN", "zh-tw": "zh-TW" };
const ASSET_KEYS = ["gold", "silver", "platinum", "copper", "brent-oil", "natural-gas", "bitcoin", "ethereum", "wheat", "sp500"];
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").replace("--only=", "").split(",").filter(Boolean);
const dict = (l) => JSON.parse(fs.readFileSync(`${root}src/i18n/lang/${l}.json`, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function suggest(q, hl, gl) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) return (await r.json())[1] || [];
    } catch {}
    await sleep(800 * (i + 1));
  }
  return [];
}
const jobs = [];
for (const c of COUNTRIES) for (const l of new Set([...c.langs, "en"])) if (!only.length || only.includes(`${l}-${c.code.toLowerCase()}`)) jobs.push({ l, cc: c.code });
let done = 0;
async function run({ l, cc }) {
  const out = `${root}src/data/keywords/${l}-${cc.toLowerCase()}.json`;
  if (fs.existsSync(out) && !only.length) return;
  const d = dict(l), price = d.kw.price, hl = (BCP[l] || l).slice(0, 5), gl = cc.toLowerCase();
  const res = {};
  for (const key of ASSET_KEYS) {
    const name = d.assets[key];
    const seen = new Set();
    // natural word order for this language: look at where the price word sits in the translated page title
    const ti = d.ui.title, pi = ti.toLowerCase().indexOf(price.toLowerCase()), ai = ti.indexOf("{a}");
    const seeds = pi >= 0 && ai >= 0 ? (pi < ai ? [`${price} ${name}`] : [`${name} ${price}`]) : [`${price} ${name}`, `${name} ${price}`];
    for (const q of seeds) for (const s of await suggest(q, hl, gl)) { const t = s.trim(); if (t && t.toLowerCase() !== q.toLowerCase()) seen.add(t); await sleep(0); }
    res[key] = [...seen].slice(0, 12);
    await sleep(150);
  }
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  if (++done % 10 === 0) console.log(`${done}/${jobs.length}`);
}
const queue = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await run(queue.shift()); }));
console.log("done", done);
