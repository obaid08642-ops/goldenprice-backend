import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import WebSocket from "ws";

/* ---------------------- ENV KEYS ---------------------- */
const API_NINJAS_KEY   = process.env.API_NINJAS_KEY   || "";
const TWELVEDATA_KEY   = process.env.TWELVEDATA_KEY   || "";
const ALPHAVANTAGE_KEY = process.env.ALPHAVANTAGE_KEY || "";
const MARKETSTACK_KEY  = process.env.MARKETSTACK_KEY  || "";
const GOLDAPI_KEY      = process.env.GOLDAPI_KEY      || "";
const GOLDPRICEZ_KEY   = process.env.GOLDPRICEZ_KEY   || "";
const FMP_KEY          = process.env.FMP_KEY          || "";

const PORT = process.env.PORT || 10000;

/* ---------------------- HELPERS ---------------------- */
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));
const now = ()=> Date.now();

const cache = new Map(); // key -> {t, ttl, data}
function getCache(key){
  const v = cache.get(key);
  if(!v) return null;
  if (now() - v.t < v.ttl) return v.data;
  return null;
}
function setCache(key, data, ttl){
  cache.set(key, {t: now(), ttl, data});
}

// per-source backoff window
const backoffUntil = new Map(); // name -> ts
const sourceOK = (name)=> (backoffUntil.get(name)||0) < now();
const punish = (name, ms=180000)=> backoffUntil.set(name, now()+ms);

async function tryJson(url, opts={}, retries=1){
  let lastErr;
  for(let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if(!r.ok) throw new Error("HTTP "+r.status);
      return await r.json();
    }catch(e){
      lastErr = e;
      if (i===retries) throw e;
      await sleep(300 + i*500);
    }
  }
  throw lastErr;
}

async function tryText(url, opts={}, retries=1){
  let lastErr;
  for(let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if(!r.ok) throw new Error("HTTP "+r.status);
      return await r.text();
    }catch(e){
      lastErr = e;
      if (i===retries) throw e;
      await sleep(300 + i*500);
    }
  }
  throw lastErr;
}

/* ---------------------- METALS MAP ---------------------- */
// unit: oz (troy ounce), lb (pound), t (metric ton)
const METALS = {
  gold:      { unit:"oz", td:"XAU/USD", ninjas:"xau", y:"XAUUSD=X", c:"XAU", fmp:"GCUSD" },
  silver:    { unit:"oz", td:"XAG/USD", ninjas:"xag", y:"XAGUSD=X", c:"XAG", fmp:"SIUSD" },
  platinum:  { unit:"oz", td:"XPT/USD", ninjas:"xpt", y:"XPTUSD=X", c:"XPT", fmp:"PLUSD" },
  palladium: { unit:"oz", td:"XPD/USD", ninjas:"xpd", y:"XPDUSD=X", c:"XPD", fmp:"PAUSD" },

  copper:    { unit:"lb", td:null, ninjas:"copper",   y:"HG=F",  c:"HG",  fmp:"HGUSD" },
  aluminum:  { unit:"t",  td:null, ninjas:"aluminum", y:"ALI=F", c:"AL" },
  nickel:    { unit:"t",  td:null, ninjas:"nickel",   y:"NID=F", c:"NI" },
  zinc:      { unit:"t",  td:null, ninjas:"zinc",     y:"MZN=F", c:"ZN" },
  lead:      { unit:"t",  td:null, ninjas:"lead",     y:"LD=F",  c:"PB" },
  tin:       { unit:"t",  td:null, ninjas:"tin",      y:"TIN=F", c:"SN" },

  iron:      { unit:"t",  td:null, ninjas:"iron",     y:null,    c:null },
  steel:     { unit:"t",  td:null, ninjas:"steel",    y:null,    c:null },
  cobalt:    { unit:"t",  td:null, ninjas:"cobalt",   y:null,    c:null },
  lithium:   { unit:"t",  td:null, ninjas:"lithium",  y:null,    c:null },
  uranium:   { unit:"lb", td:null, ninjas:"uranium",  y:null,    c:null }
};

const TTL = { metals: 90_000, fx: 60_000, crypto: 10_000 };

