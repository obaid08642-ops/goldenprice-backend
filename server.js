import express from "express";
import axios from "axios";
import cheerio from "cheerio";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 10000;

// ===== TTLs =====
const TTL = {
  gold:   210 * 1000,  // 3.5 دقيقة
  silver: 210 * 1000,
  metals: 24 * 3600 * 1000,
  crypto: 3 * 1000,    // كريبتو سريع
  oilgas: 12 * 3600 * 1000,
  forex:  60 * 3600 * 1000
};

// ===== Helpers =====
const cache = new Map(); // key -> {data, ts}
const statusLog = {};    // sourceId -> {ok, lastTs, msg}
const backoffUntil = new Map(); // sourceId -> ts

function setCache(key, data){ cache.set(key, { data, ts: Date.now() }); }
function getCache(key, maxAge){
  const v = cache.get(key);
  return (v && (Date.now() - v.ts <= maxAge)) ? v.data : null;
}
function ok(id){ statusLog[id] = { ok:true, lastTs: Date.now() }; }
function bad(id, ms=5*60*1000, msg="backoff"){
  backoffUntil.set(id, Date.now()+ms);
  statusLog[id] = { ok:false, lastTs: Date.now(), msg };
}
function allowed(id){ return (backoffUntil.get(id)||0) < Date.now(); }
function num(x){
  if (typeof x === "number") return x;
  if (!x) return NaN;
  const m = String(x).replace(/[, ]/g,"").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

// عطلة WE للذهب/الفضة (تقريبي)
function metalsWeekendClosed(){
  const d=new Date();
  const day=d.getUTCDay();
  return (day===6 || day===0); // السبت/الأحد
}

// ===== Load sites.json =====
const SITES = JSON.parse(fs.readFileSync(path.join(process.cwd(),"sites.json"),"utf8"));

// ===== Primary APIs =====
const TD = process.env.TWELVEDATA_KEY || "";
const AV = process.env.ALPHAVANTAGE_KEY || "";
const FMP= process.env.FMP_KEY || "";
const GPZ= process.env.GOLDPRICEZ_KEY || "";
const USE_CG = !!process.env.COINGECKO_FREE;

// === GOLD/SILVER primary from TwelveData ===
async function tdPrice(symbol){ // e.g. "XAU/USD"
  if(!TD) throw new Error("TD key missing");
  const url=`https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${TD}`;
  const {data}=await axios.get(url, {timeout:8000});
  const v=num(data?.price);
  if(!v) throw new Error("TD no price");
  return v;
}

// === Forex (AV fallback) ===
async function avFx(from,to){
  if(!AV) throw new Error("AV key missing");
  const url=`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${AV}`;
  const {data}=await axios.get(url,{timeout:8000});
  const v=num(data?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
  if(!v) throw new Error("AV FX no rate");
  return v;
}

// === Metals extended (FMP optional) ===
// أمثلة: GCUSD (Gold), SIUSD (Silver) عند FMP/market
async function fmpQuote(symbol){
  if(!FMP) throw new Error("FMP key missing");
  const url=`https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(symbol)}?apikey=${FMP}`;
  const {data}=await axios.get(url,{timeout:8000});
  const v=num(data?.[0]?.price);
  if(!v) throw new Error("FMP no price");
  return v;
}

// === Crypto: CoinGecko primary (no key) ===
async function cgSimple(ids="bitcoin", vs="usd"){
  const url=`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vs)}`;
  const {data}=await axios.get(url,{timeout:6000});
  return data;
}

// ===== Scraper engine =====
async function scrapeOne(src){
  // src: {id,cat,url,type,selector? ,jsonPath?}
  if(!allowed(src.id)) throw new Error("backoff");
  try{
    if(src.type==="json"){
      const {data}=await axios.get(src.url,{timeout:8000, headers: src.headers||{}});
      let val=data;
      if(src.jsonPath){
        for(const p of src.jsonPath.split(".")){
          const k=p.replace(/\[(\d+)\]/g,".$1").split(".");
          for(const kk of k){ val = (val||{})[kk]; }
        }
      }
      const v=num(val);
      if(!v) throw new Error("json no num");
      ok(src.id);
      return v;
    }else{ // html
      const {data:html}=await axios.get(src.url,{timeout:10000, headers: src.headers||{}});
      const $=cheerio.load(html);
      const t=$(src.selector).first().text();
      const v=num(t);
      if(!v) throw new Error("html no num");
      ok(src.id);
      return v;
    }
  }catch(e){
    bad(src.id, 8*60*1000, e.message||"err");
    throw e;
  }
}

async function rotate(category){
  const list = SITES[category] || [];
  if(!list.length) throw new Error("no sources for "+category);
  // ابحث عن أول مصدر متاح (ليس في backoff)
  for(let i=0;i<list.length;i++){
    const idx = (SITES.__rot?.[category]||0)%list.length;
    const src = list[idx];
    SITES.__rot = SITES.__rot || {};
    SITES.__rot[category] = idx+1;
    if(!allowed(src.id)) continue;
    try{
      const v = await scrapeOne(src);
      return v;
    }catch{ /* جرّب اللي بعده */ }
  }
  throw new Error("all "+category+" scrapers failed");
}

// ===== Resolvers =====
async function getGoldUSD(){
  const key="gold";
  const c=getCache(key, TTL.gold);
  if(c!=null) return c;
  // عطلة WE: نعتمد الكاش والسكراپر فقط
  if(!metalsWeekendClosed()){
    try{ const v=await tdPrice("XAU/USD"); setCache(key,v); return v; }catch{}
  }
  try{ const v=await rotate("gold"); setCache(key,v); return v; }catch{}
  const stale=getCache(key, 7*24*3600*1000); // أقدم أسبوع
  if(stale!=null) return stale;
  throw new Error("gold failed");
}

async function getSilverUSD(){
  const key="silver";
  const c=getCache(key, TTL.silver);
  if(c!=null) return c;
  if(!metalsWeekendClosed()){
    try{ const v=await tdPrice("XAG/USD"); setCache(key,v); return v; }catch{}
  }
  try{ const v=await rotate("silver"); setCache(key,v); return v; }catch{}
  const stale=getCache(key, 7*24*3600*1000);
  if(stale!=null) return stale;
  throw new Error("silver failed");
}

// extended metals (daily)
const METALS = {
  platinum:{symFMP:"PL=F"}, palladium:{symFMP:"PA=F"},
  copper:{symFMP:"HG=F"}, aluminum:{symFMP:"ALI=F"},
  zinc:{symFMP:"MZN=F"}, nickel:{symFMP:"NID=F"},
  lead:{symFMP:"LD=F"}, tin:{symFMP:"TIN=F"},
  iron:{symFMP:null}, steel:{symFMP:null},
  cobalt:{symFMP:null}, lithium:{symFMP:null},
  uranium:{symFMP:null}
};
async function getMetal(name){
  const key="metal:"+name;
  const c=getCache(key, TTL.metals);
  if(c!=null) return c;
  // FMP إن وجد
  const conf=METALS[name];
  if(conf?.symFMP && FMP){
    try{ const v=await fmpQuote(conf.symFMP); setCache(key,v); return v; }catch{}
  }
  // سكراپر عام
  try{ const v=await rotate("metals"); setCache(key,v); return v; }catch{}
  const stale=getCache(key, 14*24*3600*1000);
  if(stale!=null) return stale;
  throw new Error(name+" failed");
}

// crypto (CoinGecko)
async function getCrypto(sym="bitcoin"){
  const key="crypto:"+sym.toLowerCase();
  const c=getCache(key, TTL.crypto); if(c!=null) return c;
  if(USE_CG){
    try{
      const j=await cgSimple(sym.toLowerCase(),"usd");
      const v=num(j?.[sym.toLowerCase()]?.usd);
      if(v){ setCache(key,v); return v; }
    }catch{}
  }
  try{ const v=await rotate("crypto"); setCache(key,v); return v; }catch{}
  const stale=getCache(key, 24*3600*1000);
  if(stale!=null) return stale;
  throw new Error("crypto "+sym+" failed");
}

// oil/gas (scrape/json)
async function getOilGas(kind="brent"){ // brent | wti | natgas
  const key="oilgas:"+kind;
  const c=getCache(key, TTL.oilgas); if(c!=null) return c;
  try{ const v=await rotate("oilgas"); setCache(key,v); return v; }catch{}
  const stale=getCache(key, 3*24*3600*1000);
  if(stale!=null) return stale;
  throw new Error("oil/gas "+kind+" failed");
}

// forex
async function getFx(from="USD", to="EGP"){
  const key="fx:"+from+":"+to;
  const c=getCache(key, TTL.forex); if(c!=null) return c;
  try{ const v=await avFx(from,to); setCache(key,v); return v; }catch{}
  try{ const v=await rotate("forex"); setCache(key,v); return v; }catch{}
  const stale=getCache(key, 24*3600*1000);
  if(stale!=null) return stale;
  throw new Error("fx failed");
}

// ===== Routes =====
app.get("/api/health",(req,res)=>res.json({ok:true,ts:Date.now()}));

app.get("/api/gold", async (req,res)=>{
  try{ const v=await getGoldUSD(); res.json({metal:"gold",unit:"oz",usd:v}); }
  catch(e){ res.status(500).json({error:String(e.message||e)}); }
});
app.get("/api/silver", async (req,res)=>{
  try{ const v=await getSilverUSD(); res.json({metal:"silver",unit:"oz",usd:v}); }
  catch(e){ res.status(500).json({error:String(e.message||e)}); }
});
app.get("/api/metals", async (req,res)=>{
  try{
    const list=(req.query.list||Object.keys(METALS).join(",")).split(",").map(s=>s.trim()).filter(Boolean);
    const out={};
    for(const m of list){ out[m]=await getMetal(m); }
    res.json(out);
  }catch(e){ res.status(500).json({error:String(e.message||e)}); }
});
app.get("/api/crypto", async (req,res)=>{
  try{
    const list=(req.query.list||"bitcoin,ethereum").split(",").map(s=>s.trim()).filter(Boolean);
    const out={};
    for(const s of list){ out[s]=await getCrypto(s); }
    res.json(out);
  }catch(e){ res.status(500).json({error:String(e.message||e)}); }
});
app.get("/api/oilgas", async (req,res)=>{
  try{
    const kind=(req.query.kind||"brent").toLowerCase();
    const v=await getOilGas(kind);
    res.json({kind, usd:v});
  }catch(e){ res.status(500).json({error:String(e.message||e)}); }
});
app.get("/api/fx", async (req,res)=>{
  try{
    const from=(req.query.from||"USD").toUpperCase();
    const to=(req.query.to||"EGP").toUpperCase();
    const v=await getFx(from,to);
    res.json({from,to,rate:v});
  }catch(e){ res.status(500).json({error:String(e.message||e)}); }
});
app.get("/api/status",(req,res)=>res.json({statusLog}));

app.listen(PORT, ()=> console.log("Backend up on "+PORT));
