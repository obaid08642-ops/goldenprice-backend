import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

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
const SLX_BSC_TOKEN = process.env.SLX_BSC_TOKEN || "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d";

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

import cors from "cors";

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-admin-token"]
}));

app.options("*", cors());

// serve admin.html + any static files in root
app.use(express.static(__dirname));

// ---------- in-memory + persisted cache ----------
let cache = {
  prices: {},         // symbol -> {price, unit, src, t}
  lastUpdate: {},     // group/symbol -> timestamp
  rotate: {           // indices to rotate through sources per group
    gold: 0, silver: 0, crypto: 0, fx: 0
  }
};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const j = JSON.parse(fs.readFileSync(CACHE_FILE,"utf-8"));
      cache = { ...cache, ...j };
    }
  } catch {}
}
function saveCache() {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); } catch {}
}

loadCache();

// ---------- sites (rotation plan) ----------
let SITES = {
  gold: ["twelvedata:XAU/USD","yahoo:XAUUSD=X","kitco:gold","thestreetgold:gold"],
  silver:["twelvedata:XAG/USD","yahoo:XAGUSD=X","kitco:silver"],
  crypto:["binancews:BTCUSDT,ETHUSDT","coingecko:bitcoin,ethereum","coincap:bitcoin,ethereum","dexscreener:SLX"],
  fx:["exchangeratehost:USD,EGP","frankfurter:USD,EGP","alphavantage:USD,EGP"],
  metals:{
    platinum:["yahoo:XPTUSD=X","twelvedata:XPT/USD"],
    palladium:["yahoo:XPDUSD=X","twelvedata:XPD/USD"],
    copper:["yahoo:HG=F"],
    aluminum:["yahoo:ALI=F"],
    nickel:["yahoo:NID=F"],
    zinc:["yahoo:MZN=F"],
    lead:["yahoo:LD=F"],
    tin:["yahoo:TIN=F"],
    iron:["yahoo:TIO=F"],
    steel:["yahoo:STL=F"],
    cobalt:["yahoo:CO=F"],
    lithium:["yahoo:LIT=F"],
    uranium:["yahoo:UX=F"]
  },
  energy:{
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
  const day = d.getUTCDay(); // 0=Sun, 6=Sat
  return day === 0 || day === 6;
};

function put(symbol, price, unit, src){
  cache.prices[symbol] = { price: Number(price), unit, src, t: now() };
  saveCache();
}

function get(symbol){
  return cache.prices[symbol] || null;
}

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

// ---------- source resolvers ----------
async function fromTwelveData(pair){ // e.g. XAU/USD
  if(!TWELVEDATA_KEY) throw new Error("no TD key");
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(pair)}&apikey=${TWELVEDATA_KEY}`;
  const j = await getJSON(url);
  const v = Number(j?.price);
  if(!v) throw new Error("TD no price");
  return v;
}
async function fromYahoo(ticker){ // e.g. XAUUSD=X or HG=F
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?region=US&lang=en-US`;
  const j = await getJSON(url);
  const v = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if(!v) throw new Error("Yahoo no price");
  return Number(v);
}
// lightweight scrapers (fallback/alternate)
async function fromKitco(metal){ // "gold"|"silver"
  // Use their markets page — parse first price
  const map = { gold: "gold-price-today-usa", silver: "silver-price-today-usa" };
  const slug = map[metal] || "gold-price-today-usa";
  const html = await getText(`https://www.kitco.com/${slug}.html`);
  const $ = cheerio.load(html);
  // Try to find number-looking text
  let txt = ($("span:contains(USD)").first().text() || $("td:contains(USD)").first().text() || "").replace(/[^\d.]/g,"");
  const v = Number(txt);
  if(!v) throw new Error("Kitco parse fail");
  return v;
}
async function fromTheStreetGold(){
  const html = await getText("https://www.thestreet.com/quote/gold-price"); // may change
  const $ = cheerio.load(html);
  let txt = $("*[data-test='last-price']").first().text().replace(/[^\d.]/g,"");
  const v = Number(txt);
  if(!v) throw new Error("TheStreetGold parse fail");
  return v;
}

