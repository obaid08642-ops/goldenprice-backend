import express from "express";
import cors from "cors";
import morgan from "morgan";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

// ========= Env =========
const PORT = process.env.PORT || 10000;

// مفاتيح الــ API (ضعها في Render > Environment)
const TWELVE_KEY    = process.env.TWELVEDATA_KEY || process.env.TWELVE_KEY;
const ALPHAV_KEY    = process.env.ALPHAVANTAGE_KEY || process.env.ALPHAV_KEY;
const GOLDPRICEZ_KEY= process.env.GOLDPRICEZ_KEY || process.env.GOLDPRZ_KEY;

// تحكم في الفواصل الزمنية (ms)
const INTERVAL_XAU_MS   = +(process.env.INTERVAL_XAU_MS   || 210000);  // 3.5 دقيقة
const INTERVAL_XAG_MS   = +(process.env.INTERVAL_XAG_MS   || 210000);
const INTERVAL_FX_MS    = +(process.env.INTERVAL_FX_MS    || 3600000); // ساعة
const INTERVAL_CRY_MS   = +(process.env.INTERVAL_CRY_MS   || 60000);   // دقيقة
const INTERVAL_SCRAP_MS = +(process.env.INTERVAL_SCRAP_MS || 300000);  // 5 دقائق

// تشغيل/تعطيل السكريـبنج
const ENABLE_SCRAPING = String(process.env.ENABLE_SCRAPING || "false").toLowerCase() === "true";

// إيقاف السكيجول في الويك إند (UTC) — اختياري
const DISABLE_WEEKEND = String(process.env.DISABLE_WEEKEND || "true").toLowerCase() === "true";

// ========= Helpers =========
const app = express();
app.use(cors());
app.use(morgan("tiny"));

const cache = {
  gold: null,
  silver: null,
  fx: {},          // "USD_EGP": { price, ts }
  crypto: {        // "BTC": { price, ts }, "SLX": { price, ts }
    BTC: null,
    SLX: null
  },
  lastScrape: null,
  sourceNote: {}   // مفتاح → منين جبنا السعر (API/SCRAPE/…)
};

function nowISO() { return new Date().toISOString(); }

async function fetchJSON(url, opts={}) {
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), opts.timeout || 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function weekendBlocked() {
  if (!DISABLE_WEEKEND) return false;
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun .. 6=Sat
  return (day === 6 || day === 0); // Sat/Sun
}

// ========= Sources: GOLD / SILVER =========
// 1) TwelveData: XAU/USD و XAG/USD
async function xauFromTwelve() {
  if (!TWELVE_KEY) throw new Error("TWELVE_KEY missing");
  const url = `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${TWELVE_KEY}`;
  const j = await fetchJSON(url);
  if (!j || !j.price) throw new Error("no price");
  return +j.price;
}
async function xagFromTwelve() {
  if (!TWELVE_KEY) throw new Error("TWELVE_KEY missing");
  const url = `https://api.twelvedata.com/price?symbol=XAG/USD&apikey=${TWELVE_KEY}`;
  const j = await fetchJSON(url);
  if (!j || !j.price) throw new Error("no price");
  return +j.price;
}

// 2) GoldPriceZ (اختياري)
async function goldFromGoldPriceZ() {
  if (!GOLDPRICEZ_KEY) throw new Error("GOLDPRICEZ_KEY missing");
  const url = `https://goldpricez.com/api/rates/currency/usd/gram/24k?api_key=${GOLDPRICEZ_KEY}`;
  const j = await fetchJSON(url);
  if (!j || !j.price_gram_24k) throw new Error("no price");
  // تحويل جرام 24K إلى أوقية (تقريبي)
  const gramToOz = 31.1034768;
  return +j.price_gram_24k * gramToOz;
}
async function silverFromGoldPriceZ() {
  if (!GOLDPRICEZ_KEY) throw new Error("GOLDPRICEZ_KEY missing");
  const url = `https://goldpricez.com/api/silver/ounce/usd?api_key=${GOLDPRICEZ_KEY}`;
  const j = await fetchJSON(url);
  if (!j || !j.silver_price_ounce) throw new Error("no price");
  return +j.silver_price_ounce;
}

