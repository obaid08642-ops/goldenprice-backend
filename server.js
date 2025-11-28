// server.js - consolidated and fixed version
import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import cors from "cors";
import WebSocket from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, "cache.json");
const SITES_FILE = path.join(__dirname, "sites.json");

const PORT = Number(process.env.PORT || 10000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "ADMIN_12345";
const TWELVEDATA_KEY = process.env.TWELVEDATA_KEY || "";
const ALPHAVANTAGE_KEY = process.env.ALPHAVANTAGE_KEY || "";
const EXR_HOST = process.env.EXR_HOST || "https://api.exchangerate.host";

// metals.dev keys (use two keys as you provided)
const METALS_DEV_KEY1 = process.env.METALS_DEV_KEY1 || process.env.METALS_DEV_API_KEY || "";
const METALS_DEV_KEY2 = process.env.METALS_DEV_KEY2 || "";
// map which metals use which key (customize below)
const METALS_DEV_KEY_MAP = {
  zinc: METALS_DEV_KEY1,
  aluminum: METALS_DEV_KEY1,
  copper: METALS_DEV_KEY1,
  lead: METALS_DEV_KEY2,
  nickel: METALS_DEV_KEY2,
  platinum: METALS_DEV_KEY2,
  palladium: METALS_DEV_KEY2,
  // others: use default METALS_DEV_KEY1 if available
};

const SLX_BSC_TOKEN = process.env.SLX_BSC_TOKEN || "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d";
const SLX_PAIR_ADDRESS = process.env.SLX_PAIR_ADDRESS || "0x7c755e961a8d415c4074bc7d3ba0b85f039c5168";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "x-admin-token"] }));
app.options("*", cors());
app.use(express.static(__dirname));

let cache = { prices: {}, lastUpdate: {}, rotate: { gold: 0, silver: 0, crypto: 0, fx: 0, slxLoop: 0, silverLoop: 0, metalsLoop: {} }, history: {} };

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const j = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
      cache = { ...cache, ...j };
      cache.rotate = cache.rotate || {};
      cache.rotate.metalsLoop = cache.rotate.metalsLoop || {};
      cache.history = cache.history || {};
    }
  } catch (e) {
    console.error("loadCache error", e.message);
  }
}
function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error("saveCache error", e.message);
  }
}
loadCache();

// default sites.json (will be overridden by sites.json if present)
let SITES = {
  gold: ["twelvedata:XAU/USD","yahoo:XAUUSD=X","kitco:gold","thestreetgold:gold"],
  silver: ["twelvedata:XAG/USD","yahoo:XAGUSD=X","kitco:silver"],
  crypto: ["binancews:BTCUSDT,ETHUSDT","coingecko:bitcoin,ethereum","coincap:bitcoin,ethereum","dexscreener:SLX"],
  fx: ["exchangeratehost:USD,EGP","frankfurter:USD,EGP","alphavantage:USD,EGP"],
  energy: { wti: ["alphavantage:WTI","yahoo:CL=F"], brent: ["alphavantage:BRENT","yahoo:BRN=F"], natgas: ["alphavantage:NATGAS","yahoo:NG=F"] }
};

try {
  if (fs.existsSync(SITES_FILE)) {
    const j = JSON.parse(fs.readFileSync(SITES_FILE, "utf-8"));
    SITES = { ...SITES, ...j };
  }
} catch (e) {
  console.error("load sites.json error", e.message);
}

// helpers
const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isValidNumber(n) {
  if (n === null || n === undefined) return false;
  const num = Number(n);
  if (!Number.isFinite(num)) return false;
  if (num <= 0) return false;
  if (num > 1e9) return false;
  return true;
}
function todayISO() { return new Date().toISOString().slice(0,10); }

// store price + daily history (one entry per day, keep 30)
function put(symbol, price, unit="usd", src="unknown") {
  if (!isValidNumber(price)) return;
  const num = Number(price);
  cache.prices[symbol] = { price: num, unit, src, t: now() };
  cache.history = cache.history || {};
  const hist = cache.history[symbol] || [];
  const today = todayISO();
  if (!hist.length || hist[hist.length-1].date !== today) {
    hist.push({ date: today, value: num });
    const MAX = 30;
    if (hist.length > MAX) hist.splice(0, hist.length - MAX);
    cache.history[symbol] = hist;
  } else {
    hist[hist.length-1].value = num;
    cache.history[symbol] = hist;
  }
  saveCache();
}
function get(symbol) { return cache.prices[symbol] || null; }

