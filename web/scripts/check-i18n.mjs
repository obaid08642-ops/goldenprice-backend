// Usage: node scripts/check-i18n.mjs <code> [<code> ...]   (run from web/)
import fs from "node:fs";
const en = JSON.parse(fs.readFileSync("src/i18n/lang/en.json", "utf8"));
const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
let bad = 0;
for (const code of process.argv.slice(2)) {
  const errs = [];
  let d;
  try { d = JSON.parse(fs.readFileSync(`src/i18n/lang/${code}.json`, "utf8")); } catch (e) { console.log(`${code}: INVALID JSON (${e.message})`); bad++; continue; }
  let same = 0, total = 0;
  for (const sec of Object.keys(en)) {
    if (!d[sec]) { errs.push(`missing section ${sec}`); continue; }
    if (Array.isArray(en[sec]) || typeof en[sec] !== "object") continue;
    for (const k of Object.keys(en[sec])) {
      const a = en[sec][k], b = d[sec][k];
      if (b === undefined) { errs.push(`missing ${sec}.${k}`); continue; }
      if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) errs.push(`${sec}.${k}: array length`);
        else a.forEach((x, i) => { if (ph(x) !== ph(b[i])) errs.push(`${sec}.${k}[${i}] placeholders ${ph(x)} vs ${ph(b[i])}`); total++; if (x === b[i]) same++; });
        continue;
      }
      if (typeof b !== "string" || !b.trim()) errs.push(`${sec}.${k}: empty`);
      else { if (ph(a) !== ph(b)) errs.push(`${sec}.${k}: placeholders ${ph(a)} vs ${ph(b)}`); total++; if (a === b) same++; }
    }
    for (const k of Object.keys(d[sec])) if (!(k in en[sec])) errs.push(`extra key ${sec}.${k}`);
  }
  if (code !== "en" && total && same / total > 0.35) errs.push(`${Math.round((same / total) * 100)}% of strings identical to English (untranslated?)`);
  console.log(errs.length ? `${code}: FAIL\n  ` + errs.slice(0, 25).join("\n  ") : `${code}: OK`);
  if (errs.length) bad++;
}
process.exit(bad ? 1 : 0);
