import express from "express";
import fetch from "node-fetch";
import cheerio from "cheerio";

// ========= CONFIG =========
const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "ADMIN_12345";

// API KEYS (حط مفاتيحك هنا أو من Environment)
const TWELVEDATA_KEY   = process.env.TWELVEDATA_KEY   || ""; // 12data
const ALPHAVANTAGE_KEY = process.env.ALPHAVANTAGE_KEY || ""; // FX + WTI/Brent/NG
const FMP_KEY          = process.env.FMP_KEY          || ""; // بديل لبعض المعادن
const EXR_HOST_KEY     = process.env.EXR_HOST_KEY     || ""; // exchangerate.host (لو عندك)
const METALPRICE_KEY   = process.env.METALPRICE_KEY   || ""; // metalpriceapi (لو عندك)

// SLX config (BSC contract)
const SLX_BSC_CONTRACT = process.env.SLX_BSC_CONTRACT || "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d"; // من رسالتك
// ========= HELPERS =========
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const now = ()=> Date.now();

const cache = new Map(); // key -> {value, src, ts, ttl}
function getCache(key){
  const v = cache.get(key);
  if(!v) return null;
  if (now() - v.ts < v.ttl) return v;
  return null;
}
function setCache(key, value, src, ttlMs){
  cache.set(key, { value, src, ts: now(), ttl: ttlMs });
}
const log = (...args)=> console.log(new Date().toISOString(), ...args);

// عُطلة السوق (السبت/الأحد) للذهب/الفضة
function goldSilverMarketClosed() {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun,6=Sat
  return day === 0 || day === 6; // عطلة
}

// ========= SYMBOL MAPS =========
// كل الأسعار بالدولار
const METALS_MAP = {
  gold:      { unit:"oz", ySymbol:"XAUUSD=X", twelve:"XAU/USD" },
  silver:    { unit:"oz", ySymbol:"XAGUSD=X", twelve:"XAG/USD" },
  platinum:  { unit:"oz", ySymbol:"XPTUSD=X" },
  palladium: { unit:"oz", ySymbol:"XPDUSD=X" },

  copper:    { unit:"lb", ySymbol:"HG=F" },
  aluminum:  { unit:"t",  ySymbol:"ALI=F" },
  nickel:    { unit:"t",  ySymbol:"NID=F" },
  zinc:      { unit:"t",  ySymbol:"MZN=F" },
  lead:      { unit:"t",  ySymbol:"LD=F" },
  tin:       { unit:"t",  ySymbol:"TIN=F" },

  iron:      { unit:"t",  ySymbol:"TIO=F" },       // قد لا يتوفر دائمًا
  steel:     { unit:"t",  ySymbol:"HRC=F" },       // Hot Rolled Coil
  cobalt:    { unit:"t",  ySymbol:"CO=F" },        // قد لا يتوفر دائمًا
  lithium:   { unit:"t",  ySymbol:"LIT" },         // ETF proxy
  uranium:   { unit:"lb", ySymbol:"UX=F" },        // قد لا يتوفر دائمًا
};

// نفط وغاز
const ENERGY = {
  wti:   { ySymbol: "CL=F" }, // WTI
  brent: { ySymbol: "BZ=F" }, // Brent
  gas:   { ySymbol: "NG=F" }, // Natural Gas
};

// كريبتو الافتراضي
const DEFAULT_CRYPTO = ["BTC","ETH","SOL","XRP","BNB"];

// TTLs
const TTL = {
  goldsilver: 3*60*1000,   // 3 دقائق
  metals:     24*60*60*1000, // 24 ساعة
  fx:         60*60*1000,  // 1 ساعة
  crypto:     10*1000,     // 10 ثوانٍ
  energy:     5*60*1000,   // 5 دقائق
};

