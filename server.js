// server.js (UPDATED by ChatGPT — only changes for SLX / SILVER / some metals)
import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import WebSocket from "ws";

// ---------- paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, "cache.json");
const SITES_FILE = path.join(__dirname, "sites.json");

// ---------- env ----------
const PORT = Number(process.env.PORT || 10000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "ADMIN_12345";
const TWELVEDATA_KEY = process.env.TWELVEDATA_KEY || "";
const ALPHAVANTAGE_KEY = process.env.ALPHAVANTAGE_KEY || "";
const EXCHANGEHOST_KEY = process.env.EXCHANGEHOST_KEY || "";
const METALS_DEV_KEY = process.env.METALS_DEV_KEY || ""; // optional key for metals.dev
const SLX_BSC_TOKEN = process.env.SLX_BSC_TOKEN || "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d";
const SLX_BSC_PAIR = process.env.SLX_BSC_PAIR || "0x7c75568929156f3eb939fb546ce827e48c33da67"; // optional pair

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- CORS ----------
import cors from "cors";
app.use(cors({
  origin: "*",
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","x-admin-token"]
}));
app.options("*", cors());

// serve admin.html + any static files in root
app.use(express.static(__dirname));

// ---------- in-memory + persisted cache ----------
let cache = {
  prices: {},
  lastUpdate: {},
  rotate: { gold:0, silver:0, crypto:0, fx:0 }
};

function loadCache(){
  try{
    if(fs.existsSync(CACHE_FILE)){
      const j = JSON.parse(fs.readFileSync(CACHE_FILE,"utf-8"));
      cache = { ...cache, ...j };
    }
  }catch(e){}
}
function saveCache(){
  try{ fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); }catch(e){}
}
loadCache();

// ---------- sites (rotation plan) ----------
let SITES = {
  gold: ["twelvedata:XAU/USD","yahoo:XAUUSD=X","kitco:gold","thestreetgold:gold"],
  // SILVER is one of the "problematic" items -> extend its sources (we are allowed to change silver)
  silver: [
    "twelvedata:XAG/USD",
    "yahoo:XAGUSD=X",
    "kitco:silver",
    "metalsdev:silver",
    "saudigold:silverprice",
    "metalary:silver-price"
  ],
  crypto: [
    "binancews:BTCUSDT,ETHUSDT",
    "coingecko:bitcoin,ethereum",
    "coincap:bitcoin,ethereum",
    "dexscreener:SLX",
    // add geckoterminal token endpoint for SLX as an alternative source
    `geckoterminal:${SLX_BSC_TOKEN}`
  ],
  fx: ["exchangeratehost:USD,EGP","frankfurter:USD,EGP","alphavantage:USD,EGP"],
  metals: {
    platinum: ["yahoo:XPTUSD=X","twelvedata:XPT/USD","metalsdev:platinum"],
    palladium: ["yahoo:XPDUSD=X","twelvedata:XPD/USD","metalsdev:palladium"],
    copper: ["yahoo:HG=F","metalsdev:copper"],
    aluminum: ["yahoo:ALI=F","metalsdev:aluminum"],
    nickel: ["yahoo:NID=F","metalsdev:nickel"],
    zinc: ["yahoo:MZN=F","metalsdev:zinc","metalary:zinc-price"],
    lead: ["yahoo:LD=F","metalsdev:lead","metalary:lead-price"],
    tin: ["yahoo:TIN=F","metalsdev:tin"],
    iron: ["yahoo:TIO=F","metalsdev:iron"],
    steel: ["yahoo:STL=F"],
    cobalt: ["yahoo:CO=F","metalsdev:cobalt"],
    lithium: ["yahoo:LIT=F","metalsdev:lithium"],
    uranium: ["yahoo:UX=F","metalsdev:uranium"]
  },
  energy: {
    wti:["alphavantage:WTI","yahoo:CL=F"],
    brent:["alphavantage:BRENT","yahoo:BRN=F"],
    natgas:["alphavantage:NATGAS","yahoo:NG=F"]
  }
};

// Try loading sites.json if present
try {
  if (fs.existsSync(SITES_FILE)) {
    const j = JSON.parse(fs.readFileSync(SITES_FILE,"utf-8"));
    SITES = j;
  }
} catch {}

