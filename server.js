import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { WebSocket } from "ws";
import fs from "fs";

// ============ ENV ============
const PORT = process.env.PORT || 10000;

// مفاتيح الواجهات (حط مفاتيحك في Render > Environment)
const ADMIN_TOKEN        = process.env.ADMIN_TOKEN        || "CHANGE_ME";
const TWELVEDATA_KEY     = process.env.TWELVEDATA_KEY     || "";
const ALPHAVANTAGE_KEY   = process.env.ALPHAVANTAGE_KEY   || "";
const METALPRICE_KEY     = process.env.METALPRICE_KEY     || "";   // إن وجد
const GOLDPRICEZ_KEY     = process.env.GOLDPRICEZ_KEY     || "";   // إن وجد
const COINCAP_KEY        = process.env.COINCAP_KEY        || "";   // اختياري (Bearer)
const DEXSCREENER_SLX    = process.env.DEXSCREENER_SLX    || "bsc/0x34317C020E78D30feBD2Eb9f5fa8721aA575044d"; // SilverX on BSC

// ============ LOAD SITES MAP ============
let SITES = {};
try {
  SITES = JSON.parse(fs.readFileSync("./sites.json", "utf8"));
  console.log("[BOOT] sites.json loaded. gold:", SITES.gold?.length, "silver:", SITES.silver?.length);
} catch(e){
  console.error("[BOOT] sites.json missing or invalid. Using minimal defaults.");
  SITES = { gold: [], silver: [] };
}

// ============ CACHE ============
const cache = new Map(); // key -> { t, ttl, data, source, err? }
const now = ()=> Date.now();
const setCache = (key, data, ttlMs, source)=> cache.set(key, { t: now(), ttl: ttlMs, data, source });
const getCache = (key)=> {
  const v = cache.get(key);
  if (!v) return null;
  if (now() - v.t < v.ttl) return v.data;
  return null;
};

// ============ HELPERS ============
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

async function fetchJson(url, opts={}, retries=1){
  let lastErr;
  for (let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    }catch(e){
      lastErr = e;
      if (i===retries) throw e;
      await sleep(300 + i*700);
    }
  }
  throw lastErr;
}
async function fetchText(url, opts={}, retries=1){
  let lastErr;
  for (let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    }catch(e){
      lastErr = e;
      if (i===retries) throw e;
      await sleep(300 + i*700);
    }
  }
  throw lastErr;
}

// ============ SCHEDULING WINDOWS ============
function isGoldMarketClosedUTC(){
  // تقريب: من الجمعة 22:00 UTC حتى الأحد 22:00 UTC (وقف طلبات TwelveData فقط لتوفير الليمت)
  const d = new Date();
  const day = d.getUTCDay(); // 0 Sun ... 6 Sat
  const h = d.getUTCHours();
  // من الجمعة 22:00 (day=5,h>=22) حتى الأحد 21:59 (day=0,h<=21) اعتبر مغلق
  if (day === 6) return true; // Saturday
  if (day === 5 && h >= 22) return true; // Fri late
  if (day === 0 && h < 22) return true;  // Sun before 22
  return false;
}

// ============ ROTATION STATE ============
const rotation = {
  gold: 0,
  silver: 0
};
function nextIdx(kind, arrLen){
  rotation[kind] = (rotation[kind] + 1) % arrLen;
  return rotation[kind];
}

// ============ PARSERS / SCRAPERS ===========
// TheStreetGold (HTML)
async function scrapeTheStreetGoldUSD(){
  // يستخدم الـ selector الموجود في sites.json عندنا، لكن كنسخة احتياطية نحاول التقاط أول رقم
  const url = "https://www.thestreet.com/quote/GCZ24";
  const html = await fetchText(url, {}, 1);
  const $ = cheerio.load(html);
  let txt = $("span:contains('Gold')").first().text();
  let num = Number((txt||"").replace(/[^\d.]/g,""));
  if (!num){
    // fallback: حاول التقط أول رقم كبير بالدولار في الصفحة
    const all = $("body").text();
    const m = all.match(/(\d{3,5}\.\d{1,2})/);
    if (m) num = Number(m[1]);
  }
  if (!num) throw new Error("theStreet parse fail");
  return num;
}