// fetch helpers
async function getJSON(url, opts={}, retries=1) {
  let last;
  for (let i=0;i<=retries;i++){
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch(e){ last=e; await sleep(200); }
  }
  throw last;
}
async function getText(url, opts={}, retries=1) {
  let last;
  for (let i=0;i<=retries;i++){
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch(e){ last=e; await sleep(200); }
  }
  throw last;
}

// Utility: try array of selectors and parse float from matched text
function extractNumberFromText(txt) {
  if (!txt || typeof txt !== "string") return null;
  // remove commas, currency symbols, extra spaces
  const cleaned = txt.replace(/[,٬]/g,"").replace(/[^\d.\-]/g," ").trim();
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const v = Number(match[0]);
  if (!Number.isFinite(v)) return null;
  return v;
}
async function scrapeSelectors(url, selectors=[]) {
  const html = await getText(url, {}, 1);
  const $ = cheerio.load(html);
  for (const sel of selectors) {
    try {
      const el = $(sel).first();
      if (el && el.length) {
        const txt = el.text();
        const v = extractNumberFromText(txt);
        if (v && isValidNumber(v)) return v;
      }
    } catch(e){}
  }
  // fallback: parse body text but only if nothing else matched
  const body = $("body").text();
  const v = extractNumberFromText(body);
  if (v && isValidNumber(v)) return v;
  throw new Error("no-price-found");
}

// ---------- Specific site parsers (selectors tuned) ----------
async function fromInvesting(metal) {
  // Investing pages vary; try known selectors
  const url = `https://www.investing.com/commodities/${encodeURIComponent(metal)}`;
  const selectors = [
    "span.instrument-price_last", // common class
    "div.instrument-price__info .text-2xl",
    "span#last_last",
    ".top bold, .instrument-price__quote .inline", 
    ".instrument-price .bidAsk"
  ];
  return await scrapeSelectors(url, selectors);
}
async function fromMarketWatchFuture(ticker) {
  const url = `https://www.marketwatch.com/investing/future/${encodeURIComponent(ticker)}`;
  const selectors = ["bg-quote.value","h2.small",".intraday__price .value"];
  return await scrapeSelectors(url, selectors);
}
async function fromTradingEconomicsCommodity(metal) {
  const url = `https://tradingeconomics.com/commodity/${encodeURIComponent(metal)}`;
  const selectors = [".table-price .value",".price .value",".small .value"];
  return await scrapeSelectors(url, selectors);
}
async function fromFXNewsToday(metal) {
  const url = `https://fxnewstoday.com/?s=${encodeURIComponent(metal)}`;
  const selectors = [".entry-content","article .price",".price"];
  return await scrapeSelectors(url, selectors);
}
async function fromDailyForexSearch(metal) {
  const url = `https://www.dailyforex.com/search?search=${encodeURIComponent(metal)}`;
  const selectors = [".search-results",".price",".quote"];
  return await scrapeSelectors(url, selectors);
}
async function fromGoldMaker(metal) {
  const url = `https://goldmaker.fr/?s=${encodeURIComponent(metal)}`;
  return await scrapeSelectors(url, ["article .entry-content", ".price"]);
}
async function fromBloombergSearch(q){
  const url = `https://www.bloomberg.com/search?query=${encodeURIComponent(q)}`;
  return await scrapeSelectors(url, [".search-result__headline",".price"]);
}
async function fromKitcoExact(metal){
  // kitco specific pages for metals
  const slug = metal === "silver" ? "silver-price-today-usa" : (metal === "gold" ? "gold-price-today-usa" : "");
  const url = slug ? `https://www.kitco.com/${slug}.html` : `https://www.kitco.com/`;
  const selectors = ["#sp-bid",".ltspan", ".price"];
  return await scrapeSelectors(url, selectors);
}

// ---------- wrappers used by loops ----------
async function fromSaudiGoldSilver() { return await scrapeSelectors("https://saudigoldprice.com/silverprice/", ["#silverPrice",".priceTable td"]); }
async function fromInvestingSilver() { return await fromInvesting("silver"); }
async function fromMarketWatchSilver() { return await fromMarketWatchFuture("silver"); }
async function fromTradingEconomicsSilver() { return await fromTradingEconomicsCommodity("silver"); }