/* ---------------------- PRIMARY SOURCES ---------------------- */
async function srcTwelve(symbol, tag){
  if(!TWELVEDATA_KEY) throw new Error("no TD key");
  if(!sourceOK(tag)) throw new Error("TD backoff");
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVEDATA_KEY}`;
  const j = await tryJson(url, {}, 1);
  const v = Number(j?.price);
  if(!v){ punish(tag); throw new Error("TD no price"); }
  return v;
}

async function srcNinjas(code, tag){
  if(!API_NINJAS_KEY) throw new Error("no Ninjas key");
  if(!sourceOK(tag)) throw new Error("Ninjas backoff");
  const url = `https://api.api-ninjas.com/v1/commodityprice?name=${encodeURIComponent(code)}`;
  const r = await fetch(url, { headers: {"X-Api-Key": API_NINJAS_KEY } });
  if(!r.ok){ punish(tag); throw new Error("Ninjas "+r.status); }
  const arr = await r.json();
  const v = Array.isArray(arr) && Number(arr[0]?.price);
  if(!v){ punish(tag); throw new Error("Ninjas no price"); }
  return v;
}

// FMP — السعر من endpoint الثابت
async function srcFMP(symbol, tag){
  if(!FMP_KEY) throw new Error("no FMP key");
  if(!sourceOK(tag)) throw new Error("FMP backoff");
  const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`;
  const j = await tryJson(url, {}, 1);
  const v = Number(Array.isArray(j) ? j[0]?.price : j?.price);
  if(!v){ punish(tag); throw new Error("FMP no price"); }
  return v;
}

async function srcAlphaFX(from="USD", to="EGP", tag="alpha"){
  if(!ALPHAVANTAGE_KEY) throw new Error("no AV key");
  if(!sourceOK(tag)) throw new Error("AV backoff");
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${ALPHAVANTAGE_KEY}`;
  const j = await tryJson(url, {}, 1);
  const v = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
  if(!v){ punish(tag, 3600_000); throw new Error("AV no fx"); }
  return v;
}

async function srcMarketStack(symbol, tag){
  if(!MARKETSTACK_KEY) throw new Error("no MarketStack key");
  if(!sourceOK(tag)) throw new Error("MS backoff");
  const url = `http://api.marketstack.com/v1/eod?access_key=${MARKETSTACK_KEY}&symbols=${encodeURIComponent(symbol)}`;
  const j = await tryJson(url, {}, 1);
  const v = Number(j?.data?.[0]?.close);
  if(!v){ punish(tag, 3600_000); throw new Error("MS no close"); }
  return v;
}

// Optional: GoldAPI / GoldPriceZ (للثمين فقط)
async function srcGoldAPI(metal="XAU", currency="USD", tag="goldapi"){
  if(!GOLDAPI_KEY) throw new Error("no GOLDAPI key");
  if(!sourceOK(tag)) throw new Error("GOLDAPI backoff");
  const url = `https://www.goldapi.io/api/${metal}/${currency}`;
  const r = await fetch(url, { headers: { "x-access-token": GOLDAPI_KEY } });
  if(!r.ok){ punish(tag); throw new Error("GoldAPI "+r.status); }
  const j = await r.json();
  const v = Number(j?.price);
  if(!v){ punish(tag); throw new Error("GoldAPI no price"); }
  return v;
}

async function srcGoldPriceZ(metal="XAU", currency="USD", tag="goldpricez"){
  if(!GOLDPRICEZ_KEY) throw new Error("no GOLDPRICEZ key");
  if(!sourceOK(tag)) throw new Error("GPZ backoff");
  const url = `https://www.goldpricez.com/api/rates/${metal}/${currency}/gram?api_key=${GOLDPRICEZ_KEY}`;
  const j = await tryJson(url, {}, 1);
  const v = Number(j?.["price_gram_24k"]);
  if(!v){ punish(tag); throw new Error("GPZ no price"); }
  return v * 31.1034768; // gram -> troy ounce
}