// ====== Scraping (اختياري) لدهب/فضة من مواقع عامة (Selectors بسيطة) ======
const scrapeSites = [
  // أمثلة قليلة — يمكنك زيادتها في أي وقت
  { name: "goldprice.org-gold",  url: "https://goldprice.org/gold-price.html",  selector: ".gold-price .value" },
  { name: "goldprice.org-silver",url: "https://goldprice.org/silver-price.html",selector: ".silver-price .value" },
  { name: "bullionvault-gold",   url: "https://www.bullionvault.com/gold-price-chart.do", selector: "#spot_price_oz_usd" },
  { name: "bullion-rates-silver",url: "https://www.bullion-rates.com/silver/US-Dollar/2007-1-history.htm", selector: "table tr:nth-child(2) td:nth-child(2)" }
];

async function scrapeNumber(url, selector) {
  const html = await (await fetch(url)).text();
  const $ = cheerio.load(html);
  const txt = ($(selector).first().text() || "").replace(/[^\d\.]/g,"");
  const val = parseFloat(txt);
  if (!isFinite(val)) throw new Error("parse failed");
  return val;
}

// ========= Orchestrators =========
async function updateGold() {
  if (weekendBlocked()) return;
  const sources = [
    async ()=> ({ val: await xauFromTwelve(), src: "twelvedata" }),
    async ()=> ({ val: await goldFromGoldPriceZ(), src: "goldpricez" }),
    ...(ENABLE_SCRAPING ? [
      async ()=> ({ val: await scrapeNumber("https://goldprice.org/gold-price.html", ".gold-price .value"), src: "scrape:goldprice.org" })
    ] : [])
  ];
  for (const f of sources) {
    try {
      const { val, src } = await f();
      cache.gold = { price: val, ts: nowISO() };
      cache.sourceNote.gold = src;
      return;
    } catch(e){ /* try next */ }
  }
  cache.gold = { error: "all sources failed for gold", ts: nowISO() };
  cache.sourceNote.gold = "failed";
}

async function updateSilver() {
  if (weekendBlocked()) return;
  const sources = [
    async ()=> ({ val: await xagFromTwelve(), src: "twelvedata" }),
    async ()=> ({ val: await silverFromGoldPriceZ(), src: "goldpricez" }),
    ...(ENABLE_SCRAPING ? [
      async ()=> ({ val: await scrapeNumber("https://goldprice.org/silver-price.html", ".silver-price .value"), src: "scrape:goldprice.org" })
    ] : [])
  ];
  for (const f of sources) {
    try {
      const { val, src } = await f();
      cache.silver = { price: val, ts: nowISO() };
      cache.sourceNote.silver = src;
      return;
    } catch(e){ /* next */ }
  }
  cache.silver = { error: "all sources failed for silver", ts: nowISO() };
  cache.sourceNote.silver = "failed";
}