// ---------- API-specific metals.dev caller (support per-metal key) ----------
async function fromMetalsDevAPI(metal) {
  const key = METALS_DEV_KEY_MAP[metal] || METALS_DEV_KEY1 || METALS_DEV_KEY2;
  if (!key) throw new Error("no metals.dev key");
  const url = `https://api.metals.dev/v1/metal/spot?api_key=${encodeURIComponent(key)}&metal=${encodeURIComponent(metal)}&currency=USD`;
  const j = await getJSON(url, {}, 1);
  const price = Number(j?.rate?.price || j?.rate?.ask || j?.rate?.bid);
  if (!price) throw new Error("metals.dev no price");
  return price;
}

// ---------- coin helpers ----------
async function fromCoinGecko(ids) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
  const j = await getJSON(url);
  const out = {};
  ids.split(",").forEach(id => { const v = Number(j?.[id]?.usd); if (v) out[id.toUpperCase()] = v; });
  if (!Object.keys(out).length) throw new Error("CG no prices");
  return out;
}
async function fromCoinCap(id) {
  const j = await getJSON(`https://api.coincap.io/v2/assets/${id}`);
  const v = Number(j?.data?.priceUsd);
  if (!v) throw new Error("CoinCap no price");
  return v;
}
async function fromDexScreenerByToken(token) {
  const j = await getJSON(`https://api.dexscreener.com/latest/dex/search?q=${token}`);
  const pair = j?.pairs?.[0];
  const v = Number(pair?.priceUsd);
  if (!v) throw new Error("DexScreener no price");
  return v;
}
async function fromDexScreenerByPair(pairAddress) {
  const url = `https://api.dexscreener.com/latest/dex/pairs/bsc/${pairAddress.toLowerCase()}`;
  const j = await getJSON(url);
  const pair = j?.pairs?.[0];
  const v = Number(pair?.priceUsd);
  if (!v) throw new Error("DexScreener pair no price");
  return v;
}
async function fromGeckoTerminal(tokenAddress) {
  const url = `https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${tokenAddress.toLowerCase()}`;
  const j = await getJSON(url, {}, 1);
  const v = Number(j?.data?.attributes?.price_usd);
  if (!v) throw new Error("GeckoTerminal no price");
  return v;
}

// ---------- FX / Alpha wrappers ----------
async function fromExchangeRateHost(base, quote){ const j = await getJSON(`${EXR_HOST}/convert?from=${base}&to=${quote}`); return Number(j?.result); }
async function fromFrankfurter(base, quote){ const j = await getJSON(`https://api.frankfurter.app/latest?from=${base}&to=${quote}`); return Number(j?.rates?.[quote]); }
async function fromAlphaFX(base, quote){ if(!ALPHAVANTAGE_KEY) throw new Error("no ALPHA key"); const j = await getJSON(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${base}&to_currency=${quote}&apikey=${ALPHAVANTAGE_KEY}`); return Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]); }
async function fromAlphaEnergy(sym){ if(!ALPHAVANTAGE_KEY) throw new Error("no ALPHA key"); const j = await getJSON(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${ALPHAVANTAGE_KEY}`); return Number(j?.["Global Quote"]?.["05. price"]); }

// ---------- SLX loop ----------
const SLX_SOURCES = [
  { name: "geckoterminal", fn: async()=>await fromGeckoTerminal(SLX_BSC_TOKEN) },
  { name: "dex_pair", fn: async()=>await fromDexScreenerByPair(SLX_PAIR_ADDRESS) },
  { name: "dex_token", fn: async()=>await fromDexScreenerByToken(SLX_BSC_TOKEN) },
  { name: "coincap", fn: async()=>await fromCoinCap("silverx") }
];
async function updateSLXOnce(){
  const start = cache.rotate.slxLoop||0;
  for(let i=0;i<SLX_SOURCES.length;i++){
    const idx=(start+i)%SLX_SOURCES.length;
    try{
      const p = await SLX_SOURCES[idx].fn();
      if(isValidNumber(p)){ put("SLX",p,"usd",SLX_SOURCES[idx].name); cache.lastUpdate.slx=now(); cache.rotate.slxLoop=(idx+1)%SLX_SOURCES.length; saveCache(); return; }
    }catch(e){}
  }
}
function startSLXLoop(){ updateSLXOnce().catch(()=>{}); setInterval(()=>updateSLXOnce().catch(()=>{}),5*60*1000); }