/* ---------------------- SCRAPERS ---------------------- */
async function scrapeYahooQuote(ticker, tag){
  if(!sourceOK(tag)) throw new Error("Yahoo backoff");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?region=US&lang=en-US`;
  const j = await tryJson(url, {}, 1);
  const v = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if(!v){ punish(tag); throw new Error("Yahoo no price"); }
  return Number(v);
}

async function scrapeXRatesGoldUSD(tag){
  if(!sourceOK(tag)) throw new Error("XR backoff");
  const html = await tryText("https://www.x-rates.com/commodity/gold", {}, 1);
  const $ = cheerio.load(html);
  let txt = $(".ccOutputRslt").first().text() || $("td:contains('Gold')").next().text();
  txt = (txt||"").replace(/[^\d.]/g,"");
  const v = Number(txt);
  if(!v){ punish(tag); throw new Error("X-Rates gold not found"); }
  return v;
}

/* ---------------------- METAL RESOLVER ---------------------- */
async function getMetalUSD(metal){
  const m = METALS[metal.toLowerCase()];
  if(!m) throw new Error("unknown metal: "+metal);
  const key = `metal:${metal}`;
  const cached = getCache(key);
  if (cached) return cached;

  // A) Primary round (TwelveData → Ninjas → GoldPriceZ → FMP)
  const A = [];
  if (m.td && TWELVEDATA_KEY) A.push(()=>srcTwelve(m.td, "td:"+m.td));
  if (m.ninjas && API_NINJAS_KEY) A.push(()=>srcNinjas(m.ninjas, "ninjas:"+m.ninjas));
  if (["XAU","XAG","XPT","XPD"].includes(m.c) && GOLDPRICEZ_KEY) A.push(()=>srcGoldPriceZ(m.c,"USD","gpz"));
  if (m.fmp && FMP_KEY) A.push(()=>srcFMP(m.fmp, "fmp:"+m.fmp));
  for (const fn of A){
    try {
      const v = await fn();
      if (v){ const out={price:v, unit:m.unit, source:"A"}; setCache(key,out, TTL.metals); return out; }
    } catch {}
  }

  // B) Scraping
  const B = [];
  if (m.y) B.push(()=>scrapeYahooQuote(m.y, "yahoo:"+m.y));
  if (metal.toLowerCase()==="gold") B.push(()=>scrapeXRatesGoldUSD("xrates:gold"));
  for (const fn of B){
    try {
      const v = await fn();
      if (v){ const out={price:v, unit:m.unit, source:"B"}; setCache(key,out, TTL.metals); return out; }
    } catch {}
  }

  // C) Backup (MarketStack, GoldAPI)
  const C = [];
  if (m.c && MARKETSTACK_KEY) C.push(()=>srcMarketStack(m.c, "ms:"+m.c));
  if (GOLDAPI_KEY && m.c) C.push(()=>srcGoldAPI(m.c, "USD", "goldapi"));
  for (const fn of C){
    try {
      const v = await fn();
      if (v){ const out={price:v, unit:m.unit, source:"C"}; setCache(key,out, TTL.metals); return out; }
    } catch {}
  }

  // last resort: stale
  const stale = cache.get(key)?.data;
  if (stale) return stale;
  throw new Error("all sources failed for "+metal);
}

/* ---------------------- FX ---------------------- */
async function getFX(from="USD", to="EGP"){
  const key = `fx:${from}:${to}`;
  const cached = getCache(key);
  if (cached) return cached;

  try{
    if (TWELVEDATA_KEY){
      const j = await tryJson(`https://api.twelvedata.com/price?symbol=${from}/${to}&apikey=${TWELVEDATA_KEY}`);
      const v = Number(j?.price);
      if (v){ const out={rate:v, source:"TD"}; setCache(key,out, TTL.fx); return out; }
    }
  }catch{}

  try{
    if (API_NINJAS_KEY){
      const r = await fetch(`https://api.api-ninjas.com/v1/exchangerate?pair=${from}${to}`, { headers: {"X-Api-Key": API_NINJAS_KEY }});
      if (r.ok){
        const j = await r.json();
        const v = Number(j?.exchange_rate);
        if (v){ const out={rate:v, source:"Ninjas"}; setCache(key,out, TTL.fx); return out; }
      }
    }
  }catch{}

  try{
    const v = await srcAlphaFX(from,to,"alpha");
    if (v){ const out={rate:v, source:"AV"}; setCache(key,out, TTL.fx); return out; }
  }catch{}

  const stale = cache.get(key)?.data;
  if (stale) return stale;
  throw new Error("FX failed");
}