async function updateFX(from="USD", to="EGP") {
  if (!ALPHAV_KEY) {
    cache.fx[`${from}_${to}`] = { error: "ALPHAV_KEY missing", ts: nowISO() };
    return;
  }
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${ALPHAV_KEY}`;
  try {
    const j = await fetchJSON(url);
    const rate = +j["Realtime Currency Exchange Rate"]["5. Exchange Rate"];
    if (!isFinite(rate)) throw new Error("no rate");
    cache.fx[`${from}_${to}`] = { price: rate, ts: nowISO() };
    cache.sourceNote[`${from}_${to}`] = "alphavantage";
  } catch (e) {
    cache.fx[`${from}_${to}`] = { error: "fx failed", ts: nowISO() };
    cache.sourceNote[`${from}_${to}`] = "failed";
  }
}

async function updateBTC() {
  try {
    const j = await fetchJSON("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
    cache.crypto.BTC = { price: +j.bitcoin.usd, ts: nowISO() };
    cache.sourceNote.BTC = "coingecko";
  } catch(e){
    cache.crypto.BTC = { error: "coingecko failed", ts: nowISO() };
    cache.sourceNote.BTC = "failed";
  }
}

// SLX on BSC — using Dexscreener (مستقر وسهل)
const SLX_ADDR = "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d";
async function updateSLX() {
  try {
    const j = await fetchJSON(`https://api.dexscreener.com/latest/dex/tokens/${SLX_ADDR}`);
    const pair = (j.pairs && j.pairs[0]) || null;
    const px = pair && (pair.priceUsd ? +pair.priceUsd : (pair.priceNative ? +pair.priceNative : NaN));
    if (!isFinite(px)) throw new Error("no price");
    cache.crypto.SLX = { price: px, ts: nowISO() };
    cache.sourceNote.SLX = `dexscreener:${pair.dexId || "?"}`;
  } catch(e){
    cache.crypto.SLX = { error: "slx failed", ts: nowISO() };
    cache.sourceNote.SLX = "failed";
  }
}

// ========= Schedulers =========
async function boot() {
  console.log("🚀 Booting…");

  await Promise.all([ updateGold(), updateSilver(), updateBTC(), updateSLX(), updateFX("USD","EGP") ]);

  setInterval(updateGold,   INTERVAL_XAU_MS);
  setInterval(updateSilver, INTERVAL_XAG_MS);
  setInterval(updateBTC,    INTERVAL_CRY_MS);
  setInterval(updateSLX,    INTERVAL_CRY_MS);
  setInterval(()=>updateFX("USD","EGP"), INTERVAL_FX_MS);

  if (ENABLE_SCRAPING) {
    setInterval(async ()=>{
      // مثال تدوير موقع واحد (تقدر توسّع لاحقًا)
      try {
        const v = await scrapeNumber("https://goldprice.org/gold-price.html", ".gold-price .value");
        cache.gold = { price: v, ts: nowISO() };
        cache.sourceNote.gold = "scrape:goldprice.org";
      } catch(e){}
    }, INTERVAL_SCRAP_MS);
  }
}
boot();

// ========= Routes =========
app.get("/", (_req,res)=> res.json({ ok:true, time:nowISO(), note:"gold/silver/forex/crypto APIs ready" }));

app.get("/api/ping", (_req,res)=> res.json({ pong:true, time:nowISO() }));

app.get("/api/gold", (_req,res)=> res.json({ gold: cache.gold, source: cache.sourceNote.gold || null }));

app.get("/api/silver", (_req,res)=> res.json({ silver: cache.silver, source: cache.sourceNote.silver || null }));

app.get("/api/forex", (req,res)=>{
  const from = (req.query.from || "USD").toUpperCase();
  const to   = (req.query.to   || "EGP").toUpperCase();
  const key = `${from}_${to}`;
  const v = cache.fx[key] || { error:"no data" };
  res.json({ pair: key, data: v, source: cache.sourceNote[key] || null });
});

app.get("/api/crypto/btc", (_req,res)=> res.json({ BTC: cache.crypto.BTC, source: cache.sourceNote.BTC || null }));

app.get("/api/crypto/slx", (_req,res)=> res.json({ SLX: cache.crypto.SLX, source: cache.sourceNote.SLX || null, address: SLX_ADDR }));

app.get("/api/all", (_req,res)=> res.json({
  ts: nowISO(),
  gold: cache.gold,
  silver: cache.silver,
  fx: cache.fx,
  crypto: cache.crypto,
  source: cache.sourceNote
}));

// 404 لطيف
app.use((req,res)=> res.status(404).json({ error:`No route ${req.method} ${req.url}` }));

app.listen(PORT, ()=> console.log(`🚀 Server running on port ${PORT}`));