// Crypto:
const wsPrices = new Map(); // e.g. BTCUSDT -> price
import WebSocket from "ws"; // لو لسه ما ضفتوش فوق مع باقي imports، ضيفه أول الملف

function startBinanceWS(symbols = ["btcusdt", "ethusdt"]) {
  try {
    const streams = symbols.map(s => `${s}@ticker`).join("/");
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    ws.on("message", buf => {
      try {
        const j = JSON.parse(buf.toString());
        const d = j?.data;
        if (d?.s && d?.c) wsPrices.set(d.s, Number(d.c));
      } catch {}
    });
    ws.on("close", () => setTimeout(() => startBinanceWS(symbols), 3000));
    ws.on("error", () => ws.close());
  } catch (err) {
    console.error("WS error:", err.message);
  }
}
startBinanceWS();

async function fromCoinGecko(ids){ // "bitcoin,ethereum"
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
async function fromCoinCap(id){ // "bitcoin"
  const j = await getJSON(`https://api.coincap.io/v2/assets/${id}`);
  const v = Number(j?.data?.priceUsd);
  if(!v) throw new Error("CoinCap no price");
  return v;
}
async function fromDexScreenerByToken(token){ // BSC token
  const j = await getJSON(`https://api.dexscreener.com/latest/dex/tokens/${token}`);
  const pair = j?.pairs?.[0];
  const v = Number(pair?.priceUsd);
  if(!v) throw new Error("DexScreener no price");
  return v;
}

// FX:
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

// Energy (WTI/Brent/NatGas) via AlphaVantage (daily), fallback Yahoo futures
async function fromAlphaEnergy(kind){ // "WTI"|"BRENT"|"NATGAS"
  if(!ALPHAVANTAGE_KEY) throw new Error("no AV key");
  const fnMap = { WTI:"WTI", BRENT:"BRENT", NATGAS:"NATURAL_GAS" };
  const fn = fnMap[kind];
  if(!fn) throw new Error("invalid energy kind");
  const url = `https://www.alphavantage.co/query?function=${fn}&interval=daily&apikey=${ALPHAVANTAGE_KEY}`;
  const j = await getJSON(url);
  // take the latest close in series
  const series = j?.data || j?.["data"] || j?.["Time Series (Daily)"];
  let v = null;
  if (series && typeof series === "object") {
    const first = Array.isArray(series) ? series[0] : Object.values(series)[0];
    const num = Number(first?.close || first?.["4. close"]);
    if(num) v = num;
  }
  if(!v) throw new Error("AV energy no data");
  return v;
}

// ---------- rotation helpers ----------
function pickRotate(group){
  const list = Array.isArray(SITES[group]) ? SITES[group] : null;
  if (!list) return null;
  const idx = (cache.rotate[group] || 0) % list.length;
  const src = list[idx];
  cache.rotate[group] = (idx + 1) % list.length;
  saveCache();
  return src;
}

// ---------- update routines ----------
async function updateGold(){
  if (weekend()) return; // وفر الريكوست في الويك ايند
  let src = pickRotate("gold");
  if(!src) return;
  let price = null, unit="oz", used = src;
  try{
    if (src.startsWith("twelvedata:")) {
      price = await fromTwelveData(src.split(":")[1]);
    } else if (src.startsWith("yahoo:")) {
      price = await fromYahoo(src.split(":")[1]);
    } else if (src.startsWith("kitco:")) {
      price = await fromKitco("gold");
    } else if (src.startsWith("thestreetgold:")) {
      price = await fromTheStreetGold();
    }
    if (price) { put("GOLD", price, unit, used); cache.lastUpdate.gold = now(); saveCache(); }
  }catch{}
}
async function updateSilver(){
  if (weekend()) return;
  let src = pickRotate("silver");
  if(!src) return;
  let price = null, unit="oz", used = src;
  try{
    if (src.startsWith("twelvedata:")) {
      price = await fromTwelveData(src.split(":")[1]);
    } else if (src.startsWith("yahoo:")) {
      price = await fromYahoo(src.split(":")[1]);
    } else if (src.startsWith("kitco:")) {
      price = await fromKitco("silver");
    }
    if (price) { put("SILVER", price, unit, used); cache.lastUpdate.silver = now(); saveCache(); }
  }catch{}
}
async function updateCrypto(){
  let src = pickRotate("crypto");
  if(!src) return;
  try{
    if (src.startsWith("binancews:")) {
      // Binance WS already fills wsPrices; read snapshot
      const btc = wsPrices.get("BTCUSDT");
      const eth = wsPrices.get("ETHUSDT");
      if (btc) put("BTC", btc, "usd", "binancews");
      if (eth) put("ETH", eth, "usd", "binancews");
    } else if (src.startsWith("coingecko:")) {
      const ids = src.split(":")[1]; // e.g. bitcoin,ethereum
      const j = await fromCoinGecko(ids);
      if (j.BITCOIN) put("BTC", j.BITCOIN, "usd", "coingecko");
      if (j.ETHEREUM) put("ETH", j.ETHEREUM, "usd", "coingecko");
    } else if (src.startsWith("coincap:")) {
      const v1 = await fromCoinCap("bitcoin"); put("BTC", v1, "usd", "coincap");
      const v2 = await fromCoinCap("ethereum"); put("ETH", v2, "usd", "coincap");
    } else if (src.startsWith("dexscreener:")) {
      // SilverX via BSC token
      const v = await fromDexScreenerByToken(SLX_BSC_TOKEN);
      put("SLX", v, "usd", "dexscreener");
    }
    cache.lastUpdate.crypto = now(); saveCache();
  }catch{}
}
async function updateFX(base="USD", quote="EGP"){
  let src = pickRotate("fx");
  if(!src) return;
  try{
    if (src.startsWith("exchangeratehost:")) {
      const v = await fromExchangeRateHost(base,quote);
      put(`FX_${base}_${quote}`, v, "rate", "ERH");
    } else if (src.startsWith("frankfurter:")) {
      const v = await fromFrankfurter(base,quote);
      put(`FX_${base}_${quote}`, v, "rate", "Frankfurter");
    } else if (src.startsWith("alphavantage:")) {
      const v = await fromAlphaFX(base,quote);
      put(`FX_${base}_${quote}`, v, "rate", "AlphaVantage");
    }
    cache.lastUpdate.fx = now(); saveCache();
  }catch{}
}
async function updateMetals(){
  const m = SITES.metals || {};
  for (const [name, sources] of Object.entries(m)){
    let got = false;
    for (const src of sources){
      try{
        let v=null, unit="oz";
        if (src.startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]);
        else if (src.startsWith("twelvedata:")) v = await fromTwelveData(src.split(":")[1]);
        if (v){ put(name.toUpperCase(), v, unit, src); got=true; break; }
      }catch{}
    }
  }
  cache.lastUpdate.metals = now(); saveCache();
}
async function updateEnergy(){
  const e = SITES.energy || {};
  for (const [name, sources] of Object.entries(e)){
    let got=false;
    for (const src of sources){
      try{
        let v=null;
        if (src==="alphavantage:WTI") v=await fromAlphaEnergy("WTI");
        else if (src==="alphavantage:BRENT") v=await fromAlphaEnergy("BRENT");
        else if (src==="alphavantage:NATGAS") v=await fromAlphaEnergy("NATGAS");
        else if (src.startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]);
        if(v){ put(name.toUpperCase(), v, "usd", src); got=true; break; }
      }catch{}
    }
  }
  cache.lastUpdate.energy = now(); saveCache();
}