// ---------- Silver loop (rotate scrapers, then metals.dev if present) ----------
const SILVER_LIST = [
  { name:"saudigold", fn: fromSaudiGoldSilver },
  { name:"investing", fn: fromInvestingSilver },
  { name:"marketwatch", fn: fromMarketWatchSilver },
  { name:"tradingeconomics", fn: fromTradingEconomicsSilver },
  { name:"kitco", fn: async()=>await fromKitcoExact("silver") },
  { name:"metalsdev", fn: async()=>await fromMetalsDevAPI("silver") }
];
async function updateSilverScrapeOnce(){
  const idx=cache.rotate.silverLoop||0;
  for(let i=0;i<SILVER_LIST.length;i++){
    const pick=(idx+i)%SILVER_LIST.length;
    try{ const p = await SILVER_LIST[pick].fn(); if(isValidNumber(p)){ put("SILVER",p,"usd",`scrape:${SILVER_LIST[pick].name}`); cache.lastUpdate.silver=now(); cache.rotate.silverLoop=(pick+1)%SILVER_LIST.length; saveCache(); return; } }catch(e){}
  }
}
function startSilverLoop(){ updateSilverScrapeOnce().catch(()=>{}); setInterval(()=>updateSilverScrapeOnce().catch(()=>{}),40*60*1000); }

// ---------- metals loop builder ----------
const METALS_TO_LOOP = Object.keys(SITES.metals || {});
function buildSourcesForMetal(metalKey){
  const cfg = (SITES.metals && SITES.metals[metalKey.toLowerCase()]) || [];
  const out = [];
  for(const s of cfg){
    if(typeof s !== "string") continue;
    if(s==="metalsdev") out.push({name:"metalsdev", fn: async()=>await fromMetalsDevAPI(metalKey.toLowerCase())});
    else if(s.startsWith("yahoo:")) out.push({name:"yahoo", fn: async()=>await fromYahoo(s.split(":")[1])});
    else if(s.startsWith("twelvedata:")) out.push({name:"twelvedata", fn: async()=>await fromTwelveData(s.split(":")[1])});
    else if(s.startsWith("scrape:")){
      const parts = s.split(":"); const site = parts[1]; const m = parts[2] || metalKey.toLowerCase();
      if(site==="investing") out.push({name:`scrape:investing`, fn: async()=>await fromInvesting(m)});
      else if(site==="tradingeconomics") out.push({name:`scrape:tradingeconomics`, fn: async()=>await fromTradingEconomicsCommodity(m)});
      else if(site==="fxnewstoday") out.push({name:`scrape:fxnewstoday`, fn: async()=>await fromFXNewsToday(m)});
      else if(site==="dailyforex") out.push({name:`scrape:dailyforex`, fn: async()=>await fromDailyForexSearch(m)});
      else if(site==="goldmaker") out.push({name:`scrape:goldmaker`, fn: async()=>await fromGoldMaker(m)});
      else out.push({name:`scrape:${site}`, fn: async()=>await scrapeSelectors(`https://${site}.com/search?q=${encodeURIComponent(m)}`, [".price",".value",".entry-content"])});
    } else if(s.startsWith("scrape-raw:")) {
      // custom raw url e.g. scrape-raw:https://...|selector
      try{
        const rest = s.split(":")[1];
        const [url, selector] = rest.split("|");
        out.push({name:`raw`, fn: async()=>await scrapeSelectors(url, [selector||".price"])});
      }catch(e){}
    }
  }
  // fallback if empty: try metalsdev -> yahoo
  if(!out.length){
    if(METALS_DEV_KEY1 || METALS_DEV_KEY2) out.push({name:"metalsdev", fn: async()=>await fromMetalsDevAPI(metalKey.toLowerCase())});
    out.push({name:"yahoo", fn: async()=>await fromYahoo(metalKey.toUpperCase())});
  }
  return out;
}

