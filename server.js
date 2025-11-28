// server.js - updated: metals.dev-only for selected metals, 30-day history, expanded crypto
import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
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
const METALS_DEV_KEY1 = process.env.METALS_DEV_KEY1 || ""; // KZZEYQ...
const METALS_DEV_KEY2 = process.env.METALS_DEV_KEY2 || ""; // LWJWPQ...
const SLX_BSC_TOKEN = process.env.SLX_BSC_TOKEN || "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d";
const SLX_PAIR_ADDRESS = process.env.SLX_PAIR_ADDRESS || "0x7c755e961a8d415c4074bc7d3ba0b85f039c5168";

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "x-admin-token"] }));
app.options("*", cors());
app.use(express.static(__dirname));

// ---------- cache ----------
let cache = {
  prices: {},        // symbol -> { price, unit, src, t }
  lastUpdate: {},    // group/symbol -> timestamp
  rotate: {
    gold: 0, silver: 0, crypto: 0, fx: 0,
    slxLoop: 0, silverLoop: 0, metalsLoop: {}
  },
  history: {}        // symbol -> [{date: 'YYYY-MM-DD', value}]
};

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
    console.error("loadCache error", e.message || e);
  }
}
function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error("saveCache error", e.message || e);
  }
}
loadCache();

// ---------- sites (kept for other groups) ----------
let SITES = {
  gold: ["twelvedata:XAU/USD","yahoo:XAUUSD=X","kitco:gold","thestreetgold:gold"],
  silver: ["twelvedata:XAG/USD","yahoo:XAGUSD=X","kitco:silver"],
  crypto: ["binancews:BTCUSDT,ETHUSDT","coingecko:bitcoin,ethereum","coincap:bitcoin,ethereum","dexscreener:SLX"],
  fx: ["exchangeratehost:USD,EGP","frankfurter:USD,EGP","alphavantage:USD,EGP"],
  metals: {}, // not used for selected metals (we use metals.dev)
  energy: { wti: ["alphavantage:WTI","yahoo:CL=F"], brent: ["alphavantage:BRENT","yahoo:BRN=F"], natgas: ["alphavantage:NATGAS","yahoo:NG=F"] }
};
try { if (fs.existsSync(SITES_FILE)) { const j = JSON.parse(fs.readFileSync(SITES_FILE, "utf-8")); SITES = { ...SITES, ...j }; } } catch(e){ console.error("load sites.json error", e.message || e); }

// ---------- helpers ----------
const now = () => Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const todayISO = () => (new Date()).toISOString().slice(0,10);
const isValidNumber = (n) => { if (n===null||n===undefined) return false; const num = Number(n); if (!Number.isFinite(num)) return false; if (num <= 0) return false; if (num > 1e12) return false; return true; };

function put(symbol, price, unit = "usd", src = "unknown") {
  if (!isValidNumber(price)) return;
  const num = Number(price);
  cache.prices[symbol] = { price: num, unit, src, t: now() };
  // history daily snapshot
  cache.history = cache.history || {};
  const hist = cache.history[symbol] || [];
  const day = todayISO();
  if (!hist.length || hist[hist.length - 1].date !== day) {
    hist.push({ date: day, value: num });
    const MAX = 30;
    if (hist.length > MAX) hist.splice(0, hist.length - MAX);
    cache.history[symbol] = hist;
  } else {
    hist[hist.length - 1].value = num;
    cache.history[symbol] = hist;
  }
  saveCache();
}
function get(symbol) { return cache.prices[symbol] || null; }

// ---------- fetch helpers ----------
async function getJSON(url, opts = {}, retries = 1) {
  let lastErr;
  for (let i=0;i<=retries;i++){
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      lastErr = err;
      await sleep(200);
    }
  }
  throw lastErr;
}

