// server.js
// Hybrid backend: Metals (gold/silver + industrial), Crypto (incl. SLX), FX
// USD-only outputs. Smart cache + schedulers + multi-source fallback.

import express from "express";
import fetch from "node-fetch";
import cheerio from "cheerio";
import { WebSocket } from "ws";
import fs from "fs";

// ====== CONFIG / KEYS (Render → Environment) ======
const PORT = process.env.PORT || 10000;

// Put your keys in Render Environment Variables:
const TWELVEDATA_KEY   = process.env.TWELVEDATA_KEY   || ""; // e.g. 38e67a...
const ALPHAVANTAGE_KEY = process.env.ALPHAVANTAGE_KEY || ""; // e.g. CCBAF...
const FMP_KEY          = process.env.FMP_KEY          || ""; // e.g. rtei1h...
const MARKETSTACK_KEY  = process.env.MARKETSTACK_KEY  || ""; // e.g. 770c23...
const GOLDPRICEZ_KEY   = process.env.GOLDPRICEZ_KEY   || ""; // e.g. b95f01...

// ====== UTIL ======
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const now   = ()=> Date.now();

const cache = new Map(); // key -> {t, ttl, data}
function getCache(key){
  const v = cache.get(key);
  if (!v) return null;
  if (now() - v.t < v.ttl) return v.data;
  return null;
}
function setCache(key, data, ttlMs){
  cache.set(key, {t: now(), ttl: ttlMs, data});
}

async function tryJson(url, opts={}, retries=1, backoff=400){
  let lastErr;
  for (let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    }catch(e){
      lastErr = e;
      if (i===retries) throw e;
      await sleep(backoff*(i+1));
    }
  }
  throw lastErr;
}
async function tryText(url, opts={}, retries=1, backoff=400){
  let lastErr;
  for (let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    }catch(e){
      lastErr = e;
      if (i===retries) throw e;
      await sleep(backoff*(i+1));
    }
  }
  throw lastErr;
}

// ====== DOMAINS ======
/** Metals map (unit hints) */
const METALS = {
  gold:      { unit:"oz", td:"XAU/USD", y:"XAUUSD=X", ms:"XAU", gpz:"XAU" },
  silver:    { unit:"oz", td:"XAG/USD", y:"XAGUSD=X", ms:"XAG", gpz:"XAG" },
  platinum:  { unit:"oz", td:"XPT/USD", y:"XPTUSD=X", ms:"XPT", gpz:"XPT" },
  palladium: { unit:"oz", td:"XPD/USD", y:"XPDUSD=X", ms:"XPD", gpz:"XPD" },

  copper:    { unit:"lb", td:null,      y:"HG=F",     ms:"HG"  },
  aluminum:  { unit:"t",  td:null,      y:"ALI=F",    ms:"AL"  },
  nickel:    { unit:"t",  td:null,      y:"NID=F",    ms:"NI"  },
  zinc:      { unit:"t",  td:null,      y:"MZN=F",    ms:"ZN"  },
  lead:      { unit:"t",  td:null,      y:"LD=F",     ms:"PB"  },
  tin:       { unit:"t",  td:null,      y:"TIN=F",    ms:"SN"  },
  iron:      { unit:"t",  td:null,      y:null,       ms:null  },
  steel:     { unit:"t",  td:null,      y:null,       ms:null  },
  cobalt:    { unit:"t",  td:null,      y:null,       ms:null  },
  lithium:   { unit:"t",  td:null,      y:null,       ms:null  },
  uranium:   { unit:"lb", td:null,      y:null,       ms:null  },
};

// TTLs
const TTL = {
  metalsFast:  60_000,    // 1m for gold/silver via primary
  metalsSlow:  86_400_000,// 24h for industrial metals
  fx:          1_800_000, // 30m
  crypto:      10_000     // 10s
};