// ---------- schedules ----------
const MIN = 60*1000;
setInterval(()=>{ updateGold(); updateSilver(); updateCrypto(); }, 210*1000); // 3.5 دقيقة
setInterval(()=>{ updateFX("USD","EGP"); }, 2*60*60*1000);                     // كل ساعتين
setInterval(()=>{ updateMetals(); }, 3*60*60*1000);                            // كل 3 ساعات
setInterval(()=>{ updateEnergy(); }, 5*60*60*1000);                            // كل 5 ساعات

// kick-off immediately on boot
updateGold(); updateSilver(); updateCrypto();
updateFX("USD","EGP"); updateMetals(); updateEnergy();

// ---------- APIs ----------
app.get("/api/health",(req,res)=> res.json({ ok:true, ts: Date.now() }));

app.get("/api/gold",(req,res)=>{
  const v = get("GOLD");
  if(!v) return res.status(404).json({error:"Not found"});
  res.json(v);
});
app.get("/api/silver",(req,res)=>{
  const v = get("SILVER");
  if(!v) return res.status(404).json({error:"Not found"});
  res.json(v);
});
app.get("/api/crypto",(req,res)=>{
  const list = (req.query.list||"BTC,ETH,SLX").split(",").map(s=>s.trim().toUpperCase());
  const out={};
  for(const s of list){
    const v = get(s);
    if(v) out[s]=v; else out[s]={error:"Not found"};
  }
  res.json(out);
});
app.get("/api/fx",(req,res)=>{
  const from = (req.query.from||"USD").toUpperCase();
  const to = (req.query.to||"EGP").toUpperCase();
  const v = get(`FX_${from}_${to}`);
  if(!v) return res.status(404).json({error:"Not found"});
  res.json({from,to,...v});
});
app.get("/api/metals",(req,res)=>{
  const list = (req.query.list||"platinum,palladium,copper,aluminum,nickel,zinc,lead,tin,iron,steel,cobalt,lithium,uranium").split(",").map(s=>s.trim().toUpperCase());
  const out={};
  for(const m of list){
    const v = get(m);
    if(v) out[m]=v; else out[m]={error:"Not found"};
  }
  res.json(out);
});
app.get("/api/energy",(req,res)=>{
  const list = (req.query.list||"wti,brent,natgas").split(",").map(s=>s.trim().toUpperCase());
  const out={};
  for(const n of list){
    const v = get(n);
    if(v) out[n]=v; else out[n]={error:"Not found"};
  }
  res.json(out);
});