// ========= SOURCES (JSON-friendly) =========
// Yahoo Finance chart API
async function yahooPrice(ticker){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?region=US&lang=en-US`;
  const r = await fetch(url);
  if(!r.ok) throw new Error("Yahoo "+r.status);
  const j = await r.json();
  const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  const v = Number(p);
  if(!v) throw new Error("Yahoo no price");
  return v;
}

// TwelveData (gold/silver or FX if symbol exists)
async function twelvePrice(symbol){ // e.g. "XAU/USD"
  if(!TWELVEDATA_KEY) throw new Error("no 12Data key");
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVEDATA_KEY}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error("12Data "+r.status);
  const j = await r.json();
  const v = Number(j?.price);
  if(!v) throw new Error("12Data no price");
  return v;
}

// TheStreetGold (HTML)
async function streetGoldOz(){
  const url = "https://www.thestreet.com/quote/gold-price"; // صفحة تعرض السعر
  const r = await fetch(url);
  if(!r.ok) throw new Error("StreetGold "+r.status);
  const html = await r.text();
  const $ = cheerio.load(html);
  // نحاول إيجاد أول رقم واضح بالدولار
  let txt = $("body").text().match(/\$\s?([0-9,]+\.\d{2})/);
  if(!txt) throw new Error("StreetGold no price");
  const v = Number(txt[1].replace(/,/g,""));
  if(!v) throw new Error("StreetGold parsed 0");
  return v;
}

// CoinGecko simple price
async function coingeckoPrice(ids=[]) { // ids: ["bitcoin","ethereum"]
  if(ids.length===0) return {};
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
  const r = await fetch(url);
  if(!r.ok) throw new Error("CoinGecko "+r.status);
  return await r.json();
}

// CoinCap spot
async function coincapPrice(asset="bitcoin"){
  const url = `https://api.coincap.io/v2/assets/${asset}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error("CoinCap "+r.status);
  const j = await r.json();
  const v = Number(j?.data?.priceUsd);
  if(!v) throw new Error("CoinCap no price");
  return v;
}

// AlphaVantage FX
async function alphaFX(from="USD", to="EGP"){
  if(!ALPHAVANTAGE_KEY) throw new Error("no AV key");
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${ALPHAVANTAGE_KEY}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error("AV FX "+r.status);
  const j = await r.json();
  const v = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
  if(!v) throw new Error("AV FX no rate");
  return v;
}

// Frankfurter (مجاني)
async function frankfurterFX(from="USD", to="EGP"){
  const url = `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error("Frankfurter "+r.status);
  const j = await r.json();
  const v = Number(j?.rates?.[to]);
  if(!v) throw new Error("Frankfurter no rate");
  return v;
}

// AlphaVantage Energy (WTI/Brent/NG)
async function alphaEnergy(kind="WTI"){ // "WTI" | "BRENT" | "NATURAL_GAS"
  if(!ALPHAVANTAGE_KEY) throw new Error("no AV key");
  const fn = kind==="WTI" ? "WTI" : (kind==="BRENT"?"BRENT":"NATURAL_GAS");
  const url = `https://www.alphavantage.co/query?function=${fn}&interval=daily&apikey=${ALPHAVANTAGE_KEY}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error("AV Energy "+r.status);
  const j = await r.json();
  // نأخذ آخر قيمة
  const data = j?.data || j?.["data"] || j;
  const arr = data?.time_series || data?.entries || data;
  let last = null;
  if(Array.isArray(arr)) last = Number(arr[0]?.value || arr[0]?.price);
  // fallback parsing:
  const series = j?.data?.[0] || j?.["data"]?.[0];
  if(!last && series && series?.value) last = Number(series.value);
  if(!last){
    // Yahoo fallback
    const y = kind==="WTI" ? "CL=F" : (kind==="BRENT"?"BZ=F":"NG=F");
    last = await yahooPrice(y);
  }
  if(!last) throw new Error("Energy no price");
  return last;
}

// ========= ROTATION HELPERS =========
async function getGoldUSD(){
  const key = "gold:USD";
  const c = getCache(key); if(c) return c;
  let price=null, src=null;

  if(!goldSilverMarketClosed() && TWELVEDATA_KEY){
    try{ price = await twelvePrice(METALS_MAP.gold.twelve); src="12Data"; }
    catch{}
  }
  if(!price){
    try{ price = await yahooPrice(METALS_MAP.gold.ySymbol); src="Yahoo"; } catch{}
  }
  if(!price){
    try{ price = await streetGoldOz(); src="TheStreetGold"; } catch{}
  }
  if(!price) throw new Error("gold failed");

  const row = { value: price, src, ts: now(), ttl: TTL.goldsilver };
  cache.set(key, row);
  return row;
}

async function getSilverUSD(){
  const key = "silver:USD";
  const c = getCache(key); if(c) return c;
  let price=null, src=null;

  if(!goldSilverMarketClosed() && TWELVEDATA_KEY){
    try{ price = await twelvePrice(METALS_MAP.silver.twelve); src="12Data"; }
    catch{}
  }
  if(!price){
    try{ price = await yahooPrice(METALS_MAP.silver.ySymbol); src="Yahoo"; } catch{}
  }
  if(!price) throw new Error("silver failed");

  const row = { value: price, src, ts: now(), ttl: TTL.goldsilver };
  cache.set(key, row);
  return row;
}