// ====== PRIMARY METAL SOURCES ======
async function tdPrice(symbol){ // "XAU/USD"
  if (!TWELVEDATA_KEY) throw new Error("TD key missing");
  // Skip TD on weekends (gold market largely paused) to save quota
  const day = new Date().getUTCDay(); // 0=Sun,6=Sat
  if (day===0 || day===6) throw new Error("TD weekend pause");
  const j = await tryJson(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVEDATA_KEY}`, {}, 1);
  const v = Number(j?.price);
  if (!v) throw new Error("TD no price");
  return v;
}
async function gpzOunce(metal){ // GoldPriceZ ounce (converted from gram)
  if (!GOLDPRICEZ_KEY) throw new Error("GPZ key missing");
  if (!["XAU","XAG","XPT","XPD"].includes(metal)) throw new Error("GPZ metal not supported");
  const j = await tryJson(`https://www.goldpricez.com/api/rates/${metal}/USD/gram?api_key=${GOLDPRICEZ_KEY}`, {}, 1);
  const g = Number(j?.price_gram_24k);
  if (!g) throw new Error("GPZ no price");
  return g * 31.1034768;
}
async function fmpQuote(symbol){ // FMP close/price (used for futures / backups)
  if (!FMP_KEY) throw new Error("FMP key missing");
  const j = await tryJson(`https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(symbol)}?apikey=${FMP_KEY}`, {}, 1);
  const v = Number(j?.[0]?.price || j?.[0]?.previousClose);
  if (!v) throw new Error("FMP no price");
  return v;
}
async function yahooRegular(ticker){ // Yahoo direct chart meta
  const j = await tryJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?region=US&lang=en-US`, {}, 1);
  const v = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!v) throw new Error("Yahoo no price");
  return Number(v);
}

// ====== METAL RESOLVER ======
async function getMetalUSD(metal){
  const m = METALS[metal?.toLowerCase()];
  if (!m) throw new Error(`unknown metal: ${metal}`);
  const key = `metal:${metal.toLowerCase()}`;
  const cached = getCache(key);
  if (cached) return cached;

  // Priority (gold/silver get fast TTL, others slow)
  const fast = ["gold","silver"].includes(metal.toLowerCase());
  const ttl  = fast ? TTL.metalsFast : TTL.metalsSlow;

  // A) Primary
  const A = [];
  if (m.td && TWELVEDATA_KEY) A.push(()=>tdPrice(m.td));
  if (["gold","silver","platinum","palladium"].includes(metal.toLowerCase()) && GOLDPRICEZ_KEY) {
    A.push(()=>gpzOunce(m.gpz));
  }
  // B) Scrape/API backups
  const B = [];
  if (m.y) B.push(()=>yahooRegular(m.y));
  if (m.ms && FMP_KEY) B.push(()=>fmpQuote(m.ms)); // e.g., HG, XAU, ...

  for (const fn of [...A, ...B]){
    try{
      const v = await fn();
      if (v){
        const out = { price: v, unit: m.unit, source: fn.name || "src" };
        setCache(key, out, ttl);
        return out;
      }
    }catch{}
  }

  // last resort: stale
  const stale = cache.get(key)?.data;
  if (stale) return stale;
  throw new Error(`all sources failed for ${metal}`);
}

// ====== FX ======
async function getFX(from="USD", to="EGP"){
  const key = `fx:${from}:${to}`;
  const cached = getCache(key);
  if (cached) return cached;

  // Alpha Vantage
  if (ALPHAVANTAGE_KEY){
    try{
      const j = await tryJson(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${ALPHAVANTAGE_KEY}`, {}, 1);
      const v = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
      if (v){ const out = { rate:v, source:"AlphaVantage" }; setCache(key,out, TTL.fx); return out; }
    }catch{}
  }

  // TwelveData
  if (TWELVEDATA_KEY){
    try{
      const j = await tryJson(`https://api.twelvedata.com/price?symbol=${from}/${to}&apikey=${TWELVEDATA_KEY}`, {}, 1);
      const v = Number(j?.price);
      if (v){ const out = { rate:v, source:"TwelveData" }; setCache(key,out, TTL.fx); return out; }
    }catch{}
  }

  const stale = cache.get(key)?.data;
  if (stale) return stale;
  throw new Error("FX failed");
}