// ---------- data source resolvers ----------
async function fromTwelveData(pair) {
  if (!TWELVEDATA_KEY) throw new Error("no TWELVEDATA_KEY");
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(pair)}&apikey=${TWELVEDATA_KEY}`;
  const j = await getJSON(url);
  const v = Number(j?.price);
  if (!v) throw new Error("TD no price");
  return v;
}
async function fromYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?region=US&lang=en-US`;
  const j = await getJSON(url);
  const v = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!v) throw new Error("Yahoo no price");
  return Number(v);
}
async function fromCoinGecko(idsCsv) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(idsCsv)}&vs_currencies=usd`;
  const j = await getJSON(url);
  const out = {};
  idsCsv.split(",").forEach(id => { const v = Number(j?.[id]?.usd); if (v) out[id.toUpperCase()] = v; });
  if (!Object.keys(out).length) throw new Error("CoinGecko no prices");
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
async function fromGeckoTerminal(tokenAddress){
  const url = `https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${tokenAddress.toLowerCase()}`;
  const j = await getJSON(url, {}, 1);
  const v = Number(j?.data?.attributes?.price_usd);
  if (!v) throw new Error("GeckoTerminal no price");
  return v;
}

// ---------- metals.dev wrapper (with explicit API key) ----------
async function fromMetalsDevWithKey(apiKey, metal) {
  if (!apiKey) throw new Error("no metals.dev key");
  const url = `https://api.metals.dev/v1/metal/spot?api_key=${encodeURIComponent(apiKey)}&metal=${encodeURIComponent(metal)}&currency=USD`;
  const j = await getJSON(url, {}, 1);
  // response sample includes rate.price etc.
  const price = Number(j?.rate?.price || j?.rate?.ask || j?.rate?.bid);
  if (!price) throw new Error("MetalsDev no price");
  return price;
}

// ---------- SLX loop (kept) ----------
const SLX_SOURCES = [
  { type: "geckoterminal", fn: async () => await fromGeckoTerminal(SLX_BSC_TOKEN) },
  { type: "dex_pair", fn: async () => await fromDexScreenerByToken(SLX_PAIR_ADDRESS) }, // pair via dexscreener
  { type: "dex_token", fn: async () => await fromDexScreenerByToken(SLX_BSC_TOKEN) },
  { type: "coincap", fn: async () => await fromCoinCap("silverx") },
];
async function updateSLXOnce(){
  let idx = cache.rotate.slxLoop || 0;
  for (let i=0;i<SLX_SOURCES.length;i++){
    const pick = (idx + i) % SLX_SOURCES.length;
    const src = SLX_SOURCES[pick];
    try {
      const price = await src.fn();
      if (isValidNumber(price)) {
        put("SLX", price, "usd", src.type);
        cache.lastUpdate.slx = now();
        cache.rotate.slxLoop = (pick + 1) % SLX_SOURCES.length;
        saveCache();
        return;
      }
    } catch(e){}
  }
}
function startSLXLoop(){ updateSLXOnce().catch(()=>{}); setInterval(()=>updateSLXOnce().catch(()=>{}), 5*60*1000); }

// ---------- Metals via metals.dev ONLY (selected metals) ----------
/*
  Mapping:
   - METALS_DEV_KEY1 -> zinc, aluminum, copper
   - METALS_DEV_KEY2 -> lead, nickel, platinum, palladium
  Update interval: every 22 hours
*/
const METALS_API_MAP = {
  ZINC: { keyEnv: "METALS_DEV_KEY1", metalName: "zinc" },
  ALUMINUM: { keyEnv: "METALS_DEV_KEY1", metalName: "aluminum" },
  COPPER: { keyEnv: "METALS_DEV_KEY1", metalName: "copper" },
  LEAD: { keyEnv: "METALS_DEV_KEY2", metalName: "lead" },
  NICKEL: { keyEnv: "METALS_DEV_KEY2", metalName: "nickel" },
  PLATINUM: { keyEnv: "METALS_DEV_KEY2", metalName: "platinum" },
  PALLADIUM: { keyEnv: "METALS_DEV_KEY2", metalName: "palladium" },
};

