// server.js  — Hybrid API with smart cache & rotation
import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ----- paths / cache -----
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, "cache.json");

// load env (Render يمرر ENV تلقائياً، محلياً استعمل .env)
if (fs.existsSync(path.join(__dirname, ".env"))) {
  const dotenv = await import("dotenv");
  dotenv.config();
}

// ----- ENV KEYS (حط مفاتيحك قبل التشغيل) -----
const TWELVEDATA_KEY   = process.env.TWELVEDATA_KEY   || "";   // 800 req/day
const ALPHAVANTAGE_KEY = process.env.ALPHAVANTAGE_KEY || "";   // 25 req/day (commodities)
const COINCAP_KEY      = process.env.COINCAP_KEY      || "";   // optional
const GOLDPRICEZ_KEY   = process.env.GOLDPRICEZ_KEY   || "";   // optional (تجربة)
const FMP_KEY          = process.env.FMP_KEY          || "";   // optional

// ----- CONFIG (تقدر تغيّر الفواصل من ENV) -----
const PORT = process.env.PORT || 3000;

// جداول التحديث (بالميلي ثانية)
const INTERVAL_GOLD_SILVER_MS = Number(process.env.INTERVAL_GOLD_SILVER_MS || 5*60*1000);  // 5 دقائق
const INTERVAL_CRYPTO_MS      = Number(process.env.INTERVAL_CRYPTO_MS      || 2*60*1000);  // 2 دقيقة
const INTERVAL_FX_MS          = Number(process.env.INTERVAL_FX_MS          ||10*60*1000);  // 10 دقائق
const INTERVAL_METALS_MS      = Number(process.env.INTERVAL_METALS_MS      ||15*60*60*1000); // 15 ساعة
const INTERVAL_OILGAS_MS      = Number(process.env.INTERVAL_OILGAS_MS      || 9*60*60*1000); // 9 ساعات

// إيقاف ذهب/فضة في الويك إند؟
const DISABLE_PM_WEEKEND = (process.env.DISABLE_PM_WEEKEND || "true").toLowerCase() === "true";

// ----- Helpers -----
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));
async function tryJson(url, opts={}, retries=1, backoff=400){
  let last;
  for(let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    }catch(e){
      last = e;
      if(i===retries) throw last;
      await sleep(backoff*(i+1));
    }
  }
}
function isWeekendForMetals(){
  if(!DISABLE_PM_WEEKEND) return false;
  // السوق يغلق تقريباً من مساء الجمعة إلى مساء الأحد UTC
  const now = new Date();
  const d = now.getUTCDay(); // 0=Sun .. 6=Sat
  // نوقف السبت والأحد بالكامل
  return d === 6 || d === 0;
}

// ----- Cache -----
function loadCache(){
  try{
    if(fs.existsSync(CACHE_FILE)){
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    }
  }catch{}
  return {
    gold: null, silver: null,
    crypto: {}, fx: {}, metals: {}, oilgas: {},
    last: {}
  };
}
function saveCache(){
  try{ fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); }catch{}
}
const cache = loadCache();

// ----- GOLD / SILVER sources (Rotation) -----
let pmIdx = 0;
const pmSources = [
  // TwelveData (XAU/USD, XAG/USD)
  async (metal)=> {
    if(!TWELVEDATA_KEY) throw new Error("TD key missing");
    const sym = metal === "gold" ? "XAU/USD" : "XAG/USD";
    const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(sym)}&apikey=${TWELVEDATA_KEY}`;
    const j = await tryJson(url);
    const v = Number(j?.price);
    if(!v) throw new Error("TD no price");
    return { price:v, source:"twelvedata" };
  },
  // AlphaVantage (spot from FX proxy: XAUUSD / XAGUSD via CURRENCY_EXCHANGE_RATE sometimes unavailable — لذلك أبقيها احتياطية)
  async (metal)=> {
    if(!ALPHAVANTAGE_KEY) throw new Error("AV key missing");
    const from = (metal==="gold") ? "XAU" : "XAG";
    const to   = "USD";
    const url  = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${ALPHAVANTAGE_KEY}`;
    const j = await tryJson(url);
    const v = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
    if(!v) throw new Error("AV no fx");
    return { price:v, source:"alphavantage_fx" };
  },
  // GoldPriceZ (تجريبي)  — يعيد جرام 24k؛ نحوّله لأونصة
  async (metal)=> {
    if(!GOLDPRICEZ_KEY) throw new Error("GPZ key missing");
    const m = (metal==="gold") ? "XAU" : "XAG";
    const url = `https://www.goldpricez.com/api/rates/${m}/USD/gram?api_key=${GOLDPRICEZ_KEY}`;
    const j = await tryJson(url);
    const g = Number(j?.["price_gram_24k"]);
    if(!g) throw new Error("GPZ no gram");
    const oz = g * 31.1034768;
    return { price: oz, source:"goldpricez_gram24k" };
  },
];