// ---------- helpers ----------
const now = ()=> Date.now();
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const weekend = ()=>{
  const d = new Date();
  const day = d.getUTCDay();
  return day === 0 || day === 6;
};

// put/get (cache) - keep original safe behavior
function put(symbol, price, unit, src){
  const num = Number(price);
  if(!num || !Number.isFinite(num)) return;
  cache.prices[symbol] = { price: num, unit, src, t: now() };
  saveCache();
}
function get(symbol){
  return cache.prices[symbol] || null;
}

// fetch helpers
async function getJSON(url, opts={}, retries=1){
  let e;
  for(let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    }catch(err){ e=err; await sleep(200); }
  }
  throw e;
}
async function getText(url, opts={}, retries=1){
  let e;
  for(let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    }catch(err){ e=err; await sleep(200); }
  }
  throw e;
}

// ---------- source resolvers (existing + new) ----------

async function fromTwelveData(pair){
  if(!TWELVEDATA_KEY) throw new Error("no TD key");
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(pair)}&apikey=${TWELVEDATA_KEY}`;
  const j = await getJSON(url);
  const v = Number(j?.price);
  if(!v) throw new Error("TD no price");
  return v;
}
async function fromYahoo(ticker){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?region=US&lang=en-US`;
  const j = await getJSON(url);
  const v = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if(!v) throw new Error("Yahoo no price");
  return Number(v);
}
async function fromKitco(metal){
  const map = { gold: "gold-price-today-usa", silver: "silver-price-today-usa" };
  const slug = map[metal] || "gold-price-today-usa";
  const html = await getText(`https://www.kitco.com/${slug}.html`);
  const $ = cheerio.load(html);
  let txt = ($("span:contains(USD)").first().text() || $("td:contains(USD)").first().text() || "").replace(/[^\d.]/g,"");
  const v = Number(txt);
  if(!v) throw new Error("Kitco parse fail");
  return v;
}
async function fromTheStreetGold(){
  const html = await getText("https://www.thestreet.com/quote/gold-price");
  const $ = cheerio.load(html);
  let txt = $("*[data-test='last-price']").first().text().replace(/[^\d.]/g,"");
  const v = Number(txt);
  if(!v) throw new Error("TheStreetGold parse fail");
  return v;
}
// fallback metal scrapers
async function fromMetalFallback(name){
  const slug = `${name.toLowerCase()}-price`;
  const url = `https://www.metalary.com/${slug}/`;
  const html = await getText(url);
  const $ = cheerio.load(html);
  let m = $("body").text().match(/(\d+(\.\d+)?)/);
  if(!m) throw new Error("Metalary parse fail");
  const v = Number(m[1]);
  if(!v) throw new Error("Metalary no price");
  return v;
}

// ----- new: metals.dev API -----
async function fromMetalsDev(metal){
  if(!METALS_DEV_KEY) throw new Error("no metals.dev key");
  const url = `https://api.metals.dev/v1/metal/spot?api_key=${encodeURIComponent(METALS_DEV_KEY)}&metal=${encodeURIComponent(metal)}&currency=USD`;
  const j = await getJSON(url, {}, 1);
  const v = Number(j?.rate?.price || j?.rate?.ask || j?.rate?.bid);
  if(!v) throw new Error("metals.dev no price");
  return v;
}

// ----- new: saudigoldprice scrap (silver + oil pages) -----
async function fromSaudiGoldSilver(){
  // scrap the provided page - returns USD per oz
  const url = "https://saudigoldprice.com/silverprice/";
  const html = await getText(url, {}, 2);
  const $ = cheerio.load(html);
  // look for currency pattern or "سعر أونصة الفضة" + number
  let txt = $("body").text().match(/(?:سعر\s*أونصة\s*الفضة[:\s]*|Silver Price[:\s]*)([0-9]+\.[0-9]+)/i);
  if(!txt){
    // try to find pattern like "51.52"
    const any = $("body").text().match(/([0-9]{1,3}\.[0-9]{1,4})\s*\$/);
    if(any) txt = any;
  }
  if(!txt) throw new Error("saudigold parse fail");
  const v = Number(txt[1]);
  if(!v) throw new Error("saudigold no price");
  return v;
}