// ---------- Admin (token) ----------
function okAdmin(req){
  const t = req.headers["x-admin-token"] || req.query.token || req.body?.token;
  return String(t) === String(ADMIN_TOKEN);
}

// لوحة التحكم تٌعرض من admin.html (static). فقط API أدناه:
app.get("/api/cache",(req,res)=>{
  if(!okAdmin(req)) return res.status(401).json({error:"unauthorized"});
  res.json({
    prices: cache.prices,
    lastUpdate: cache.lastUpdate
  });
});
app.post("/api/admin/set",(req,res)=>{
  if(!okAdmin(req)) return res.status(401).json({error:"unauthorized"});
  const { symbol, price, unit="usd" } = req.body || {};
  if(!symbol || !price) return res.status(400).json({error:"symbol and price required"});
  put(String(symbol).toUpperCase(), Number(price), unit, "manual");
  res.json({ ok:true, saved: cache.prices[String(symbol).toUpperCase()] });
});
app.post("/api/admin/refresh",(req,res)=>{
  if(!okAdmin(req)) return res.status(401).json({error:"unauthorized"});
  const what = String(req.body?.what||"all").toLowerCase();
  const tasks = [];
  if (what==="all" || what==="gold") tasks.push(updateGold());
  if (what==="all" || what==="silver") tasks.push(updateSilver());
  if (what==="all" || what==="crypto") tasks.push(updateCrypto());
  if (what==="all" || what==="fx") tasks.push(updateFX("USD","EGP"));
  if (what==="all" || what==="metals") tasks.push(updateMetals());
  if (what==="all" || what==="energy") tasks.push(updateEnergy());
  Promise.allSettled(tasks).then(()=>{
    res.json({ ok:true, lastUpdate: cache.lastUpdate });
  });
});
app.post("/api/admin/cache/clear",(req,res)=>{
  if(!okAdmin(req)) return res.status(401).json({error:"unauthorized"});
  cache.prices = {};
  saveCache();
  res.json({ ok:true });
});

// ---------- start ----------
app.listen(PORT, ()=> console.log(`Backend running on :${PORT}`));
