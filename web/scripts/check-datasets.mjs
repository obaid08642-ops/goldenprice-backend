// Validates src/data/staples.json (food staples) and src/data/construction.json (building materials).
// Usage (from web/): NODE_USE_ENV_PROXY=1 node scripts/check-datasets.mjs
import fs from "node:fs";
const BLOCK = /globalpetrolprices|numbeo|zahabprice|goodreturns|statista|tradingeconomics|wikipedia|quora|reddit|blogspot|medium\.com|facebook|youtube/i;
const SPEC = {
  staples: { sugar: ["kg", 0.2, 5], rice: ["kg", 0.2, 8], wheat_flour: ["kg", 0.15, 6], cooking_oil: ["litre", 0.8, 8], eggs: ["dozen", 0.5, 12], milk: ["litre", 0.3, 4], chicken: ["kg", 1, 15], beef: ["kg", 2, 30], bread: ["loaf", 0.1, 5], tea: ["kg", 1, 60] },
  construction: { cement: ["bag50kg", 1.5, 20], cement_tonne: ["tonne", 30, 400], rebar: ["tonne", 300, 2500], bricks: ["1000pcs", 30, 600], sand: ["m3", 3, 80] },
};
const fx = process.env.FX_JSON ? JSON.parse(fs.readFileSync(process.env.FX_JSON, "utf8")) : await (await fetch("https://open.er-api.com/v6/latest/USD")).json();
const errs = []; let n = 0;
for (const kind of ["staples", "construction"]) {
  const data = JSON.parse(fs.readFileSync(`src/data/${kind}.json`, "utf8"));
  for (const [cc, e] of Object.entries(data)) {
    if (!/^[A-Z]{2}$/.test(cc)) { errs.push(`${kind}.${cc}: bad country code`); continue; }
    const rate = e.cur === "USD" ? 1 : fx.rates[e.cur]; if (!rate) { errs.push(`${kind}.${cc}: unknown currency ${e.cur}`); continue; }
    for (const [item, x] of Object.entries(e.items || {})) {
      n++; const sp = SPEC[kind][item]; const id = `${kind}.${cc}.${item}`;
      if (!sp) { errs.push(`${id}: unknown item (allowed: ${Object.keys(SPEC[kind]).join(", ")})`); continue; }
      if (x.unit !== sp[0]) errs.push(`${id}: unit must be ${sp[0]}`);
      const u = x.value / rate; if (!(u >= sp[1] && u <= sp[2])) errs.push(`${id}: ${x.value} ${e.cur} = ${u.toFixed(2)} USD per ${sp[0]} is outside ${sp[1]}-${sp[2]}`);
      if (!/^https:\/\//.test(x.url || "") || BLOCK.test(x.url)) errs.push(`${id}: url must be an official https page`);
      if (!x.src || BLOCK.test(x.src)) errs.push(`${id}: src missing or not primary`);
      const d = new Date(x.date); const age = (Date.now() - d.getTime()) / 864e5; if (isNaN(age) || age > 550 || age < -2) errs.push(`${id}: date must be within the last 18 months (YYYY-MM-DD)`);
    }
  }
}
console.log(errs.length ? "FAIL\n" + errs.join("\n") : `OK (${n} figures)`); process.exit(errs.length ? 1 : 0);