// StreetGold (HTML) — كملاذ أخير للذهب فقط (silver غير متاح غالباً بنفس الصفحة)
async function fallbackStreetGold(){
  const url = "https://www.thestreet.com/investing/gold-price";
  const txt = await (await fetch(url)).text();
  const m = txt.match(/"Gold Price[^"]*"\s*:\s*\{\s*"price"\s*:\s*"?([\d.,]+)"?\s*,/i)
         || txt.match(/data-test="instrument-price-last">([\d.,]+)/i);
  if(!m) throw new Error("streetgold no match");
  const v = Number(String(m[1]).replace(/,/g,""));
  if(!v) throw new Error("streetgold NaN");
  return { price:v, source:"streetgold_scrape" };
}

// ----- Crypto sources -----
async function srcCoinGecko(sym="bitcoin"){
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(sym.toLowerCase())}&vs_currencies=usd`;
  const j = await tryJson(url);
  const v = Number(j?.[sym.toLowerCase()]?.usd);
  if(!v) throw new Error("CG no price");
  return { price:v, source:"coingecko" };
}
async function srcCoinCap(sym="bitcoin"){
  const url = `https://api.coincap.io/v2/assets/${encodeURIComponent(sym.toLowerCase())}`;
  const headers = COINCAP_KEY ? {Authorization:`Bearer ${COINCAP_KEY}`} : {};
  const j = await tryJson(url, {headers});
  const v = Number(j?.data?.priceUsd);
  if(!v) throw new Error("CoinCap no price");
  return { price:v, source:"coincap" };
}
// SilverX (SLX) من Pancake via CoinGecko إن توفرت، وإلا من CoinCap إن وُجد اسم
async function getCrypto(sym){
  const idMap = { BTC:"bitcoin", ETH:"ethereum", SLX:"silverx" }; // غيّر id لو مختلف في CG/CC
  const id = idMap[sym.toUpperCase()] || sym.toLowerCase();
  // 1) CoinGecko
  try{ return await srcCoinGecko(id); }catch{}
  // 2) CoinCap
  try{ return await srcCoinCap(id); }catch{}
  // 3) Stale
  const stale = cache.crypto[sym]?.price;
  if(stale) return { price:stale, source:"stale" };
  throw new Error("crypto failed for "+sym);
}