async function updateMetalOnce(metalKey){
  const list = buildSourcesForMetal(metalKey);
  if(!list.length) return;
  cache.rotate.metalsLoop = cache.rotate.metalsLoop||{};
  const idx = cache.rotate.metalsLoop[metalKey]||0;
  for(let i=0;i<list.length;i++){
    const pick=(idx+i)%list.length;
    try{
      const p = await list[pick].fn();
      if(isValidNumber(p)){ put(metalKey.toUpperCase(),p,"usd",`loop:${list[pick].name}`); cache.lastUpdate[metalKey]=now(); cache.rotate.metalsLoop[metalKey]=(pick+1)%list.length; saveCache(); return; }
    }catch(e){}
  }
}

function startMetalsLoops(){
  for(const metal of METALS_TO_LOOP){
    updateMetalOnce(metal).catch(()=>{});
    setInterval(()=>updateMetalOnce(metal).catch(()=>{}), 60*60*1000); // 1 hour
  }
}

// ---------- existing updates (gold/silver/crypto/fx/energy) ----------
async function fromTwelveData(pair){ if(!TWELVEDATA_KEY) throw new Error("no TD key"); const j = await getJSON(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(pair)}&apikey=${TWELVEDATA_KEY}`); const v=Number(j?.price); if(!v) throw new Error("TD no price"); return v; }
async function fromYahoo(ticker){ const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?region=US&lang=en-US`); const v = j?.chart?.result?.[0]?.meta?.regularMarketPrice; if(!v) throw new Error("Yahoo no price"); return Number(v); }
async function fromKitco(metal){ return await fromKitcoExact(metal); }

async function updateGold(){ let src = (SITES.gold||[])[cache.rotate.gold%(SITES.gold||[]).length]; if(!src) return; try{ let price=null, unit="oz"; if(src.startsWith("twelvedata:")) price=await fromTwelveData(src.split(":")[1]); else if(src.startsWith("yahoo:")) price=await fromYahoo(src.split(":")[1]); else if(src.startsWith("kitco:")) price=await fromKitco("gold"); else price=await scrapeSelectors("https://www.thestreet.com/quote/gold-price",["*[data-test='last-price']"]); if(price){ put("GOLD",price,unit,src); cache.lastUpdate.gold=now(); saveCache(); } }catch(e){} cache.rotate.gold=(cache.rotate.gold||0)+1; }
async function updateSilver(){ let src = (SITES.silver||[])[cache.rotate.silver%(SITES.silver||[]).length]; if(!src) return; try{ let price=null, unit="oz"; if(src.startsWith("twelvedata:")) price=await fromTwelveData(src.split(":")[1]); else if(src.startsWith("yahoo:")) price=await fromYahoo(src.split(":")[1]); else if(src.startsWith("kitco:")) price=await fromKitco("silver"); if(price){ put("SILVER",price,unit,src); cache.lastUpdate.silver=now(); saveCache(); } }catch(e){} cache.rotate.silver=(cache.rotate.silver||0)+1; }
async function updateCrypto(){ let src = (SITES.crypto||[])[cache.rotate.crypto%(SITES.crypto||[]).length]; if(!src) return; try{ if(src.startsWith("binancews:")){ const btc = wsPrices.get("BTCUSDT"); const eth = wsPrices.get("ETHUSDT"); if(btc) put("BTC",btc,"usd","binancews"); if(eth) put("ETH",eth,"usd","binancews"); } else if(src.startsWith("coingecko:")){ const ids = src.split(":")[1]; const j = await fromCoinGecko(ids); if(j.BITCOIN) put("BTC",j.BITCOIN,"usd","coingecko"); if(j.ETHEREUM) put("ETH",j.ETHEREUM,"usd","coingecko"); } else if(src.startsWith("coincap:")){ const v1=await fromCoinCap("bitcoin"); put("BTC",v1,"usd","coincap"); const v2=await fromCoinCap("ethereum"); put("ETH",v2,"usd","coincap"); } else if(src.startsWith("dexscreener:")){ const v=await fromDexScreenerByToken(SLX_BSC_TOKEN); put("SLX",v,"usd","dexscreener"); } cache.lastUpdate.crypto=now(); saveCache(); }catch(e){} cache.rotate.crypto=(cache.rotate.crypto||0)+1; }