// ----- new: Geckoterminal by token (SLX) -----
async function fromGeckoTerminalByToken(token){
  const url = `https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${token}`;
  const j = await getJSON(url, {}, 1);
  const v = Number(j?.data?.attributes?.price_usd || j?.data?.attributes?.price);
  if(!v) throw new Error("Geckoterminal no price");
  return v;
}

// Dexscreener function (improved search used earlier)
async function fromDexScreenerByToken(token){
  // token can be address or search q
  const j = await getJSON(`https://api.dexscreener.com/latest/dex/search?q=${token}`, {}, 1);
  const pair = j?.pairs?.[0];
  const v = Number(pair?.priceUsd || pair?.price_usd);
  if(!v) throw new Error("DexScreener no price");
  return v;
}

// CoinGecko / CoinCap as before
async function fromCoinGecko(ids){
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
  const j = await getJSON(url);
  const out = {};
  ids.split(",").forEach(id=>{
    const v = Number(j?.[id]?.usd);
    if(v) out[id.toUpperCase()] = v;
  });
  if(!Object.keys(out).length) throw new Error("CG no prices");
  return out;
}
async function fromCoinCap(id){
  const j = await getJSON(`https://api.coincap.io/v2/assets/${id}`);
  const v = Number(j?.data?.priceUsd);
  if(!v) throw new Error("CoinCap no price");
  return v;
}

// FX functions unchanged
async function fromExchangeRateHost(base="USD", quote="EGP"){
  const key = EXCHANGEHOST_KEY ? `&access_key=${EXCHANGEHOST_KEY}` : "";
  const url = `https://api.exchangerate.host/convert?from=${base}&to=${quote}${key}`;
  const j = await getJSON(url);
  const v = Number(j?.result);
  if(!v) throw new Error("ERH no rate");
  return v;
}
async function fromFrankfurter(base="USD", quote="EGP"){
  const j = await getJSON(`https://api.frankfurter.dev/latest?from=${base}&to=${quote}`);
  const v = Number(j?.rates?.[quote]);
  if(!v) throw new Error("Frankfurter no rate");
  return v;
}
async function fromAlphaFX(base="USD", quote="EGP"){
  if(!ALPHAVANTAGE_KEY) throw new Error("no AV key");
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${base}&to_currency=${quote}&apikey=${ALPHAVANTAGE_KEY}`;
  const j = await getJSON(url);
  const v = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
  if(!v) throw new Error("AV no rate");
  return v;
}

// Energy via AV or Yahoo (unchanged)
async function fromAlphaEnergy(kind){
  if(!ALPHAVANTAGE_KEY) throw new Error("no AV key");
  const fnMap = { WTI:"WTI", BRENT:"BRENT", NATGAS:"NATURAL_GAS" };
  const fn = fnMap[kind];
  if(!fn) throw new Error("invalid energy kind");
  const url = `https://www.alphavantage.co/query?function=${fn}&interval=daily&apikey=${ALPHAVANTAGE_KEY}`;
  const j = await getJSON(url);
  const series = j?.data || j?.["data"] || j?.["Time Series (Daily)"];
  let v = null;
  if(series && typeof series === "object"){
    const first = Array.isArray(series) ? series[0] : Object.values(series)[0];
    const num = Number(first?.close || first?.["4. close"]);
    if(num) v = num;
  }
  if(!v) throw new Error("AV energy no data");
  return v;
}

// ---------- rotation helper ----------
function pickRotate(group){
  const list = Array.isArray(SITES[group]) ? SITES[group] : null;
  if(!list) return null;
  const idx = (cache.rotate[group] || 0) % list.length;
  const src = list[idx];
  cache.rotate[group] = (idx + 1) % list.length;
  saveCache();
  return src;
}

// ---------- update routines (modified only where required) ----------
async function updateGold(){
  if(weekend()) return;
  let src = pickRotate("gold"); if(!src) return;
  let price=null, unit="oz", used=src;
  try{
    if(src.startsWith("twelvedata:")) price = await fromTwelveData(src.split(":")[1]);
    else if(src.startsWith("yahoo:")) price = await fromYahoo(src.split(":")[1]);
    else if(src.startsWith("kitco:")) price = await fromKitco("gold");
    else if(src.startsWith("thestreetgold:")) price = await fromTheStreetGold();
    if(price){ put("GOLD", price, unit, used); cache.lastUpdate.gold = now(); saveCache(); }
  }catch(err){}
}