// ----- Forex (Frankfurter / exchangerate.host / AlphaVantage fallback) -----
async function srcFrankfurter(base="USD"){
  const url = `https://api.frankfurter.dev/latest?from=${encodeURIComponent(base)}`;
  return await tryJson(url);
}
async function srcExchHost(){
  // free no-key endpoint
  const url = `https://api.exchangerate.host/latest?base=USD`;
  return await tryJson(url);
}
async function srcAV_FX(from="USD", to="EGP"){
  if(!ALPHAVANTAGE_KEY) throw new Error("AV key missing");
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${ALPHAVANTAGE_KEY}`;
  const j = await tryJson(url);
  const v = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
  if(!v) throw new Error("AV no fx rate");
  return v;
}

async function refreshFX(){
  try{
    // أولاً نجرب Frankfurter & exchangerate.host لتغطية واسعة
    let rates = {};
    try {
      const j = await srcFrankfurter("USD");
      if(j?.rates) rates = {...rates, ...j.rates};
    } catch {}

    try{
      const j2 = await srcExchHost();
      if(j2?.rates) rates = {...rates, ...j2.rates};
    }catch{}

    // أمثلة أزواج مطلوبة بشكل مباشر (لضمان وجودها)
    const mustPairs = [["USD","EGP"], ["USD","SAR"], ["USD","EUR"], ["USD","TRY"]];
    for(const [from,to] of mustPairs){
      if(!rates[to]){
        try{
          const v = await srcAV_FX(from,to);
          rates[to] = v;
        }catch{}
      }
    }

    if(Object.keys(rates).length){
      cache.fx = { ...rates, base:"USD", lastUpdated:new Date().toISOString() };
      saveCache();
    }
  }catch{}
}

// ----- Industrial Metals (FMP/TD if available) -----
const METALS_LIST = [
  "copper","aluminum","nickel","zinc","lead","tin","iron","steel","cobalt","lithium","uranium",
  "platinum","palladium" // precious ضمن القائمة الطويلة
];
// TwelveData symbols لبعضها غير متاح؛ سنستخدم FMP إن وجد، وإلا نُبقي القديم.
async function tdCommodity(symbol){ // يحاول price لـ symbol إن وجد
  if(!TWELVEDATA_KEY) throw new Error("TD key missing");
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVEDATA_KEY}`;
  const j = await tryJson(url);
  const v = Number(j?.price);
  if(!v) throw new Error("TD no price");
  return v;
}
async function fmpQuote(symbol){ // e.g., HG=F للنحاس (CME Futures) / or GCUSD, SIUSD للذهب/الفضة
  if(!FMP_KEY) throw new Error("FMP key missing");
  const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`;
  const j = await tryJson(url);
  const v = Number(j?.[0]?.price);
  if(!v) throw new Error("FMP no price");
  return v;
}
// خريطة تقريبية لرموز FMP/TD لبعض المعادن (يمكن توسعتها لاحقاً)
const METAL_SYMBOLS = {
  copper:   { fmp:"HG=F" },       // Copper futures
  aluminum: { fmp:"ALI=F" },      // Aluminum
  nickel:   { fmp:"NID=F" },
  zinc:     { fmp:"MZN=F" },
  lead:     { fmp:"LED=F" },
  tin:      { fmp:"TIN=F" },
  iron:     { fmp:null },         // غالباً بدون رمز مباشر مجاني
  steel:    { fmp:null },
  cobalt:   { fmp:null },
  lithium:  { fmp:null },
  uranium:  { fmp:null },
  platinum: { fmp:"XPTUSD" },
  palladium:{ fmp:"XPDUSD" },
};
async function refreshIndustrialMetals(){
  const out = {...(cache.metals?.value||{})};
  for(const m of METALS_LIST){
    const map = METAL_SYMBOLS[m] || {};
    let val = null;
    // 1) FMP
    if(map.fmp && FMP_KEY){
      try{ val = await fmpQuote(map.fmp); }catch{}
    }
    // 2) TwelveData (لو عندك رمز مناسب)
    if(val==null && map.td && TWELVEDATA_KEY){
      try{ val = await tdCommodity(map.td); }catch{}
    }
    if(val!=null){
      out[m] = { usd: val, source: map.fmp?"fmp":"twelvedata", t: Date.now() };
      await sleep(250); // تهدئة بسيطة
    } else {
      // أبقي القديمة لو فيه
      if(out[m]) { /* keep old */ } else { /* مفيش */ }
    }
  }
  cache.metals = { value: out, lastUpdated: new Date().toISOString() };
  saveCache();
}

// ----- Oil & Gas (AlphaVantage Commodities) -----
async function avCommodity(fn){ // WTI / BRENT / NATURAL_GAS
  if(!ALPHAVANTAGE_KEY) throw new Error("AV key missing");
  const url = `https://www.alphavantage.co/query?function=${fn}&interval=daily&apikey=${ALPHAVANTAGE_KEY}`;
  const j = await tryJson(url);
  const arr = j?.data || j?.[fn] || j; // بنحاول نلقط أقرب مسار
  // نحاول استخراج آخر قيمة close/price بشكل مرن
  let v=null;
  if(Array.isArray(arr) && arr.length){
    const last = arr[0];
    v = Number(last?.value || last?.close || last?.price);
  }
  if(!v){
    // fallback: ابحث في حقول معروفة
    const dset = j?.dataset || j;
    const guess = Number(
      dset?.data?.[0]?.[1] || dset?.data?.[0]?.value || dset?.[Object.keys(dset).find(k=>/price|close/i.test(k))] || 0
    );
    if(guess) v = guess;
  }
  if(!v) throw new Error("AV commodity parse fail");
  return v;
}
async function refreshOilGas(){
  const out = {...(cache.oilgas?.value||{})};
  // نحاول WTI/Brent/Natural Gas
  const list = [
    ["WTI","WTI"], ["BRENT","BRENT"], ["NATURAL_GAS","NATURAL_GAS"]
  ];
  for(const [fn,key] of list){
    try{
      const val = await avCommodity(fn);
      out[key.toLowerCase()] = { usd: val, source:"alphavantage", t: Date.now() };
      await sleep(400);
    }catch{}
  }
  cache.oilgas = { value: out, lastUpdated: new Date().toISOString() };
  saveCache();
}