async function updateFX(base="USD",quote="EGP"){ let src = (SITES.fx||[])[cache.rotate.fx%(SITES.fx||[]).length]; if(!src) return; try{ if(src.startsWith("exchangeratehost:")){ const v = await fromExchangeRateHost(base,quote); if(isValidNumber(v)) put(`FX_${base}_${quote}`,v,"rate","ERH"); } else if(src.startsWith("frankfurter:")){ const v = await fromFrankfurter(base,quote); if(isValidNumber(v)) put(`FX_${base}_${quote}`,v,"rate","Frankfurter"); } else if(src.startsWith("alphavantage:")){ const v = await fromAlphaFX(base,quote); if(isValidNumber(v)) put(`FX_${base}_${quote}`,v,"rate","AlphaVantage"); } cache.lastUpdate.fx=now(); saveCache(); }catch(e){} cache.rotate.fx=(cache.rotate.fx||0)+1; }

async function updateEnergy(){ const e = SITES.energy||{}; for(const [name,sources] of Object.entries(e)){ for(const src of sources){ try{ let v=null; if(src.startsWith("alphavantage:")) v = await fromAlphaEnergy(src.split(":")[1]); else if(src.startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]); if(v){ put(name.toUpperCase(),v,"usd",src); break; } }catch(e){} } } cache.lastUpdate.energy=now(); saveCache(); }

// ---------- schedules and loops ----------
const wsPrices = new Map();
function startBinanceWS(symbols=["btcusdt","ethusdt"]){
  try{
    const streams = symbols.map(s=>`${s}@ticker`).join("/");
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    ws.on("message",(buf)=>{ try{ const j=JSON.parse(buf.toString()); const d=j?.data; if(d?.s && d?.c) wsPrices.set(d.s, Number(d.c)); }catch(e){} });
    ws.on("close",()=>setTimeout(()=>startBinanceWS(symbols),3000));
    ws.on("error",()=>ws.close());
  }catch(e){ console.error("WS error", e.message); }
}
startBinanceWS();

setInterval(()=>{ updateGold(); updateSilver(); updateCrypto(); }, 210*1000);
setInterval(()=>updateFX("USD","EGP"), 2*60*60*1000);
setInterval(()=>updateEnergy(), 5*60*60*1000);

startSLXLoop();
startSilverLoop();
startMetalsLoops();

updateGold(); updateSilver(); updateCrypto(); updateFX("USD","EGP"); updateEnergy();

// ---------- history / chart / change endpoints ----------
app.get("/api/history/:symbol", (req,res)=>{
  const symbol = String(req.params.symbol||"").toUpperCase();
  const hist = cache.history && cache.history[symbol] ? cache.history[symbol] : [];
  res.json({ symbol, history: hist });
});
app.get("/api/chart/:symbol", (req,res)=>{
  const symbol = String(req.params.symbol||"").toUpperCase();
  const days = Math.min(90, Number(req.query.days||30));
  const hist = (cache.history && cache.history[symbol]) || [];
  res.json({ symbol, data: hist.slice(-days) });
});
app.get("/api/change/:symbol", (req,res)=>{
  const symbol = String(req.params.symbol||"").toUpperCase();
  const period = req.query.period || "24h";
  const hist = (cache.history && cache.history[symbol]) || [];
  if(!hist.length) return res.json({ symbol, change_percent: 0 });
  if(period.endsWith("h")){
    const hrs = Number(period.slice(0,-1));
    if(hrs <= 24){
      if(hist.length < 2) return res.json({ symbol, change_percent: 0 });
      const last = hist[hist.length-1].value;
      const prev = hist[hist.length-2].value;
      const change = ((last - prev)/prev)*100;
      return res.json({ symbol, change_percent: Number(change.toFixed(4)) });
    } else {
      const daysBack = Math.round(hrs/24);
      const idx = Math.max(0, hist.length-1-daysBack);
      const last = hist[hist.length-1].value;
      const prev = hist[idx].value;
      const change = ((last - prev)/prev)*100;
      return res.json({ symbol, change_percent: Number(change.toFixed(4)) });
    }
  } else if(period.endsWith("d")){
    const days = Number(period.slice(0,-1));
    const idx = Math.max(0, hist.length-1-days);
    const last = hist[hist.length-1].value;
    const prev = hist[idx].value;
    const change = ((last - prev)/prev)*100;
    return res.json({ symbol, change_percent: Number(change.toFixed(4)) });
  } else return res.json({ symbol, change_percent: 0 });
});

