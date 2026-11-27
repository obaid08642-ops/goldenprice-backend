// Dealer bar-price scraper. Usage: node scripts/scrape-bars.mjs <url> [...]  (prints candidate bar rows: weight + prices)
// Pure extraction only: no numbers are invented. A row counts when a cell holds a weight (g/oz/tola/baht...) and >=1 other numeric cells.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || "playwright");
const W = /^\s*(\d{1,4}(?:[.,]\d{1,3})?)\s*(?:x\s*)?(g|gr|gm|gram|grams|grm|г|гр|грам|грамм|граммов|غ|جرام|غرام|oz|ozt|унц\w*|tola|तोला|baht|บาท|chỉ|lượng|lang)\b/i;
const NUM = /(\d{1,3}(?:[ .,  ]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/;
const toNum = (s) => { let t = String(s).replace(/[\s  ]/g, ""); const m = t.match(/\d[\d.,]*/); if (!m) return null; t = m[0];
  if (/,\d{1,2}$/.test(t) && /\./.test(t)) t = t.replace(/\./g, "").replace(",", "."); else if (/,\d{1,2}$/.test(t)) t = t.replace(",", "."); else t = t.replace(/,/g, "");
  const v = Number(t); return Number.isFinite(v) ? v : null; };
export async function extract(page) {
  return page.evaluate(() => [...document.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.innerText.trim().replace(/\s+/g, " "))).filter((r) => r.length >= 2));
}
export function bars(rows) {
  const out = [];
  for (const r of rows) {
    const wi = r.findIndex((c) => W.test(c) && c.length < 25); if (wi < 0) continue;
    const m = r[wi].match(W); let g = Number(m[1].replace(",", ".")); const u = m[2].toLowerCase();
    if (/^oz|унц/.test(u)) g *= 31.1035; else if (/tola|तोला/.test(u)) g *= 11.6638; else if (/baht|บาท/.test(u)) g *= 15.244; else if (/chỉ/.test(u)) g *= 3.75; else if (/lượng|lang/.test(u)) g *= 37.5;
    const prices = r.filter((_, i) => i !== wi).map(toNum).filter((v) => v && v > 0);
    if (prices.length) out.push({ grams: +g.toFixed(4), prices, raw: r.join(" | ").slice(0, 120) });
  }
  return out;
}
if (process.argv[1].endsWith("scrape-bars.mjs")) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const b = await chromium.launch({ proxy: proxy ? { server: proxy } : undefined });
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
  for (const u of process.argv.slice(2)) {
    const p = await ctx.newPage();
    try { const r = await p.goto(u, { waitUntil: "domcontentloaded", timeout: 40000 }); await p.waitForTimeout(3500);
      const rows = bars(await extract(p)); console.log(`${r?.status()} ${rows.length} rows ${u}`); for (const x of rows.slice(0, 4)) console.log("   ", x.grams, x.prices.join("/"), "::", x.raw);
    } catch (e) { console.log("ERR", u, String(e.message).split("\n")[0].slice(0, 80)); }
    await p.close();
  }
  await b.close();
}