// Generic Yahoo JSON chart endpoint
async function yahooQuote(ticker){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?region=US&lang=en-US`;
  const j = await fetchJson(url, {}, 1);
  const v = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!v) throw new Error("yahoo no price");
  return Number(v);
}

// TwelveData simple price (metals/forex)
async function twelveDataPrice(symbol){
  if (!TWELVEDATA_KEY) throw new Error("No TwelveData key");
  if (/^(XAU|XAG)/.test(symbol) && isGoldMarketClosedUTC()){
    throw new Error("skip twelve on weekend");
  }
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVEDATA_KEY}`;
  const j = await fetchJson(url, {}, 1);
  const v = Number(j?.price);
  if (!v) throw new Error("twelve no price");
  return v;
}

// GoldPriceZ (per gram -> oz)
async function goldPriceZ(metalCode="XAU", currency="USD"){
  if (!GOLDPRICEZ_KEY) throw new Error("No GoldPriceZ key");
  const url = `https://www.goldpricez.com/api/rates/${metalCode}/${currency}/gram?api_key=${GOLDPRICEZ_KEY}`;
  const j = await fetchJson(url, {}, 1);
  const g = Number(j?.price_gram_24k);
  if (!g) throw new Error("gpz no gram");
  return g * 31.1034768; // g -> troy oz
}

// MetalPriceAPI (latest)
async function metalPriceAPI(base="USD", codes=["XAU","XAG"]){
  if (!METALPRICE_KEY) throw new Error("No MetalPrice key");
  const list = codes.join(",");
  const url = `https://api.metalpriceapi.com/v1/latest?api_key=${METALPRICE_KEY}&base=${base}&currencies=${list}`;
  const j = await fetchJson(url, {}, 1);
  if (!j?.rates) throw new Error("metalprice no rates");
  return j.rates; // {XAU: price_in_base, XAG: ...}
}

// AlphaVantage FX / Commodities (WTI/Brent/Gas)
async function alphaFX(from="USD", to="EGP"){
  if (!ALPHAVANTAGE_KEY) throw new Error("No AV key");
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${ALPHAVANTAGE_KEY}`;
  const j = await fetchJson(url, {}, 1);
  const v = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
  if (!v) throw new Error("av no fx");
  return v;
}
async function alphaCommodity(func="WTI"){
  if (!ALPHAVANTAGE_KEY) throw new Error("No AV key");
  const url = `https://www.alphavantage.co/query?function=${func}&interval=daily&apikey=${ALPHAVANTAGE_KEY}`;
  const j = await fetchJson(url, {}, 1);
  const s = j?.data || j?.["data"] || j?.["series"];
  // تنسيقات AV متنوعة؛ نحاول التقاط آخر قيمة
  let last;
  if (Array.isArray(s) && s.length){
    last = Number(s[0]?.value || s[0]?.close || s[0]?.price);
  }else{
    // fallback: try time series objects
    const keys = Object.keys(j || {}).filter(k=>k.toLowerCase().includes("time"));
    if (keys.length){
      const ts = j[keys[0]];
      const first = ts && Object.values(ts)[0];
      last = Number(first?.["4. close"] || first?.close || first?.price);
    }
  }
  if (!last) throw new Error("av no commodity value");
  return last;
}

// FX: Frankfurter / exchangerate.host
async function frankfurter(from="USD", to="EUR"){
  const url = `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
  const j = await fetchJson(url, {}, 1);
  const v = Number(j?.rates?.[to]);
  if (!v) throw new Error("frankfurter no rate");
  return v;
}
async function exchangerateHostLive(from="USD", to="EUR", key){
  const url = `https://api.exchangerate.host/live?access_key=${key}`;
  const j = await fetchJson(url, {}, 1);
  const pair = (from+to).toUpperCase();
  const v = Number(j?.quotes?.[`USD${to}`]); // API ده غالباً بيرجع من USD
  if (!v) throw new Error("exchangerate.host no rate");
  // لو from != USD هنحتاج تحويل لاحقاً؛ هنا سنستخدمه عندما from = USD
  return v;
}

