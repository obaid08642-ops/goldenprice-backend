import express from "express";
import fetch from "node-fetch";
import cheerio from "cheerio";
import { WebSocket } from "ws";
import fs from "fs";

// -------- ENV --------
const PORT = process.env.PORT || 3000;
const TWELVEDATA_KEY   = process.env.TWELVEDATA_KEY || "";
const ALPHAVANTAGE_KEY = process.env.ALPHAVANTAGE_KEY || "";
const GOLDPRICEZ_KEY   = process.env.GOLDPRICEZ_KEY || "";

// -------- UTIL --------
const sleep = (ms) => new Promise(r=>setTimeout(r,ms));
const now = ()=> Date.now();
const wday = ()=> (new Date()).getUTCDay(); // 0=Sun ... 6=Sat

// cache: key -> {t, ttl, data}
const cache = new Map();
function getCache(k){ const v = cache.get(k); return v && (now()-v.t < v.ttl) ? v.data : null; }
function setCache(k,d,ttl){ cache.set(k,{t:now(), ttl, data:d}); }

// backoff
const backoffUntil = new Map(); // name->ts
const sourceOK = (name)=> (backoffUntil.get(name)||0) < now();
const punish = (name, ms=180000)=> backoffUntil.set(name, now()+ms);

// safe fetch json/text
async function jget(url, opts={}, retries=1){
  let err;
  for(let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if(!r.ok) throw new Error("HTTP "+r.status);
      return await r.json();
    }catch(e){ err=e; if(i===retries) throw e; await sleep(300+i*500); }
  }
  throw err;
}
async function tget(url, opts={}, retries=1){
  let err;
  for(let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if(!r.ok) throw new Error("HTTP "+r.status);
      return await r.text();
    }catch(e){ err=e; if(i===retries) throw e; await sleep(300+i*500); }
  }
  throw err;
}

// -------- SITES --------
const SITES = JSON.parse(fs.readFileSync("./sites.json","utf8"));