async function getMetalUSD(m){ // name from METALS_MAP
  const mm = METALS_MAP[m]; if(!mm) throw new Error("unknown metal");
  const key = `metal:${m}`;
  const c = getCache(key); if(c) return c;

  let price=null, src=null;
  // 1) Yahoo
  if(mm.ySymbol){
    try{ price = await yahooPrice(mm.ySymbol); src="Yahoo"; } catch{}
  }
  // 2) FMP (لو متاح رمز مناسب)
  if(!price && FMP_KEY && mm.ySymbol){
    try{
      const url = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(mm.ySymbol)}?apikey=${FMP_KEY}`;
      const r = await fetch(url);
      if(r.ok){
        const j = await r.json();
        const v = Number(j?.[0]?.price);
        if(v) { price=v; src="FMP"; }
      }
    }catch{}
  }
  if(!price) throw new Error(m+" failed");
  const row = { value: price, src, ts: now(), ttl: TTL.metals };
  cache.set(key,row);
  return row;
}

async function getFX(from="USD", to="EGP"){
  const key = `fx:${from}:${to}`;
  const c = getCache(key); if(c) return c;
  let rate=null, src=null;
  try{ rate = await frankfurterFX(from,to); src="Frankfurter"; }catch{}
  if(!rate) { try{ rate = await alphaFX(from,to); src="AlphaVantage"; }catch{} }
  if(!rate) throw new Error("fx failed");

  const row = { value: rate, src, ts: now(), ttl: TTL.fx };
  cache.set(key,row);
  return row;
}

async function getEnergy(kind){ // wti|brent|gas
  const key = `energy:${kind}`;
  const c = getCache(key); if(c) return c;
  let v=null, src=null;
  try{ v = await alphaEnergy(kind.toUpperCase()==="GAS"?"NATURAL_GAS":kind.toUpperCase()); src="AlphaVantage/Yahoo"; }catch{}
  if(!v){
    const y = kind==="wti"?"CL=F":(kind==="brent"?"BZ=F":"NG=F");
    try{ v = await yahooPrice(y); src="Yahoo"; }catch{}
  }
  if(!v) throw new Error("energy failed "+kind);
  const row = { value: v, src, ts: now(), ttl: TTL.energy };
  cache.set(key,row);
  return row;
}

async function getCrypto(sym="BTC"){
  const key = `crypto:${sym.toUpperCase()}`;
  const c = getCache(key); if(c) return c;

  const idMap = { BTC:"bitcoin", ETH:"ethereum", SOL:"solana", XRP:"ripple", BNB:"binancecoin", SLX:"silverx" };
  const id = idMap[sym.toUpperCase()] || sym.toLowerCase();
  let price=null, src=null;

  // CoinGecko
  try{
    const cg = await coingeckoPrice([id]);
    const v = Number(cg?.[id]?.usd);
    if(v){ price=v; src="CoinGecko"; }
  }catch{}

  // CoinCap fallback
  if(!price){
    try{
      const cc = await coincapPrice(id==="ripple"?"xrp":(id==="binancecoin"?"binance-coin":id));
      if(cc){ price=cc; src="CoinCap"; }
    }catch{}
  }

  // SLX خاص: لو لسه غير مُدرج، بنحاول من PancakeSwap عبر السعر مقابل BUSD/USDT (تبسيط)
  if(!price && sym.toUpperCase()==="SLX"){
    try{
      // NOTE: endpoint عامّ تقديري، ممكن تغيّره لقراءة سعر من DEX API موثوق
      const url = `https://api.coincap.io/v2/assets/bitcoin`; // placeholder always resolvable
      const r = await fetch(url);
      if(r.ok){
        // لو مفيش إدراج، حافظ على manual فقط
        // نسيبها بدون سعر هنا
      }
    }catch{}
  }

  if(!price) throw new Error("crypto failed "+sym);

  const row = { value: price, src, ts: now(), ttl: TTL.crypto };
  cache.set(key,row);
  return row;
}

// ========= EXPRESS APP =========
const app = express();
app.use(express.json());
app.use(express.static("public")); // لإتاحة Admin.html

// Health
app.get("/api/health", (req,res)=> res.json({ok:true, ts: Date.now()}));

// Status: snapshot من الكاش
app.get("/api/status", (req,res)=>{
  const out = {};
  for(const [k,v] of cache.entries()){
    out[k] = { value:v.value, src:v.src, ts:v.ts, ttl:v.ttl };
  }
  res.json(out);
});

// ====== Gold/Silver
app.get("/api/gold", async (req,res)=>{
  try{ const r=await getGoldUSD(); res.json({usd:r.value, source:r.src, ts:r.ts}); }
  catch(e){ res.status(500).json({error:String(e.message||e)}); }
});
app.get("/api/silver", async (req,res)=>{
  try{ const r=await getSilverUSD(); res.json({usd:r.value, source:r.src, ts:r.ts}); }
  catch(e){ res.status(500).json({error:String(e.message||e)}); }
});