// ====== CRYPTO ======
const wsPrices = new Map(); // "BTCUSDT" -> price
function startBinanceWS(pairs=["btcusdt","ethusdt","solusdt","xrpusdt"]){
  try{
    const streams = pairs.map(p=>`${p}@ticker`).join("/");
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    ws.on("message",(buf)=>{
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
startBinanceWS();

async function getCryptoUSD(sym="BTC"){
  const key = `crypto:${sym.toUpperCase()}`;
  const cached = getCache(key);
  if (cached) return cached;

  const ws = wsPrices.get(`${sym.toUpperCase()}USDT`);
  if (ws){ const out={ price:ws, source:"BinanceWS" }; setCache(key,out, TTL.crypto); return out; }

  // CoinGecko
  try{
    const j = await tryJson(`https://api.coingecko.com/api/v3/simple/price?ids=${sym.toLowerCase()}&vs_currencies=usd`, {}, 1);
    const v = Number(j?.[sym.toLowerCase()]?.usd);
    if (v){ const out={ price:v, source:"CoinGecko" }; setCache(key,out, TTL.crypto); return out; }
  }catch{}

  // Kraken (fallback)
  try{
    const map={ BTC:"XBTUSD", ETH:"ETHUSD" };
    const kr = map[sym.toUpperCase()] || `${sym.toUpperCase()}USD`;
    const j = await tryJson(`https://api.kraken.com/0/public/Ticker?pair=${kr}`, {}, 1);
    const obj = j?.result && Object.values(j.result)[0];
    const v = Number(obj?.c?.[0]);
    if (v){ const out={ price:v, source:"Kraken" }; setCache(key,out, TTL.crypto); return out; }
  }catch{}

  const stale = cache.get(key)?.data;
  if (stale) return stale;
  throw new Error("crypto failed");
}

// Special: SilverX (SLX) via DexScreener (BSC)
const SLX_CONTRACT = "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d";
async function getSLX(){
  const key = "crypto:SLX";
  const cached = getCache(key);
  if (cached) return cached;
  try{
    const j = await tryJson(`https://api.dexscreener.com/latest/dex/tokens/${SLX_CONTRACT}`, {}, 1);
    const pair = j?.pairs?.[0];
    const v = Number(pair?.priceUsd);
    if (v){ const out={ price:v, source:"DexScreener" }; setCache(key,out, TTL.crypto); return out; }
  }catch{}
  const stale = cache.get(key)?.data;
  if (stale) return stale;
  throw new Error("SLX failed");
}

// ====== SCRAPING POOL ======
let scrapePool = [];
try{
  // Expecting sites.json in the same directory (you will upload it)
  const raw = fs.readFileSync("./sites.json","utf-8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) scrapePool = parsed;
}catch{}

async function scrapeOnce(rec){
  // rec: {name, url, selector, type: "gold"|"silver"}
  // returns number or throws
  const html = await tryText(rec.url, {}, 1);
  const $ = cheerio.load(html);
  let txt = $(rec.selector).first().text().trim();
  txt = (txt || "").replace(/[, ]+/g,"").replace(/[^\d.]/g,"");
  const v = Number(txt);
  if (!v) throw new Error("no parse");
  return v;
}

let scrapeIndex = 0;
async function rotateScrape(){
  if (!scrapePool.length) return;
  const rec = scrapePool[scrapeIndex % scrapePool.length];
  scrapeIndex++;
  if (!rec || !rec.type) return;
  try{
    const v = await scrapeOnce(rec);
    const m = rec.type;
    const unit = (m==="gold"||m==="silver") ? "oz" : "unit";
    const out = { price:v, unit, source:`scrape:${rec.name}` };
    setCache(`metal:${m}`, out, TTL.metalsFast);
  }catch{}
}

// ====== SCHEDULERS ======
// Gold/Silver by TwelveData every 3.5 minutes (if key & not weekend)
setInterval(async()=>{
  for (const m of ["gold","silver"]){
    try{
      const meta = METALS[m];
      if (!TWELVEDATA_KEY || !meta?.td) continue;
      const v = await tdPrice(meta.td);
      setCache(`metal:${m}`, {price:v, unit:meta.unit, source:"TwelveData"}, TTL.metalsFast);
    }catch{}
  }
}, 210_000);

// Backup via FMP every 6 minutes
setInterval(async()=>{
  for (const m of ["gold","silver"]){
    try{
      const meta = METALS[m];
      if (!FMP_KEY || !meta?.ms) continue;
      const v = await fmpQuote(meta.ms);
      setCache(`metal:${m}`, {price:v, unit:meta.unit, source:"FMP"}, TTL.metalsFast);
    }catch{}
  }
}, 360_000);

// Scraping rotation every 5 minutes (one site per tick)
setInterval(rotateScrape, 300_000);

// ====== EXPRESS APP ======
const app = express();

app.get("/api/health", (req,res)=> res.json({ ok:true, ts: Date.now() }));

// Metals (USD)
app.get("/api/metals", async (req,res)=>{
  try{
    const list = (req.query.list || "gold,silver,platinum,palladium,copper,aluminum,nickel,zinc,lead,tin,iron,steel,cobalt,lithium,uranium")
                  .split(",").map(s=>s.trim()).filter(Boolean);
    const out = {};
    for (const m of list){
      out[m] = await getMetalUSD(m);
    }
    res.json(out);
  }catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});

// FX
app.get("/api/fx", async (req,res)=>{
  try{
    const from=(req.query.from||"USD").toUpperCase();
    const to  =(req.query.to  ||"EGP").toUpperCase();
    const r = await getFX(from,to);
    res.json({ from, to, ...r });
  }catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});

// Crypto (incl. SLX)
app.get("/api/crypto", async (req,res)=>{
  try{
    const list=(req.query.list||"BTC,ETH,SLX").split(",").map(s=>s.trim()).filter(Boolean);
    const out={};
    for(const s of list){
      if (s.toUpperCase()==="SLX") out[s]=await getSLX();
      else out[s]=await getCryptoUSD(s);
    }
    res.json(out);
  }catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});

app.listen(PORT, ()=> console.log("Hybrid backend running on port "+PORT));