async function updateSilver(){
  if(weekend()) return;
  // Instead of single-source fallback, try multiple sources in a loop (LOOP behavior)
  const sources = Array.isArray(SITES.silver) ? SITES.silver.slice() : ["twelvedata:XAG/USD","yahoo:XAGUSD=X","kitco:silver"];
  // rotate through sources but try each until success (this implements looped sources)
  for(const src of sources){
    try{
      let price = null, unit="oz", used=src;
      if(src.startsWith("twelvedata:")) price = await fromTwelveData(src.split(":")[1]);
      else if(src.startsWith("yahoo:")) price = await fromYahoo(src.split(":")[1]);
      else if(src.startsWith("kitco:")) price = await fromKitco("silver");
      else if(src.startsWith("metalsdev:")){
        const m = src.split(":")[1] || "silver";
        price = await fromMetalsDev(m);
      } else if(src.startsWith("saudigold:")){
        price = await fromSaudiGoldSilver();
      } else if(src.startsWith("metalary:")){
        price = await fromMetalFallback("silver");
      }
      if(price){
        put("SILVER", price, unit, used);
        cache.lastUpdate.silver = now();
        saveCache();
        return;
      }
    }catch(err){
      // try next source
    }
  }
  // if all failed, do nothing (keep old cache)
}

async function updateCrypto(){
  let src = pickRotate("crypto"); if(!src) return;
  try{
    if(src.startsWith("binancews:")){
      const btc = wsPrices.get("BTCUSDT"); const eth = wsPrices.get("ETHUSDT");
      if(btc) put("BTC", btc, "usd", "binancews");
      if(eth) put("ETH", eth, "usd", "binancews");
    } else if(src.startsWith("coingecko:")){
      const ids = src.split(":")[1];
      const j = await fromCoinGecko(ids);
      if(j.BITCOIN) put("BTC", j.BITCOIN, "usd", "coingecko");
      if(j.ETHEREUM) put("ETH", j.ETHEREUM, "usd", "coingecko");
    } else if(src.startsWith("coincap:")){
      const v1 = await fromCoinCap("bitcoin"); put("BTC", v1, "usd", "coincap");
      const v2 = await fromCoinCap("ethereum"); put("ETH", v2, "usd", "coincap");
    } else if(src.startsWith("dexscreener:")){
      // original behaviour for SLX (token)
      try{
        const v = await fromDexScreenerByToken(SLX_BSC_TOKEN);
        put("SLX", v, "usd", "dexscreener");
      }catch(e){
        // fallback to GeckoTerminal if dexscreener fails (we'll try gecko below)
      }
    } else if(src.startsWith("geckoterminal:")){
      // direct geckoterminal source present in list
      const token = src.split(":")[1];
      try{
        const v = await fromGeckoTerminalByToken(token || SLX_BSC_TOKEN);
        put("SLX", v, "usd", "geckoterminal");
      }catch(err){}
    }
    cache.lastUpdate.crypto = now(); saveCache();
  }catch(e){}
}

// ----- dedicated SLX updater (every 5 minutes) -----
// This function cycles through a defined SLX source list (LOOP).
async function updateSLXLoop(){
  const slxSources = [
    "dexscreener:"+SLX_BSC_TOKEN,
    "geckoterminal:"+SLX_BSC_TOKEN,
    // you can add more sources (e.g. pancakeswap liquidity API) if available
  ];
  for(const src of slxSources){
    try{
      if(src.startsWith("dexscreener:")){
        const token = src.split(":")[1];
        const v = await fromDexScreenerByToken(token || SLX_BSC_TOKEN);
        if(v){ put("SLX", v, "usd", "dexscreener"); cache.lastUpdate.crypto = now(); saveCache(); return; }
      } else if(src.startsWith("geckoterminal:")){
        const token = src.split(":")[1];
        const v = await fromGeckoTerminalByToken(token || SLX_BSC_TOKEN);
        if(v){ put("SLX", v, "usd", "geckoterminal"); cache.lastUpdate.crypto = now(); saveCache(); return; }
      }
    }catch(err){
      // try next source
    }
  }
  // if none produced a value, keep old cache
}