// -------- ADAPTERS --------
async function fromYahooChart(url, tag){
  if(!sourceOK(tag)) throw new Error("backoff");
  const j = await jget(url);
  const res = j?.chart?.result?.[0];
  const v = res?.meta?.regularMarketPrice ?? res?.indicators?.quote?.[0]?.close?.slice(-1)[0];
  if(!v) { punish(tag); throw new Error("yahoo no price"); }
  return Number(v);
}
async function fromYahooClose(url, tag){
  if(!sourceOK(tag)) throw new Error("backoff");
  const j = await jget(url);
  const res = j?.chart?.result?.[0];
  const v = res?.indicators?.quote?.[0]?.close?.slice(-1)[0] ?? res?.meta?.regularMarketPrice;
  if(!v) { punish(tag); throw new Error("yahoo no close"); }
  return Number(v);
}
async function fromCheerio(url, selector, tag){
  if(!sourceOK(tag)) throw new Error("backoff");
  const html = await tget(url);
  const $ = cheerio.load(html);
  let txt = $(selector).first().text().trim().replace(/[, ]/g,"").replace(/[^\d.]/g,"");
  const v = Number(txt);
  if(!v) { punish(tag); throw new Error("css no value"); }
  return v;
}
async function fromCoinGecko(id, vs="usd", tag="cg"){
  if(!sourceOK(tag)) throw new Error("backoff");
  const j = await jget(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${vs}`);
  const v = Number(j?.[id]?.[vs]);
  if(!v){ punish(tag); throw new Error("cg no price"); }
  return v;
}

// Primary APIs
async function fromTwelve(symbol, tag){
  if(!TWELVEDATA_KEY) throw new Error("no TD key");
  if(!sourceOK(tag)) throw new Error("td backoff");
  const j = await jget(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVEDATA_KEY}`);
  const v = Number(j?.price);
  if(!v){ punish(tag); throw new Error("td no price"); }
  return v;
}
async function fromAlphaFX(from="USD", to="EGP", tag="av"){
  if(!ALPHAVANTAGE_KEY) throw new Error("no AV key");
  if(!sourceOK(tag)) throw new Error("av backoff");
  const j = await jget(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${ALPHAVANTAGE_KEY}`);
  const v = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
  if(!v){ punish(tag, 3600_000); throw new Error("av no fx"); }
  return v;
}
async function fromGoldPriceZ(metal="XAU", currency="USD", tag="gpz"){
  if(!GOLDPRICEZ_KEY) throw new Error("no GPZ key");
  if(!sourceOK(tag)) throw new Error("gpz backoff");
  const j = await jget(`https://www.goldpricez.com/api/rates/${metal}/${currency}/gram?api_key=${GOLDPRICEZ_KEY}`);
  const g = Number(j?.price_gram_24k);
  if(!g){ punish(tag); throw new Error("gpz no gram"); }
  return g * 31.1034768; // gram -> troy oz
}

// -------- SYMBOL MAPS --------
const METAL_UNITS = {
  gold: "oz", silver: "oz", platinum: "oz", palladium:"oz",
  copper:"lb", aluminum:"t", nickel:"t", zinc:"t", lead:"t", tin:"t",
  iron:"t", steel:"t", cobalt:"t", lithium:"t", uranium:"lb"
};

// TwelveData symbols (where available)
const TD_SYMBOLS = {
  gold:"XAU/USD", silver:"XAG/USD", platinum:"XPT/USD", palladium:"XPD/USD"
};

// Yahoo fallback tickers
const Y_TICK = {
  gold:"XAUUSD=X", silver:"XAGUSD=X", platinum:"XPTUSD=X", palladium:"XPDUSD=X",
  copper:"HG=F", aluminum:"ALI=F", nickel:"NID=F", zinc:"MZN=F", lead:"LD=F", tin:"TIN=F",
  iron:"IRN=F", steel:"HRC=F"
};

// -------- SCHEDULER LADDERS --------
const TTL = {
  goldsilver: 5*60*1000,     // 5m cache
  crypto:     10*1000,       // 10s cache
  forex:      60*60*1000,    // 1h
  oilgas:     12*60*60*1000, // 12h
  metals:     24*60*60*1000  // 24h
};

// “shouldPauseGoldHours”: عطلة نهاية الأسبوع (السبت=6 والأحد=0) نوقف الذهب/الفضة
const shouldPauseGoldHours = ()=> (wday()===6 || wday()===0);

// Resolver by site entry
async function resolveSite(entry){
  const tag = (entry.name||entry.type||"src")+":"+ (entry.url||entry.id||"");
  switch(entry.type){
    case "yahooChart": return await fromYahooChart(entry.url, tag);
    case "yahooClose": return await fromYahooClose(entry.url, tag);
    case "cheerioText": return await fromCheerio(entry.url, entry.selector, tag);
    case "coingecko": return await fromCoinGecko(entry.id, "usd", tag);
    default: throw new Error("unknown site type: "+entry.type);
  }
}

// Meta resolvers
async function getGoldUSD(){
  const key = "metal:gold";
  const c = getCache(key); if(c) return c;
  // Primary A: TwelveData -> GoldPriceZ
  try{ if(TWELVEDATA_KEY) { const v = await fromTwelve(TD_SYMBOLS.gold,"td:xau"); setCache(key,{price:v,unit:"oz",src:"TD"}, TTL.goldsilver); return getCache(key); } }catch{}
  try{ if(GOLDPRICEZ_KEY){ const v = await fromGoldPriceZ("XAU","USD","gpz:xau"); setCache(key,{price:v,unit:"oz",src:"GPZ"}, TTL.goldsilver); return getCache(key);} }catch{}
  // B: sites
  for(const e of SITES.gold){ try{ const v = await resolveSite(e); setCache(key,{price:v,unit:"oz",src:e.name}, TTL.goldsilver); return getCache(key);}catch{} }
  throw new Error("gold failed");
}
async function getSilverUSD(){
  const key = "metal:silver";
  const c = getCache(key); if(c) return c;
  try{ if(TWELVEDATA_KEY) { const v = await fromTwelve(TD_SYMBOLS.silver,"td:xag"); setCache(key,{price:v,unit:"oz",src:"TD"}, TTL.goldsilver); return getCache(key); } }catch{}
  try{ if(GOLDPRICEZ_KEY){ const v = await fromGoldPriceZ("XAG","USD","gpz:xag"); setCache(key,{price:v,unit:"oz",src:"GPZ"}, TTL.goldsilver); return getCache(key);} }catch{}
  for(const e of SITES.silver){ try{ const v = await resolveSite(e); setCache(key,{price:v,unit:"oz",src:e.name}, TTL.goldsilver); return getCache(key);}catch{} }
  throw new Error("silver failed");
}
async function getIndustrialMetalUSD(name){
  const key = "metal:"+name;
  const c = getCache(key); if(c) return c;
  // A) TwelveData (لو متاح)
  if(TD_SYMBOLS[name]){
    try{ const v = await fromTwelve(TD_SYMBOLS[name], "td:"+name); setCache(key,{price:v,unit:METAL_UNITS[name]||"t",src:"TD"}, TTL.metals); return getCache(key);}catch{}
  }
  // B) Yahoo tickers
  if(Y_TICK[name]){
    try{ const v = await fromYahooChart(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(Y_TICK[name])}`, "y:"+name); setCache(key,{price:v,unit:METAL_UNITS[name]||"t",src:"Yahoo"}, TTL.metals); return getCache(key);}catch{}
  }
  // C) Sites.json specific list
  const arr = (SITES.metals && SITES.metals[name]) || [];
  for(const e of arr){ try{ const v = await resolveSite(e); setCache(key,{price:v,unit:METAL_UNITS[name]||"t",src:e.name}, TTL.metals); return getCache(key);}catch{} }
  throw new Error(name+" failed");
}

// FX
async function getFX(from="USD", to="EGP"){
  const key = `fx:${from}:${to}`;
  const c = getCache(key); if(c) return c;
  try{ const v = await fromAlphaFX(from,to,"av"); setCache(key,{rate:v,src:"AlphaVantage"}, TTL.forex); return getCache(key);}catch{}
  // Yahoo fallback
  try{ const v = await fromYahooChart(`https://query1.finance.yahoo.com/v8/finance/chart/${from}${to}=X`, "y:fx"); setCache(key,{rate:v,src:"Yahoo"}, TTL.forex); return getCache(key);}catch{}
  throw new Error("fx failed");
}

// Oil & Gas
async function getOilUSD(){
  const key="oil:wti"; const c=getCache(key); if(c) return c;
  for(const e of SITES.oil){ try{ const v=await resolveSite(e); setCache(key,{price:v,src:e.name}, TTL.oilgas); return getCache(key);}catch{} }
  throw new Error("oil failed");
}
async function getGasUSD(){
  const key="gas:natgas"; const c=getCache(key); if(c) return c;
  for(const e of SITES.gas){ try{ const v=await resolveSite(e); setCache(key,{price:v,src:e.name}, TTL.oilgas); return getCache(key);}catch{} }
  throw new Error("gas failed");
}

// Crypto (Binance WS + fallbacks)
const wsPrices = new Map();
function startBinanceWS(pairs=["btcusdt","ethusdt","solusdt","xrpusdt"]){
  try{
    const streams = pairs.map(p=>`${p}@ticker`).join('/');
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    ws.on("message",(buf)=>{
      try{ const j=JSON.parse(buf.toString()); const d=j?.data; if(d?.s && d?.c) wsPrices.set(d.s, Number(d.c)); }catch{}
    });
    ws.on("close", ()=> setTimeout(()=>startBinanceWS(pairs), 3000));
    ws.on("error", ()=> ws.close());
  }catch{}
}
startBinanceWS();

async function getCryptoUSDT(sym="BTC"){
  const key = `crypto:${sym}`;
  const c = getCache(key); if(c) return c;

  const wsv = wsPrices.get(`${sym.toUpperCase()}USDT`);
  if(wsv){ setCache(key,{price:wsv,src:"BinanceWS"}, TTL.crypto); return getCache(key); }

  // CoinGecko
  try{ const v = await fromCoinGecko(sym.toLowerCase(),"usd","cg"); setCache(key,{price:v,src:"CoinGecko"}, TTL.crypto); return getCache(key);}catch{}
  // Yahoo as extra fallback
  try{ const v = await fromYahooChart(`https://query1.finance.yahoo.com/v8/finance/chart/${sym.toUpperCase()}-USD`, "y:crypto"); setCache(key,{price:v,src:"Yahoo"}, TTL.crypto); return getCache(key);}catch{}
  throw new Error("crypto failed");
}

// -------- SCHEDULERS --------
// Gold/Silver every 3.5 minutes (pause on weekend)
setInterval(async ()=>{
  if(shouldPauseGoldHours()) return;
  try{ await getGoldUSD(); }catch{}
  try{ await getSilverUSD(); }catch{}
}, 210000); // 3m30s

// Crypto every 2s (WS already pushes; this ensures cache kept warm)
setInterval(async ()=>{
  try{ await getCryptoUSDT("BTC"); await getCryptoUSDT("ETH"); }catch{}
}, 2000);

// Forex every hour (example USD->EGP)
setInterval(async ()=>{
  try{ await getFX("USD","EGP"); }catch{}
}, 60*60*1000);

// Oil/Gas every 12h
setInterval(async ()=>{ try{ await getOilUSD(); }catch{} }, 12*60*60*1000);
setInterval(async ()=>{ try{ await getGasUSD(); }catch{} }, 12*60*60*1000);

// Industrial metals every 24h
const INDUSTRIAL = ["platinum","palladium","copper","aluminum","nickel","zinc","lead","tin","iron","steel","cobalt","lithium","uranium"];
setInterval(async ()=>{
  for(const m of INDUSTRIAL){ try{ await getIndustrialMetalUSD(m); }catch{} await sleep(400); }
}, 24*60*60*1000);

// -------- HTTP --------
const app = express();

app.get("/api/health", (req,res)=> res.json({ ok:true, ts: Date.now() }));

app.get("/api/metals", async (req,res)=>{
  try{
    const listRaw = (req.query.list || "gold,silver").split(",").map(s=>s.trim()).filter(Boolean);
    const out = {};
    for(const m of listRaw){
      if(m==="gold") out.gold = await getGoldUSD();
      else if(m==="silver") out.silver = await getSilverUSD();
      else if(INDUSTRIAL.includes(m)) out[m] = await getIndustrialMetalUSD(m);
    }
    res.json(out);
  }catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});

app.get("/api/crypto", async (req,res)=>{
  try{
    const list=(req.query.list||"BTC,ETH").split(",").map(s=>s.trim()).filter(Boolean);
    const out={};
    for(const s of list){ out[s]=await getCryptoUSDT(s); }
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

app.get("/api/oil", async (req,res)=>{
  try{ res.json(await getOilUSD()); }
  catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});
app.get("/api/gas", async (req,res)=>{
  try{ res.json(await getGasUSD()); }
  catch(e){ res.status(500).json({ error: String(e.message||e) }); }
});

app.listen(PORT, ()=> console.log("Hybrid backend running on port "+PORT));