// Crypto: CoinGecko / CoinCap / Kraken / DexScreener (SLX)
async function cgSimple(id="bitcoin", vs="usd"){
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${vs}`;
  const j = await fetchJson(url, {}, 1);
  const v = Number(j?.[id]?.[vs]);
  if (!v) throw new Error("cg no price");
  return v;
}
async function coinCapAsset(id="bitcoin"){
  const headers = COINCAP_KEY ? { Authorization: `Bearer ${COINCAP_KEY}` } : {};
  const url = `https://api.coincap.io/v2/assets/${id}`;
  const j = await fetchJson(url, { headers }, 1);
  const v = Number(j?.data?.priceUsd);
  if (!v) throw new Error("coincap no price");
  return v;
}
async function krakenTicker(sym="XBTUSD"){
  const url = `https://api.kraken.com/0/public/Ticker?pair=${sym}`;
  const j = await fetchJson(url, {}, 1);
  const obj = j?.result && Object.values(j.result)[0];
  const v = Number(obj?.c?.[0]);
  if (!v) throw new Error("kraken no price");
  return v;
}
async function dexScreener(contractPath /* e.g. bsc/0x... */){
  const url = `https://api.dexscreener.com/latest/dex/tokens/${contractPath.split("/")[1]}`;
  const j = await fetchJson(url, {}, 1);
  const p = j?.pairs?.[0]?.priceUsd;
  const v = Number(p);
  if (!v) throw new Error("dexscreener no price");
  return v;
}

// Binance WS (live cache)
const wsPrices = new Map(); // e.g., BTCUSDT -> price
function startBinanceWS(pairs=["btcusdt","ethusdt"]){
  try{
    const streams = pairs.map(p=>`${p}@ticker`).join('/');
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    ws.on("message", buf=>{
      try{
        const j = JSON.parse(buf.toString());
        const d = j?.data;
        if (d?.s && d?.c) wsPrices.set(d.s, Number(d.c));
      }catch{}
    });
    ws.on("close", ()=> setTimeout(()=>startBinanceWS(pairs), 3000));
    ws.on("error", ()=> ws.close());
  }catch{}
}
startBinanceWS(["btcusdt","ethusdt","solusdt","xrpusdt"]);

// ============ RESOLVERS (Rotation) ============

// GOLD (XAU/USD): تناوب بين (TwelveData -> GoldPriceZ -> Yahoo -> TheStreetGold)
async function resolveGoldUSD(){
  const key = "gold:usd";
  const c = getCache(key);
  if (c) return c;

  const line = [
    async ()=> await twelveDataPrice("XAU/USD"),
    async ()=> await goldPriceZ("XAU","USD"),
    async ()=> await yahooQuote("GC=F"),
    async ()=> await scrapeTheStreetGoldUSD()
  ];

  let lastErr;
  for (let i=0;i<line.length;i++){
    try{
      const v = await line[i]();
      setCache(key, { price:v, unit:"oz", source:["TwelveData","GoldPriceZ","Yahoo","TheStreet"][i] }, 60_000, i);
      return getCache(key);
    }catch(e){ lastErr = e; }
  }
  if (cache.get(key)?.data) return cache.get(key).data;
  throw lastErr || new Error("gold failed");
}

// SILVER (XAG/USD): تناوب (TwelveData -> GoldPriceZ -> Yahoo)
async function resolveSilverUSD(){
  const key = "silver:usd";
  const c = getCache(key);
  if (c) return c;

  const line = [
    async ()=> await twelveDataPrice("XAG/USD"),
    async ()=> await goldPriceZ("XAG","USD"),
    async ()=> await yahooQuote("SI=F")
  ];

  let lastErr;
  for (let i=0;i<line.length;i++){
    try{
      const v = await line[i]();
      setCache(key, { price:v, unit:"oz", source:["TwelveData","GoldPriceZ","Yahoo"][i] }, 60_000, i);
      return getCache(key);
    }catch(e){ lastErr = e; }
  }
  if (cache.get(key)?.data) return cache.get(key).data;
  throw lastErr || new Error("silver failed");
}