// Metals update (loop each metal's sources)
async function updateMetals(){
  const m = SITES.metals || {};
  for(const [name, sources] of Object.entries(m)){
    let got=false;
    // iterate through all configured sources for this metal (LOOP)
    for(const src of (sources || [])){
      try{
        let v=null, unit="oz";
        if(src.startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]);
        else if(src.startsWith("twelvedata:")) v = await fromTwelveData(src.split(":")[1]);
        else if(src.startsWith("metalsdev:")){
          const metalName = src.split(":")[1] || name;
          v = await fromMetalsDev(metalName);
        } else if(src.startsWith("metalary:")){
          v = await fromMetalFallback(name);
        }
        if(v){
          put(name.toUpperCase(), v, unit, src);
          got=true;
          break;
        }
      }catch(err){
        // try next source
      }
    }
    if(!got){
      // final fallback attempt using metalary scraper
      try{
        const v2 = await fromMetalFallback(name);
        if(v2){ put(name.toUpperCase(), v2, "oz", "metalary-fallback"); got=true; }
      }catch(err){}
    }
  }
  cache.lastUpdate.metals = now(); saveCache();
}

async function updateEnergy(){
  const e = SITES.energy || {};
  for(const [name, sources] of Object.entries(e)){
    let got=false;
    for(const src of sources){
      try{
        let v=null;
        if(src==="alphavantage:WTI") v=await fromAlphaEnergy("WTI");
        else if(src==="alphavantage:BRENT") v=await fromAlphaEnergy("BRENT");
        else if(src==="alphavantage:NATGAS") v=await fromAlphaEnergy("NATGAS");
        else if(src.startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]);
        if(v){ put(name.toUpperCase(), v, "usd", src); got=true; break; }
      }catch(err){}
    }
  }
  cache.lastUpdate.energy = now(); saveCache();
}

// ---------- schedules ----------
// keep crypto/gold default cadence but add dedicated SLX and silver cadence as requested
setInterval(()=>{ updateGold(); updateCrypto(); }, 210*1000); // 3.5 min
// SLX dedicated loop every 5 minutes
setInterval(()=>{ updateSLXLoop(); }, 5*60*1000); // 5 minutes
// silver every 40 minutes as requested
setInterval(()=>{ updateSilver(); }, 40*60*1000); // 40 minutes
// metals general (other metals) every 3 hours (we keep but metals includes silver too; silver has its own fast schedule)
setInterval(()=>{ updateMetals(); }, 3*60*60*1000);
// FX and energy as before
setInterval(()=>{ updateFX("USD","EGP"); }, 2*60*60*1000);
setInterval(()=>{ updateEnergy(); }, 5*60*60*1000);

// kick-off at boot
updateGold(); updateSilver(); updateCrypto(); updateSLXLoop(); updateFX("USD","EGP"); updateMetals(); updateEnergy();

// ---------- WebSocket for Binance (unchanged) ----------
const wsPrices = new Map();
function startBinanceWS(symbols=["btcusdt","ethusdt"]){
  try{
    const streams = symbols.map(s=>`${s}@ticker`).join("/");
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    ws.on("message", buf=>{
      try{
        const j = JSON.parse(buf.toString());
        const d = j?.data;
        if(d?.s && d?.c) wsPrices.set(d.s, Number(d.c));
      }catch(e){}
    });
    ws.on("close", ()=> setTimeout(()=> startBinanceWS(symbols), 3000));
    ws.on("error", ()=> ws.close());
  }catch(err){ console.error("WS error:", err.message); }
}
startBinanceWS();

// ---------- APIs (unchanged endpoints) ----------
app.get("/api/health",(req,res)=> res.json({ ok:true, ts: Date.now(), lastUpdate: cache.lastUpdate }));
app.get("/api/status",(req,res)=> res.json({ ok:true, ts: Date.now(), lastUpdate: cache.lastUpdate }));