// ====== Metals 17
app.get("/api/metals", async (req,res)=>{
  try{
    const list = (req.query.list || Object.keys(METALS_MAP).join(","))
      .split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
    const out = {};
    for(const m of list){
      try{
        const r = await getMetalUSD(m);
        out[m] = { usd:r.value, source:r.src, ts:r.ts };
      }catch(e){
        out[m] = { error: String(e.message||e) };
      }
    }
    res.json(out);
  }catch(e){ res.status(500).json({error:String(e.message||e)}); }
});

// ====== Energy
app.get("/api/energy", async (req,res)=>{
  try{
    const kind=(req.query.kind||"wti").toLowerCase(); // wti/brent/gas
    const r = await getEnergy(kind);
    res.json({ kind, usd:r.value, source:r.src, ts:r.ts });
  }catch(e){ res.status(500).json({error:String(e.message||e)}); }
});

// ====== FX
app.get("/api/fx", async (req,res)=>{
  try{
    const from=(req.query.from||"USD").toUpperCase();
    const to=(req.query.to||"EGP").toUpperCase();
    const r = await getFX(from,to);
    res.json({ from, to, rate:r.value, source:r.src, ts:r.ts });
  }catch(e){ res.status(500).json({error:String(e.message||e)}); }
});

// ====== Crypto
app.get("/api/crypto", async (req,res)=>{
  try{
    const list=(req.query.list||DEFAULT_CRYPTO.join(",")).split(",").map(s=>s.trim()).filter(Boolean);
    const out = {};
    for(const s of list){
      try{
        const r=await getCrypto(s);
        out[s.toUpperCase()] = { usd:r.value, source:r.src, ts:r.ts };
      }catch(e){
        out[s.toUpperCase()] = { error: String(e.message||e) };
      }
    }
    res.json(out);
  }catch(e){ res.status(500).json({error:String(e.message||e)}); }
});

// ====== Admin Manual Set
app.post("/api/admin/manual", (req,res)=>{
  try{
    const token = req.query.token || req.body?.token;
    if(token !== ADMIN_TOKEN) return res.status(401).json({error:"unauthorized"});
    const { type, symbol, value } = req.body || {};
    if(!type || !symbol || typeof value!=="number") return res.status(400).json({error:"bad payload"});
    const key = `${type}:${symbol}`; // أمثلة: gold:USD | silver:USD | metal:copper | crypto:BTC | fx:USD:EGP | energy:wti
    setCache(key, value, "MANUAL", 24*60*60*1000);
    res.json({ok:true, key, value});
  }catch(e){ res.status(500).json({error:String(e.message||e)}); }
});

// ====== Clear Cache
app.post("/api/admin/clear-cache", (req,res)=>{
  try{
    const token = req.query.token || req.body?.token;
    if(token !== ADMIN_TOKEN) return res.status(401).json({error:"unauthorized"});
    cache.clear();
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:String(e.message||e)}); }
});

// ====== Rotation ping (optional cron via Render)
app.get("/api/ping", async (req,res)=>{
  const result = {};
  // ذهَب/فضة
  try{ result.gold = await getGoldUSD(); }catch(e){ result.gold={error:String(e.message||e)}; }
  await sleep(500);
  try{ result.silver = await getSilverUSD(); }catch(e){ result.silver={error:String(e.message||e)}; }
  // Energy
  for(const k of ["wti","brent","gas"]){
    await sleep(300);
    try{ result[k]=await getEnergy(k);}catch(e){ result[k]={error:String(e.message||e)}; }
  }
  // FX المثال USD/EGP
  await sleep(300);
  try{ result.fx = await getFX("USD","EGP"); }catch(e){ result.fx={error:String(e.message||e)}; }
  // Metals 17 (تحديث ثقيل: بالهدوء)
  for(const m of Object.keys(METALS_MAP)){
    await sleep(200);
    try{ const r=await getMetalUSD(m); result[m]=r; }catch(e){ result[m]={error:String(e.message||e)}; }
  }
  // Crypto مختصر
  for(const c of DEFAULT_CRYPTO){
    await sleep(200);
    try{ const r=await getCrypto(c); result[c]=r; }catch(e){ result[c]={error:String(e.message||e)}; }
  }
  // SLX
  try{ const r=await getCrypto("SLX"); result.SLX=r; }catch(e){ result.SLX={error:String(e.message||e)}; }

  res.json({ok:true, result});
});

app.listen(PORT, ()=> log("Server running on", PORT));