// INDUSTRIAL METALS (daily cache 24h) — 17 معدن
const INDUSTRIAL = {
  platinum:  { code:"XPT", yahoo:"PL=F", unit:"oz" },
  palladium: { code:"XPD", yahoo:"PA=F", unit:"oz" },
  copper:    { code:"HG",  yahoo:"HG=F", unit:"lb" },
  aluminum:  { code:"ALI", yahoo:"ALI=F",unit:"t"  },
  zinc:      { code:"MZN", yahoo:"MZN=F",unit:"t"  },
  nickel:    { code:"NID", yahoo:"NID=F",unit:"t"  },
  lead:      { code:"LD",  yahoo:"LD=F", unit:"t"  },
  tin:       { code:"TIN", yahoo:"TIN=F",unit:"t"  },
  iron:      { code:null,  yahoo:null,   unit:"t"  },
  steel:     { code:null,  yahoo:null,   unit:"t"  },
  cobalt:    { code:null,  yahoo:null,   unit:"t"  },
  lithium:   { code:null,  yahoo:null,   unit:"t"  },
  uranium:   { code:null,  yahoo:null,   unit:"lb" },
  rhodium:   { code:null,  yahoo:null,   unit:"oz" },
  molybdenum:{ code:null,  yahoo:null,   unit:"t"  },
  manganese: { code:null,  yahoo:null,   unit:"t"  }
};

async function resolveIndustrialUSD(name){
  const key = `metal:${name}`;
  const c = getCache(key);
  if (c) return c;
  const m = INDUSTRIAL[name];
  if (!m) throw new Error("unknown metal: "+name);

  // Line: TwelveData if exists symbol -> Yahoo if exists -> MetalPrice if mapped -> fallback cache
  const line = [];

  // TwelveData only لبعض المعادن الشائعة (XPT/XPD عبر XPT/USD ...)
  if (["platinum","palladium"].includes(name) && TWELVEDATA_KEY){
    line.push(async ()=> await twelveDataPrice((m.code||"").replace("X","")+"/USD".replace("//","/"))); // "XPT/USD"
  }

  if (m.yahoo){
    line.push(async ()=> await yahooQuote(m.yahoo));
  }

  if (METALPRICE_KEY && m.code){
    line.push(async ()=>{
      const r = await metalPriceAPI("USD",[m.code]);
      const v = Number(r?.[m.code]);
      if (!v) throw new Error("metalprice no value");
      return v;
    });
  }

  let lastErr;
  for (let i=0;i<line.length;i++){
    try{
      const v = await line[i]();
      setCache(key, { price:v, unit:m.unit, source:"industrial-line-"+i }, 24*3600_000);
      return getCache(key);
    }catch(e){ lastErr = e; }
  }
  if (cache.get(key)?.data) return cache.get(key).data;
  throw lastErr || new Error(`metal ${name} failed`);
}

// OIL & GAS (via AlphaVantage) — cache 5 ساعات
async function resolveOilGas(){
  const key = "oilgas";
  const c = getCache(key);
  if (c) return c;
  let WTI, Brent, Gas;
  try{ WTI   = await alphaCommodity("WTI"); }catch{}
  try{ Brent = await alphaCommodity("BRENT"); }catch{}
  try{ Gas   = await alphaCommodity("NATURAL_GAS"); }catch{}
  if (!WTI && !Brent && !Gas) throw new Error("oil/gas failed");
  const out = { WTI, Brent, NaturalGas: Gas };
  setCache(key, out, 5*3600_000, "AlphaVantage");
  return out;
}

// FX (USD->XXX) — أولاً Frankfurter ثم AlphaVantage
async function resolveFX(from="USD", to="EGP"){
  const key = `fx:${from}:${to}`;
  const c = getCache(key);
  if (c) return c;

  const line = [
    async ()=> await frankfurter(from,to),
    async ()=> await alphaFX(from,to)
  ];

  let lastErr;
  for (let i=0;i<line.length;i++){
    try{
      const v = await line[i]();
      const out = { rate: v, source: i===0 ? "Frankfurter" : "AlphaVantage" };
      setCache(key, out, 60*60_000, out.source);
      return out;
    }catch(e){ lastErr = e; }
  }
  if (cache.get(key)?.data) return cache.get(key).data;
  throw lastErr || new Error("fx failed");
}