app.get("/api/gold",(req,res)=>{
  const v = get("GOLD"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v);
});
app.get("/api/silver",(req,res)=>{
  const v = get("SILVER"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v);
});
app.get("/api/crypto",(req,res)=>{
  const list = (req.query.list||"BTC,ETH,SLX").split(",").map(s=>s.trim().toUpperCase());
  const out={};
  for(const s of list){ const v=get(s); if(v) out[s]=v; else out[s]={error:"Not found"} }
  res.json(out);
});
app.get("/api/crypto/bitcoin",(req,res)=>{ const v=get("BTC"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });
app.get("/api/crypto/ethereum",(req,res)=>{ const v=get("ETH"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });
app.get("/api/crypto/silverx",(req,res)=>{ const v=get("SLX"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });

app.get("/api/fx",(req,res)=>{ const from=(req.query.from||"USD").toUpperCase(); const to=(req.query.to||"EGP").toUpperCase(); const v=get(`FX_${from}_${to}`); if(!v) return res.status(404).json({error:"Not found"}); res.json({from,to,...v}); });

app.get("/api/metals",(req,res)=>{
  const list = (req.query.list||"platinum,palladium,copper,aluminum,nickel,zinc,lead,tin,iron,steel,cobalt,lithium,uranium").split(",").map(s=>s.trim().toUpperCase());
  const out={};
  for(const m of list){ const v=get(m); if(v) out[m]=v; else out[m]={error:"Not found"} }
  res.json(out);
});
app.get("/api/metals/:metal",(req,res)=>{ const metal=String(req.params.metal||"").toUpperCase(); const v=get(metal); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });

app.get("/api/energy",(req,res)=>{ const list=(req.query.list||"wti,brent,natgas").split(",").map(s=>s.trim().toUpperCase()); const out={}; for(const n of list){ const v=get(n); if(v) out[n]=v; else out[n]={error:"Not found"} } res.json(out); });
app.get("/api/oilgas/wti",(req,res)=>{ const v=get("WTI"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });
app.get("/api/oilgas/brent",(req,res)=>{ const v=get("BRENT"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });
app.get("/api/oilgas/gas",(req,res)=>{ const v=get("NATGAS"); if(!v) return res.status(404).json({error:"Not found"}); res.json(v); });

// ---------- Admin (unchanged) ----------
function okAdmin(req){
  const t = req.headers["x-admin-token"] || req.query.token || req.body?.token;
  return String(t) === String(ADMIN_TOKEN);
}
app.get("/api/cache",(req,res)=>{ if(!okAdmin(req)) return res.status(401).json({error:"unauthorized"}); res.json({ prices: cache.prices, lastUpdate: cache.lastUpdate }); });
app.post("/api/admin/set",(req,res)=>{ if(!okAdmin(req)) return res.status(401).json({error:"unauthorized"}); const {symbol, price, unit="usd"} = req.body||{}; if(!symbol||!price) return res.status(400).json({error:"symbol and price required"}); put(String(symbol).toUpperCase(), Number(price), unit, "manual"); res.json({ ok:true, saved: cache.prices[String(symbol).toUpperCase()] }); });
app.post("/api/admin/refresh",(req,res)=>{ if(!okAdmin(req)) return res.status(401).json({error:"unauthorized"}); const what=String(req.body?.what||"all").toLowerCase(); const tasks=[]; if(what==="all"||what==="gold") tasks.push(updateGold()); if(what==="all"||what==="silver") tasks.push(updateSilver()); if(what==="all"||what==="crypto") tasks.push(updateCrypto()); if(what==="all"||what==="fx") tasks.push(updateFX("USD","EGP")); if(what==="all"||what==="metals") tasks.push(updateMetals()); if(what==="all"||what==="energy") tasks.push(updateEnergy()); Promise.allSettled(tasks).then(()=>{ res.json({ ok:true, lastUpdate: cache.lastUpdate }); }); });
app.post("/api/admin/cache/clear",(req,res)=>{ if(!okAdmin(req)) return res.status(401).json({error:"unauthorized"}); cache.prices={}; saveCache(); res.json({ ok:true }); });

// ---------- start ----------
app.listen(PORT, ()=> console.log(`Backend running on :${PORT}`));