// ---------- existing APIs ----------
app.get("/api/health",(req,res)=>res.json({ok:true,ts:Date.now(),lastUpdate:cache.lastUpdate}));
app.get("/api/status",(req,res)=>res.json({ok:true,ts:Date.now(),lastUpdate:cache.lastUpdate}));

app.get("/api/gold",(req,res)=>{ const v=get("GOLD"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });
app.get("/api/silver",(req,res)=>{ const v=get("SILVER"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });
app.get("/api/crypto",(req,res)=>{ const list=(req.query.list||"BTC,ETH,SLX").split(",").map(s=>s.trim().toUpperCase()); const out={}; for(const s of list){ out[s]=get(s)||{error:"Not found"} } res.json(out); });
app.get("/api/crypto/bitcoin",(req,res)=>{ const v=get("BTC"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });
app.get("/api/crypto/ethereum",(req,res)=>{ const v=get("ETH"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });
app.get("/api/crypto/silverx",(req,res)=>{ const v=get("SLX"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });

app.get("/api/fx",(req,res)=>{ const from=(req.query.from||"USD").toUpperCase(); const to=(req.query.to||"EGP").toUpperCase(); const v=get(`FX_${from}_${to}`); if(!v) return res.status(404).json({error:"Not found"}); res.json({from,to,...v}); });

app.get("/api/metals",(req,res)=>{ const list=(req.query.list||Object.keys(SITES.metals).join(",")).split(",").map(s=>s.trim().toUpperCase()); const out={}; for(const m of list){ out[m]=get(m)||{error:"Not found"} } res.json(out); });
app.get("/api/metals/:metal",(req,res)=>{ const metal=String(req.params.metal||"").toUpperCase(); const v=get(metal); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });

app.get("/api/energy",(req,res)=>{ const list=(req.query.list||"wti,brent,natgas").split(",").map(s=>s.trim().toUpperCase()); const out={}; for(const n of list){ out[n]=get(n)||{error:"Not found"} } res.json(out); });
app.get("/api/oilgas/wti",(req,res)=>{ const v=get("WTI"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });
app.get("/api/oilgas/brent",(req,res)=>{ const v=get("BRENT"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });
app.get("/api/oilgas/gas",(req,res)=>{ const v=get("NATGAS"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });

// admin
function okAdmin(req){ const t = req.headers["x-admin-token"] || req.query.token || req.body?.token; return String(t) === String(ADMIN_TOKEN); }
app.get("/api/cache",(req,res)=>{ if(!okAdmin(req)) return res.status(401).json({error:"unauthorized"}); res.json({prices:cache.prices,lastUpdate:cache.lastUpdate,historyKeys:Object.keys(cache.history||{})}); });
app.post("/api/admin/set",(req,res)=>{ if(!okAdmin(req)) return res.status(401).json({error:"unauthorized"}); const {symbol,price,unit="usd"} = req.body||{}; if(!symbol||!price) return res.status(400).json({error:"symbol and price required"}); put(String(symbol).toUpperCase(),Number(price),unit,"manual"); res.json({ok:true,saved:cache.prices[String(symbol).toUpperCase()]}); });
app.post("/api/admin/refresh",(req,res)=>{ if(!okAdmin(req)) return res.status(401).json({error:"unauthorized"}); const what=String(req.body?.what||"all").toLowerCase(); const tasks=[]; if(what==="all"||what==="gold") tasks.push(updateGold()); if(what==="all"||what==="silver") tasks.push(updateSilver()); if(what==="all"||what==="crypto") tasks.push(updateCrypto()); if(what==="all"||what==="fx") tasks.push(updateFX("USD","EGP")); if(what==="all"||what==="energy") tasks.push(updateEnergy()); if(what==="all"||what==="metals"){ for(const m of METALS_TO_LOOP) tasks.push(updateMetalOnce(m)); } Promise.allSettled(tasks).then(()=>res.json({ok:true,lastUpdate:cache.lastUpdate})); });
app.post("/api/admin/cache/clear",(req,res)=>{ if(!okAdmin(req)) return res.status(401).json({error:"unauthorized"}); cache.prices={}; saveCache(); res.json({ok:true}); });

app.listen(PORT, ()=>console.log(`Backend running on :${PORT}`));
