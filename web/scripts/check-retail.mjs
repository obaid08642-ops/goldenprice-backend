// Usage: node scripts/check-retail.mjs <CC> [<CC> ...]   (run from web/)
import fs from "node:fs";
let bad = 0;
const num = (v, lo, hi) => v === null || (typeof v === "number" && v >= lo && v <= hi);
for (const cc of process.argv.slice(2)) {
  const errs = []; let d;
  try { d = JSON.parse(fs.readFileSync(`src/data/retail/${cc}.json`, "utf8")); } catch (e) { console.log(`${cc}: INVALID JSON ${e.message}`); bad++; continue; }
  if (d.country !== cc) errs.push("country code mismatch");
  if (![1, 2].includes(d.tier)) errs.push("tier must be 1 or 2");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.verifiedAt || "")) errs.push("verifiedAt YYYY-MM-DD");
  if (!["low", "medium", "high"].includes(d.confidence)) errs.push("confidence low|medium|high");
  if (!Array.isArray(d.sources) || d.sources.length < (d.tier === 1 ? 3 : 1)) errs.push(`need >= ${d.tier === 1 ? 3 : 1} sources`);
  else d.sources.forEach((s, i) => { if (d.confidence !== "low" && (typeof s.quote !== "string" || s.quote.length < 20)) errs.push(`sources[${i}].quote (verbatim sentence read on the page, 20+ chars) is required unless confidence is low`); if (!/^https?:\/\//.test(s.url || "")) errs.push(`sources[${i}].url`); if (!s.what) errs.push(`sources[${i}].what`); });
  for (const m of ["gold", "silver"]) {
    const g = d[m]; if (!g) { errs.push(`missing ${m}`); continue; }
    for (const k of ["vatJewelryPct", "vatBullionPct", "importDutyPct"]) if (!(k in g) || !num(g[k], 0, 40)) errs.push(`${m}.${k} must be number 0-40 or null`);
    for (const k of ["makingPct", "usedGoldDiscountPct"]) {
      const v = g[k]; if (v === undefined) { errs.push(`${m}.${k} missing (use null)`); continue; }
      if (v !== null) { for (const f of ["typical", "min", "max"]) if (f in v && !num(v[f], 0, k === "makingPct" ? 35 : 60)) errs.push(`${m}.${k}.${f} out of range`); if (!("typical" in v)) errs.push(`${m}.${k}.typical required`); }
    }
    if (!g.barPremiumPct || typeof g.barPremiumPct !== "object") errs.push(`${m}.barPremiumPct must be an object (may be empty)`);
    else for (const [k, v] of Object.entries(g.barPremiumPct)) { if (!/^\d+(\.\d+)?g$/.test(k)) errs.push(`${m}.barPremiumPct key ${k}`); if (typeof v !== "number" || v < -2 || v > 60) errs.push(`${m}.barPremiumPct.${k} out of range`); }
    if (g.barBuybackDiscountPct !== null && g.barBuybackDiscountPct !== undefined && !num(g.barBuybackDiscountPct.typical, 0, 40)) errs.push(`${m}.barBuybackDiscountPct.typical`);
  }
  if (typeof d.notes !== "string" || d.notes.length > 400) errs.push("notes string <= 400 chars");
  console.log(errs.length ? `${cc}: FAIL\n  ` + errs.join("\n  ") : `${cc}: OK`); if (errs.length) bad++;
}
process.exit(bad ? 1 : 0);