/* ---------------------- CRYPTO ---------------------- */
const wsPrices = new Map(); // "BTCUSDT" -> price
function startBinanceWS(pairs=["btcusdt","ethusdt","solusdt","xrpusdt"]){
  try{
    const streams = pairs.map(p=>`${p}@ticker`).join('/');
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    ws.on("message",(buf)=>{
      try{
        const j = JSON.parse(buf.toString());
        const d = j?.data; if (d?.s && d?.c) wsPrices.set(d.s, Number(d.c));
      }catch{}
    });
    ws.on("close", ()=> setTimeout(()=>startBinanceWS(pairs), 3000));
    ws.on("error", ()=> ws.close());
  }catch{}
}
startBinanceWS();

async function getCryptoUSDT(sym="BTC"){
  const key = `crypto:${sym}`;
  const cached = getCache(key);
  if (cached) return cached;

  const ws = wsPrices.get(`${sym.toUpperCase()}USDT`);
  if (ws){ const out={price:ws, source:"BinanceWS"}; setCache(key,out, TTL.crypto); return out; }

  try{
    const j = await tryJson(`https://api.coingecko.com/api/v3/simple/price?ids=${sym.toLowerCase()}&vs_currencies=usd`);
    const v = Number(j?.[sym.toLowerCase()]?.usd);
    if (v){ const out={price:v, source:"CoinGecko"}; setCache(key,out, TTL.crypto); return out; }
  }catch{}

  try{
    const map={BTC:"XBTUSD", ETH:"ETHUSD"};
    const kr = map[sym.toUpperCase()] || `${sym.toUpperCase()}USD`;
    const j = await tryJson(`https://api.kraken.com/0/public/Ticker?pair=${kr}`);
    const obj = j?.result && Object.values(j.result)[0];
    const v = Number(obj?.c?.[0]);
    if (v){ const out={price:v, source:"Kraken"}; setCache(key,out, TTL.crypto); return out; }
  }catch{}

  const stale = cache.get(key)?.data;
  if (stale) return stale;
  throw new Error("crypto failed");
}

/* ---------------------- EXPRESS APP ---------------------- */
const app = express();

app.get("/api/health", (req,res)=> res.json({ ok:true, ts: Date.now() }));
app.get("/api/status", (req,res)=>{
  res.json({
    uptime: process.uptime(),
    cacheKeys: [...cache.keys()],
    backoff: Object.fromEntries(backoffUntil)
  });
});

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

app.get("/api/fx", async (req,res)=>{
  try{
    const from=(req.query.from||"USD").toUpperCase();
    const to=(req.query.to||"EGP").toUpperCase();
    const r = await getFX(from,to);
    res.json({ from, to, ...r });
  }catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});

app.get("/api/crypto", async (req,res)=>{
  try{
    const list=(req.query.list||"BTC,ETH").split(",").map(s=>s.trim()).filter(Boolean);
    const out={};
    for(const s of list) out[s]=await getCryptoUSDT(s);
    res.json(out);
  }catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});

/* --------- PERIODIC FMP REFRESH (كل 6 دقايق احتياطيًا حتى لو كله شغال) --------- */
const FMP_REFRESH_MS = 6 * 60 * 1000;
const FMP_METALS = Object.entries(METALS)
  .filter(([,m]) => !!m.fmp)
  .map(([name,m]) => ({ name, fmp: m.fmp, unit: m.unit }));

async function periodicFMP(){
  if (!FMP_KEY) return;
  for (const item of FMP_METALS){
    try{
      const v = await srcFMP(item.fmp, "fmp:"+item.fmp);
      if (v){
        setCache(`metal:${item.name}`, { price:v, unit:item.unit, source:"FMP-periodic" }, TTL.metals);
        await sleep(250);
      }
    }catch{
      // تجاهل أي خطأ أثناء التحديث الدوري
    }
  }
}
setInterval(periodicFMP, FMP_REFRESH_MS);
periodicFMP(); // أول تشغيل

app.listen(PORT, ()=> console.log("Hybrid backend running on port "+PORT));