// single metal update using metals.dev
async function updateMetalFromMetalsDev(symbolKey) {
  try {
    const entry = METALS_API_MAP[symbolKey];
    if (!entry) return;
    const apiKey = process.env[entry.keyEnv] || (entry.keyEnv === "METALS_DEV_KEY1" ? METALS_DEV_KEY1 : METALS_DEV_KEY2);
    if (!apiKey) {
      console.warn(`no API key for ${symbolKey}`);
      return;
    }
    const price = await fromMetalsDevWithKey(apiKey, entry.metalName);
    if (isValidNumber(price)) {
      put(symbolKey, price, "usd", `metals.dev:${entry.metalName}`);
      cache.lastUpdate[symbolKey] = now();
      saveCache();
    }
  } catch (e) {
    // don't fallback to scrapers for these metals per your request
    // just leave cached value intact
    // console.error(`updateMetalFromMetalsDev ${symbolKey} error`, e.message || e);
  }
}

async function updateAllSelectedMetalsOnce() {
  const keys = Object.keys(METALS_API_MAP);
  for (const k of keys) {
    await updateMetalFromMetalsDev(k);
    // small pause to avoid burst
    await sleep(400);
  }
}
function startSelectedMetalsSchedule() {
  // run immediately then every 22 hours
  updateAllSelectedMetalsOnce().catch(()=>{});
  setInterval(()=>updateAllSelectedMetalsOnce().catch(()=>{}), 22 * 60 * 60 * 1000);
}

// ---------- Crypto updates (expanded list) ----------
/*
  We'll update popular 10 coins via CoinGecko:
  bitcoin, ethereum, binancecoin, ripple, cardano, solana, dogecoin, polkadot, litecoin, chainlink
  Keep SLX updated by SLX loop above
*/
const CRYPTO_IDS = "bitcoin,ethereum,binancecoin,ripple,cardano,solana,dogecoin,polkadot,litecoin,chainlink";
async function updateCryptoFromCoinGecko() {
  try {
    const j = await fromCoinGecko(CRYPTO_IDS);
    // Map to symbols
    const mapping = {
      BITCOIN: "BTC", ETHEREUM: "ETH", BINANCECOIN: "BNB", RIPPLE: "XRP",
      CARDANO: "ADA", SOLANA: "SOL", DOGECOIN: "DOGE", POLKADOT: "DOT",
      LITECOIN: "LTC", CHAINLINK: "LINK"
    };
    for (const k of Object.keys(j)) {
      const v = j[k];
      const sym = mapping[k];
      if (sym && isValidNumber(v)) put(sym, v, "usd", "coingecko");
    }
    cache.lastUpdate.crypto = now();
    saveCache();
  } catch (e) {
    // ignore
  }
}

// ---------- Existing update routines (gold/silver/fx/energy) ----------
async function updateGold() {
  try {
    let src = Array.isArray(SITES.gold) ? SITES.gold[cache.rotate.gold % SITES.gold.length] : null;
    if (!src) return;
    let price = null;
    if (src.startsWith("twelvedata:")) price = await fromTwelveData(src.split(":")[1]);
    else if (src.startsWith("yahoo:")) price = await fromYahoo(src.split(":")[1]);
    else if (src.startsWith("kitco:")) { /* kitco not implemented in this minimal file to avoid brittle scrapes */ }
    if (price && isValidNumber(price)) { put("GOLD", price, "oz", src); cache.lastUpdate.gold = now(); saveCache(); }
  } catch(e){}
}
async function updateSilver() {
  try {
    let src = Array.isArray(SITES.silver) ? SITES.silver[cache.rotate.silver % SITES.silver.length] : null;
    if (!src) return;
    let price = null;
    if (src.startsWith("twelvedata:")) price = await fromTwelveData(src.split(":")[1]);
    else if (src.startsWith("yahoo:")) price = await fromYahoo(src.split(":")[1]);
    if (price && isValidNumber(price)) { put("SILVER", price, "oz", src); cache.lastUpdate.silver = now(); saveCache(); }
  } catch(e){}
}