// CRYPTO (BTC/ETH/SLX...) — WS -> CoinGecko -> CoinCap -> Kraken -> DexScreener(SLX)
async function resolveCrypto(sym="BTC"){
  const key = `crypto:${sym}`;
  const c = getCache(key);
  if (c) return c;
  const pair = `${sym.toUpperCase()}USDT`;

  // WS
  const ws = wsPrices.get(pair);
  if (ws){
    const out = { price: ws, source: "BinanceWS" };
    setCache(key, out, 10_000, "BinanceWS");
    return out;
  }

  // CoinGecko ids map (سريع)
  const cgMap = { BTC:"bitcoin", ETH:"ethereum", SOL:"solana", XRP:"ripple" };
  const id = cgMap[sym.toUpperCase()];
  if (id){
    try{
      const v = await cgSimple(id, "usd");
      const out = { price: v, source: "CoinGecko" };
      setCache(key, out, 30_000, "CoinGecko");
      return out;
    }catch{}
  }

  // CoinCap
  try{
    const ccMap = { BTC:"bitcoin", ETH:"ethereum", SOL:"solana", XRP:"xrp" };
    const vid = ccMap[sym.toUpperCase()];
    if (vid){
      const v = await coinCapAsset(vid);
      const out = { price: v, source: "CoinCap" };
      setCache(key, out, 30_000, "CoinCap");
      return out;
    }
  }catch{}

  // Kraken
  try{
    const kMap = { BTC:"XBTUSD", ETH:"ETHUSD" };
    const ksym = kMap[sym.toUpperCase()] || `${sym.toUpperCase()}USD`;
    const v = await krakenTicker(ksym);
    const out = { price: v, source: "Kraken" };
    setCache(key, out, 30_000, "Kraken");
    return out;
  }catch{}

  // SilverX (SLX) عبر DexScreener
  if (sym.toUpperCase()==="SLX"){
    try{
      const v = await dexScreener(DEXSCREENER_SLX);
      const out = { price: v, source: "DexScreener" };
      setCache(key, out, 60_000, "DexScreener");
      return out;
    }catch{}
  }

  if (cache.get(key)?.data) return cache.get(key).data;
  throw new Error("crypto failed for "+sym);
}

// ============ EXPRESS APP ============
const app = express();
app.use(express.json());

// Health
app.get("/api/health", (req,res)=> res.json({ ok:true, ts: Date.now() }));

// Gold & Silver (سريعة)
app.get("/api/gold", async (req,res)=>{
  try{
    const r = await resolveGoldUSD();
    res.json(r);
  }catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});
app.get("/api/silver", async (req,res)=>{
  try{
    const r = await resolveSilverUSD();
    res.json(r);
  }catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});

// Industrial metals
app.get("/api/metals", async (req,res)=>{
  try{
    const list = (req.query.list || Object.keys(INDUSTRIAL).join(","))
                  .split(",").map(s=>s.trim()).filter(Boolean);
    const out = {};
    for (const m of list){
      out[m] = await resolveIndustrialUSD(m);
    }
    res.json(out);
  }catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});

// Oil & Gas
app.get("/api/oilgas", async (req,res)=>{
  try{
    const r = await resolveOilGas();
    res.json(r);
  }catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});

// FX
app.get("/api/fx", async (req,res)=>{
  try{
    const from = (req.query.from || "USD").toUpperCase();
    const to   = (req.query.to   || "EGP").toUpperCase();
    const r = await resolveFX(from, to);
    res.json({ from, to, ...r });
  }catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});

// Crypto
app.get("/api/crypto", async (req,res)=>{
  try{
    const list = (req.query.list || "BTC,ETH,SLX")
                  .split(",").map(s=>s.trim()).filter(Boolean);
    const out = {};
    for (const s of list){
      out[s] = await resolveCrypto(s);
    }
    res.json(out);
  }catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});

// Admin manual override
app.post("/api/admin/price", (req,res)=>{
  try{
    const { token, kind, price, ttlSec=7200 } = req.body || {};
    if (token !== ADMIN_TOKEN) return res.status(401).json({ error:"bad token" });
    if (!kind || typeof price!=="number") return res.status(400).json({ error:"kind/price required" });
    const key = kind.toLowerCase().startsWith("crypto:") ? kind : kind.toLowerCase();
    setCache(key, { price, manual:true, source:"admin" }, ttlSec*1000, "admin");
    res.json({ ok:true, key, price, ttlSec });
  }catch(e){ res.status(500).json({ error:String(e.message||e) }); }
});

// 404
app.use((req,res)=> res.status(404).json({ error:"Not found" }));

app.listen(PORT, ()=> console.log("[RUN] Hybrid backend on", PORT));