// ----- Precious metals refresh -----
async function refreshPM(){
  if(isWeekendForMetals()){
    // عطلة نهاية الأسبوع: لا نحدّث لكن لا نمسح الكاش
    return;
  }
  // ترتيب الدور
  const sources = pmSources;
  const goldTryOrder   = [pmIdx, (pmIdx+1)%sources.length, (pmIdx+2)%sources.length];
  const silverTryOrder = goldTryOrder;
  // GOLD
  let gold=null;
  for(const i of goldTryOrder){
    try{ gold = await sources[i]("gold"); pmIdx = (i+1)%sources.length; break; }catch{}
  }
  if(!gold){ // fallback HTML
    try{ gold = await fallbackStreetGold(); }catch{}
  }
  if(gold){
    cache.gold = { usd:gold.price, source:gold.source, t: Date.now() };
  }
  // SILVER
  let silver=null;
  for(const i of silverTryOrder){
    try{ silver = await sources[i]("silver"); pmIdx = (i+1)%sources.length; break; }catch{}
  }
  // (لا يوجد HTML fallback موثوق للفضة حالياً)
  if(silver){
    cache.silver = { usd:silver.price, source:silver.source, t: Date.now() };
  }
  saveCache();
}

// ----- Crypto refresh -----
const DEFAULT_CRYPTO = (process.env.CRYPTO_LIST || "BTC,ETH,SLX").split(",").map(s=>s.trim()).filter(Boolean);
async function refreshCrypto(){
  for(const s of DEFAULT_CRYPTO){
    try{
      const v = await getCrypto(s);
      cache.crypto[s] = { usd:v.price, source:v.source, t: Date.now() };
    }catch{
      // keep stale
    }
    await sleep(250);
  }
  saveCache();
}

// ----- Schedulers -----
setInterval(refreshPM,      INTERVAL_GOLD_SILVER_MS);
setInterval(refreshCrypto,  INTERVAL_CRYPTO_MS);
setInterval(refreshFX,      INTERVAL_FX_MS);
setInterval(refreshIndustrialMetals, INTERVAL_METALS_MS);
setInterval(refreshOilGas,  INTERVAL_OILGAS_MS);

// أول تشغيل فوري
(async()=>{
  await Promise.allSettled([
    refreshPM(),
    refreshCrypto(),
    refreshFX(),
    refreshIndustrialMetals(),
    refreshOilGas()
  ]);
})();

// ----- Express API -----
const app = express();

app.get("/api/health", (req,res)=> {
  res.json({ ok:true, ts: Date.now() });
});

// gold/silver
app.get("/api/gold",   (req,res)=> cache.gold   ? res.json(cache.gold)   : res.status(503).json({error:"no gold"}));
app.get("/api/silver", (req,res)=> cache.silver ? res.json(cache.silver) : res.status(503).json({error:"no silver"}));

// crypto
app.get("/api/crypto", (req,res)=>{
  const list = (req.query.list || DEFAULT_CRYPTO.join(",")).split(",").map(s=>s.trim()).filter(Boolean);
  const out={};
  for(const s of list){
    if(cache.crypto[s]) out[s]=cache.crypto[s];
  }
  if(Object.keys(out).length===0) return res.status(503).json({error:"no crypto"});
  res.json(out);
});

// forex
app.get("/api/fx", (req,res)=>{
  // يرجّع الخريطة المخزنة (base=USD)
  if(!cache.fx || Object.keys(cache.fx).length===0) return res.status(503).json({error:"no fx"});
  res.json(cache.fx);
});

// industrial metals
app.get("/api/metals", (req,res)=>{
  if(!cache.metals?.value || Object.keys(cache.metals.value).length===0) return res.status(503).json({error:"no metals"});
  const list = (req.query.list||"").split(",").map(s=>s.trim()).filter(Boolean);
  if(list.length===0) return res.json(cache.metals);
  const filtered={};
  for(const m of list){
    if(cache.metals.value[m]) filtered[m]=cache.metals.value[m];
  }
  res.json({ value: filtered, lastUpdated: cache.metals.lastUpdated });
});

// oil & gas
app.get("/api/oilgas", (req,res)=>{
  if(!cache.oilgas?.value || Object.keys(cache.oilgas.value).length===0) return res.status(503).json({error:"no oilgas"});
  res.json(cache.oilgas);
});

// everything snapshot
app.get("/api/snapshot", (req,res)=>{
  res.json({
    gold: cache.gold,
    silver: cache.silver,
    crypto: cache.crypto,
    fx: cache.fx,
    metals: cache.metals,
    oilgas: cache.oilgas,
    last: cache.last
  });
});

app.listen(PORT, ()=> console.log("Hybrid backend running on port "+PORT));