async function updateFX(base="USD", quote="EGP"){
  try {
    const src = Array.isArray(SITES.fx) ? SITES.fx[cache.rotate.fx % SITES.fx.length] : null;
    if (!src) return;
    if (src.startsWith("exchangeratehost:")) {
      const j = await getJSON(`${process.env.EXR_HOST || "https://api.exchangerate.host"}/convert?from=${base}&to=${quote}`);
      const val = Number(j?.result);
      if (val) put(`FX_${base}_${quote}`, val, "rate", "ERH");
    } else if (src.startsWith("frankfurter:")) {
      const j = await getJSON(`https://api.frankfurter.dev/latest?from=${base}&to=${quote}`);
      const val = Number(j?.rates?.[quote]);
      if (val) put(`FX_${base}_${quote}`, val, "rate", "Frankfurter");
    } else if (src.startsWith("alphavantage:")) {
      if (!ALPHAVANTAGE_KEY) return;
      const j = await getJSON(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${base}&to_currency=${quote}&apikey=${ALPHAVANTAGE_KEY}`);
      const val = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
      if (val) put(`FX_${base}_${quote}`, val, "rate", "AlphaVantage");
    }
    cache.lastUpdate.fx = now(); saveCache();
  } catch(e){}
}

async function updateEnergy() {
  try {
    const e = SITES.energy || {};
    for (const [name, sources] of Object.entries(e)) {
      for (const src of sources) {
        try {
          let v = null;
          if (src.startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]);
          // else if alphavantage energy functions could be added
          if (v && isValidNumber(v)) { put(name.toUpperCase(), v, "usd", src); break; }
        } catch(e){}
      }
    }
    cache.lastUpdate.energy = now(); saveCache();
  } catch(e){}
}

// ---------- schedules ----------
setInterval(()=>{ updateGold().catch(()=>{}); updateSilver().catch(()=>{}); updateCryptoFromCoinGecko().catch(()=>{}); }, 210*1000); // 3.5min
setInterval(()=>updateFX("USD","EGP").catch(()=>{}), 2*60*60*1000); // 2h
setInterval(()=>updateEnergy().catch(()=>{}), 5*60*60*1000); // 5h

// start loops
startSLXLoop();
startSelectedMetalsSchedule(); // metals.dev only (every 22h)
updateCryptoFromCoinGecko().catch(()=>{}); // initial
setInterval(()=>updateCryptoFromCoinGecko().catch(()=>{}), 5*60*1000); // refresh cryptos often (5min) - you can lengthen if needed

// kick initial runs
updateGold().catch(()=>{}); updateSilver().catch(()=>{}); updateFX("USD","EGP").catch(()=>{}); updateEnergy().catch(()=>{});

// ---------- history / chart / change endpoints ----------
app.get("/api/history/:symbol", (req,res)=>{
  const symbol = String(req.params.symbol||"").toUpperCase();
  const hist = (cache.history && cache.history[symbol]) || [];
  res.json({ symbol, history: hist });
});

app.get("/api/chart/:symbol", (req,res)=>{
  const symbol = String(req.params.symbol||"").toUpperCase();
  const days = Math.min(90, Number(req.query.days || 30));
  const hist = (cache.history && cache.history[symbol]) || [];
  res.json({ symbol, data: hist.slice(-days) });
});

app.get("/api/change/:symbol", (req,res)=>{
  const symbol = String(req.params.symbol||"").toUpperCase();
  const period = req.query.period || "24h";
  const hist = (cache.history && cache.history[symbol]) || [];
  if (!hist.length) return res.json({ symbol, change_percent: 0 });
  try {
    if (period.endsWith("h")) {
      const hrs = Number(period.slice(0,-1));
      if (hrs <= 24) {
        if (hist.length < 2) return res.json({ symbol, change_percent: 0 });
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
    } else if (period.endsWith("d")) {
      const days = Number(period.slice(0,-1));
      const idx = Math.max(0, hist.length-1-days);
      const last = hist[hist.length-1].value;
      const prev = hist[idx].value;
      const change = ((last - prev)/prev)*100;
      return res.json({ symbol, change_percent: Number(change.toFixed(4)) });
    } else {
      return res.json({ symbol, change_percent: 0 });
    }
  } catch (e) {
    return res.json({ symbol, change_percent: 0 });
  }
});

// ---------- existing simple APIs ----------
app.get("/api/health",(req,res)=>res.json({ ok: true, ts: Date.now(), lastUpdate: cache.lastUpdate }));
app.get("/api/status",(req,res)=>res.json({ ok: true, ts: Date.now(), lastUpdate: cache.lastUpdate }));

app.get("/api/gold",(req,res)=>{ const v = get("GOLD"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });
app.get("/api/silver",(req,res)=>{ const v = get("SILVER"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });

app.get("/api/crypto",(req,res)=>{
  const list = (req.query.list || "BTC,ETH,BNB,XRP,ADA,SOL,DOGE,DOT,LTC,LINK,SLX").split(",").map(s=>s.trim().toUpperCase());
  const out = {};
  for (const s of list) { out[s] = get(s) || { error: "Not found" }; }
  res.json(out);
});
app.get("/api/crypto/:coin",(req,res)=>{
  const v = get(String(req.params.coin||"").toUpperCase());
  if (!v) return res.status(404).json({ error: "Not found" }); res.json(v);
});

app.get("/api/metals",(req,res)=>{
  const list = (req.query.list || Object.keys(METALS_API_MAP).join(",")).split(",").map(s=>s.trim().toUpperCase());
  const out = {};
  for (const m of list) out[m] = get(m) || { error: "Not found" };
  res.json(out);
});
app.get("/api/metals/:metal",(req,res)=>{
  const metal = String(req.params.metal||"").toUpperCase();
  const v = get(metal);
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v);
});

app.get("/api/energy",(req,res)=>{ const list = (req.query.list || "WTI,BRENT,NATGAS").split(",").map(s=>s.trim().toUpperCase()); const out = {}; for (const n of list) out[n] = get(n) || { error: "Not found" }; res.json(out); });
app.get("/api/oilgas/wti",(req,res)=>{ const v = get("WTI"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });
app.get("/api/oilgas/brent",(req,res)=>{ const v = get("BRENT"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });
app.get("/api/oilgas/gas",(req,res)=>{ const v = get("NATGAS"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });

// ---------- admin ----------
function okAdmin(req){ const t = req.headers["x-admin-token"] || req.query.token || req.body?.token; return String(t) === String(ADMIN_TOKEN); }
app.get("/api/cache",(req,res)=>{ if(!okAdmin(req)) return res.status(401).json({ error:"unauthorized"}); res.json({ prices: cache.prices, lastUpdate: cache.lastUpdate, historyKeys: Object.keys(cache.history||{}) }); });
app.post("/api/admin/set",(req,res)=>{ if(!okAdmin(req)) return res.status(401).json({ error:"unauthorized"}); const { symbol, price, unit="usd" } = req.body || {}; if (!symbol || !price) return res.status(400).json({ error:"symbol and price required" }); put(String(symbol).toUpperCase(), Number(price), unit, "manual"); res.json({ ok:true, saved: cache.prices[String(symbol).toUpperCase()] }); });
app.post("/api/admin/refresh",(req,res)=>{ if(!okAdmin(req)) return res.status(401).json({ error:"unauthorized"}); const what = String(req.body?.what || "all").toLowerCase(); const tasks = []; if (what==="all"||what==="gold") tasks.push(updateGold()); if (what==="all"||what==="silver") tasks.push(updateSilver()); if (what==="all"||what==="crypto") tasks.push(updateCryptoFromCoinGecko()); if (what==="all"||what==="fx") tasks.push(updateFX("USD","EGP")); if (what==="all"||what==="metals") tasks.push(updateAllSelectedMetalsOnce()); if (what==="all"||what==="energy") tasks.push(updateEnergy()); Promise.allSettled(tasks).then(()=>res.json({ ok:true, lastUpdate: cache.lastUpdate })); });
app.post("/api/admin/cache/clear",(req,res)=>{ if(!okAdmin(req)) return res.status(401).json({ error:"unauthorized"}); cache.prices = {}; saveCache(); res.json({ ok:true }); });

// ---------- start ----------
app.listen(PORT, ()=>console.log(`Backend running on :${PORT}`));
