// Usage: node scripts/check-i18n.mjs <code> [<code> ...]   (run from web/)
import fs from "node:fs";
const en = JSON.parse(fs.readFileSync("src/i18n/lang/en.json", "utf8"));
const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
let bad = 0;
function walk(a, b, path, errs, stat) {
  if (typeof a === "string") {
    if (typeof b !== "string" || !b.trim()) { errs.push(`${path}: missing/empty`); return; }
    if (ph(a) !== ph(b)) errs.push(`${path}: placeholders ${ph(a)} vs ${ph(b)}`);
    stat.total++; if (a === b) stat.same++; return;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) { errs.push(`${path}: array length`); return; }
    a.forEach((x, i) => walk(x, b[i], `${path}[${i}]`, errs, stat)); return;
  }
  if (b === undefined || typeof b !== "object") { errs.push(`${path}: missing`); return; }
  for (const k of Object.keys(a)) walk(a[k], b[k], path ? `${path}.${k}` : k, errs, stat);
  for (const k of Object.keys(b)) if (!(k in a)) errs.push(`extra key ${path}.${k}`);
}
for (const code of process.argv.slice(2)) {
  const errs = [], stat = { total: 0, same: 0 };
  let d;
  try { d = JSON.parse(fs.readFileSync(`src/i18n/lang/${code}.json`, "utf8")); } catch (e) { console.log(`${code}: INVALID JSON (${e.message})`); bad++; continue; }
  walk(en, d, "", errs, stat);
  if (code !== "en" && stat.total && stat.same / stat.total > 0.35) errs.push(`${Math.round((stat.same / stat.total) * 100)}% of strings identical to English (untranslated?)`);
  console.log(errs.length ? `${code}: FAIL (${errs.length})\n  ` + errs.slice(0, 12).join("\n  ") : `${code}: OK`);
  if (errs.length) bad++;
}
process.exit(bad ? 1 : 0);
