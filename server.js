// server.js - consolidated, fixed and focused on silver + metals.dev usage
import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
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
const EXR_HOST = process.env.EXR_HOST || "https://api.exchangerate.host";
const METALS_DEV_API_KEY = process.env.METALS_DEV_API_KEY || ""; // generic key
const METALS_DEV_KEY1 = process.env.METALS_DEV_KEY1 || ""; // optional key1
const METALS_DEV_KEY2 = process.env.METALS_DEV_KEY2 || ""; // optional key2
const SLX_BSC_TOKEN = (process.env.SLX_BSC_TOKEN || "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d").toLowerCase();
const SLX_PAIR_ADDRESS = (process.env.SLX_PAIR_ADDRESS || "0x7c755e961a8d415c4074bc7d3ba0b85f039c5168").toLowerCase();

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "x-admin-token"] }));
app.options("*", cors());
app.use(express.static(__dirname));

// ---------- cache ----------
let cache = {
  prices: {},
  lastUpdate: {},
  rotate: { gold: 0, silver: 0, crypto: 0, fx: 0, slxLoop: 0, silverLoop: 0, metalsLoop: {} },
  history: {}
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

// ---------- sites.json load (must be valid JSON) ----------
let SITES = {
  gold: ["twelvedata:XAU/USD","yahoo:XAUUSD=X","kitco:gold","thestreetgold:gold"],
  silver: ["scrape:saudigold:silver","metalsdev"],
  crypto: ["binancews:BTCUSDT,ETHUSDT","coingecko:bitcoin,ethereum,cardano,solana,binancecoin,ripple,tron,dogecoin,polkadot,chainlink","coincap:bitcoin,ethereum,cardano,solana,binancecoin,ripple,tron,dogecoin,polkadot,chainlink","dexscreener:SLX"],
  fx: ["exchangeratehost:USD,EGP","frankfurter:USD,EGP","alphavantage:USD,EGP"],
  metals: {},
  energy: { wti: ["alphavantage:WTI","yahoo:CL=F"], brent: ["alphavantage:BRENT","yahoo:BRN=F"], natgas: ["alphavantage:NATGAS","yahoo:NG=F"] }
};
try {
  if (fs.existsSync(SITES_FILE)) {
    const j = JSON.parse(fs.readFileSync(SITES_FILE, "utf-8"));
    SITES = { ...SITES, ...j };
  }
} catch (e) {
  console.error("load sites.json error", e.message || e);
}

// ---------- helpers ----------
const now = () => Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const weekend = () => { const d = new Date(); const day = d.getUTCDay(); return day === 0 || day === 6; };
function isValidNumber(n) { if (n === null || n === undefined) return false; const num = Number(n); if (!Number.isFinite(num)) return false; if (num <= 0) return false; if (num > 1e12) return false; return true; }
function todayISO() { return new Date().toISOString().slice(0,10); }

// put with daily history (one entry per day, keep 30 days)
function put(symbol, price, unit="usd", src="unknown") {
  try {
    if (!isValidNumber(price)) return;
    const num = Number(price);
    cache.prices[symbol] = { price: num, unit, src, t: now() };
    cache.history = cache.history || {};
    const hist = cache.history[symbol] || [];
    const today = todayISO();
    if (!hist.length || hist[hist.length-1].date !== today) {
      hist.push({ date: today, value: num });
      const MAX_DAYS = 30;
      if (hist.length > MAX_DAYS) hist.splice(0, hist.length - MAX_DAYS);
      cache.history[symbol] = hist;
    } else {
      hist[hist.length-1].value = num;
      cache.history[symbol] = hist;
    }
    saveCache();
  } catch (e) { console.error("put error", e.message || e); }
}
function get(symbol) { return cache.prices[symbol] || null; }

// fetch helpers
async function getJSON(url, opts={}, retries=1) {
  let err;
  for (let i=0;i<=retries;i++){
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { err = e; await sleep(250); }
  }
  throw err;
}
async function getText(url, opts={}, retries=1) {
  let err;
  for (let i=0;i<=retries;i++){
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) { err = e; await sleep(250); }
  }
  throw err;
}
function parsePriceCandidates(text, {min=0.01, max=1e9}={}) {
  if (!text || typeof text !== "string") return null;
  const matches = text.match(/(\d{1,3}(?:[,\d]{0,})?(?:\.\d+)?|\d+\.\d+)/g);
  if (!matches) return null;
  for (const m of matches) {
    const cleaned = m.replace(/,/g,"");
    const num = Number(cleaned);
    if (Number.isFinite(num) && num >= min && num <= max) return num;
  }
  return null;
}

// ---------- source resolvers ----------
// TwelveData
async function fromTwelveData(pair) {
  if (!TWELVEDATA_KEY) throw new Error("no TWELVEDATA_KEY");
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(pair)}&apikey=${TWELVEDATA_KEY}`;
  const j = await getJSON(url);
  const v = Number(j?.price);
  if (!v) throw new Error("TD no price");
  return v;
}
// Yahoo
async function fromYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?region=US&lang=en-US`;
  const j = await getJSON(url);
  const v = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!v) throw new Error("Yahoo no price");
  return Number(v);
}
// Kitco quick
async function fromKitco(metal) {
  const map = { gold: "gold-price-today-usa", silver: "silver-price-today-usa" };
  const slug = map[metal] || "";
  if (!slug) throw new Error("kitco unknown");
  const html = await getText(`https://www.kitco.com/${slug}.html`);
  const $ = cheerio.load(html);
  let txt = ($("span:contains(USD)").first().text() || $("td:contains(USD)").first().text() || "").replace(/[^\d.]/g,"");
  const v = Number(txt);
  if (!v) throw new Error("Kitco parse fail");
  return v;
}
// Metals.dev generic (use key selection logic below)
async function callMetalsDev(metal, key) {
  const apiKey = key || METALS_DEV_API_KEY || METALS_DEV_KEY1 || METALS_DEV_KEY2;
  if (!apiKey) throw new Error("no metals.dev key");
  const url = `https://api.metals.dev/v1/metal/spot?api_key=${encodeURIComponent(apiKey)}&metal=${encodeURIComponent(metal)}&currency=USD`;
  const j = await getJSON(url, {}, 1);
  const price = Number(j?.rate?.price || j?.rate?.ask || j?.rate?.bid || j?.rate?.close || j?.rate?.last);
  if (!price) throw new Error("MetalsDev no price");
  return { price, raw: j };
}
async function fromMetalsDev(metal) {
  // try available keys in order
  const keys = [METALS_DEV_API_KEY, METALS_DEV_KEY1, METALS_DEV_KEY2].filter(Boolean);
  if (!keys.length) throw new Error("no METALS_DEV key");
  for (const k of keys) {
    try {
      const r = await callMetalsDev(metal, k);
      return r.price;
    } catch (e) {
      // try next key
    }
  }
  throw new Error("MetalsDev all keys failed");
}

// Generic scraping helpers and targeted scrapers
async function genericScrape(url, {min=0.01, max=1e8}={}) {
  const html = await getText(url, {}, 1);
  const $ = cheerio.load(html);
  const text = $("body").text();
  const v = parsePriceCandidates(text, {min, max});
  if (!v) throw new Error("generic scrape fail");
  return v;
}
async function fromSaudiGoldSilver() {
  // targeted: saudigoldprice silver page
  const url = "https://saudigoldprice.com/silverprice/";
  const html = await getText(url, {}, 1);
  const $ = cheerio.load(html);
  // try common selectors for number
  const selectors = ["#ctl00_ContentPlaceHolder1_lblSpotPrice","div.price","span.price","div#price","p.price"];
  for (const sel of selectors) {
    const t = $(sel).first().text();
    const num = parsePriceCandidates(t, {min:0.1, max:1e7});
    if (num) return num;
  }
  // fallback to body parse
  const text = $("body").text();
  const v = parsePriceCandidates(text, {min:0.1, max:1e7});
  if (!v) throw new Error("saudigold parse fail");
  return v;
}
// investing/marketwatch/tradingeconomics targeted wrappers (used only if needed)
async function fromInvestingSilver() { return await genericScrape("https://www.investing.com/commodities/silver", {min:0.1, max:1e7}); }
async function fromMarketWatchSilver() { return await genericScrape("https://www.marketwatch.com/investing/future/silver", {min:0.1, max:1e7}); }
async function fromTradingEconomicsSilver() { return await genericScrape("https://tradingeconomics.com/commodity/silver", {min:0.1, max:1e7}); }

// dex / geckoterminal
async function fromDexScreenerByToken(token) {
  const j = await getJSON(`https://api.dexscreener.com/latest/dex/search?q=${token}`);
  const pair = j?.pairs?.[0];
  const v = Number(pair?.priceUsd);
  if (!v) throw new Error("DexScreener no price");
  return v;
}
async function fromDexScreenerByPair(pairAddress) {
  const url = `https://api.dexscreener.com/latest/dex/pairs/bsc/${pairAddress.toLowerCase()}`;
  const j = await getJSON(url, {}, 1);
  const pair = j?.pairs?.[0];
  const v = Number(pair?.priceUsd);
  if (!v) throw new Error("DexScreener pair no price");
  return v;
}
async function fromGeckoTerminal(tokenAddress) {
  const url = `https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${tokenAddress.toLowerCase()}`;
  const j = await getJSON(url, {}, 1);
  const v = Number(j?.data?.attributes?.price_usd || j?.data?.attributes?.price);
  if (!v) throw new Error("GeckoTerminal no price");
  return v;
}
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

// ---------- crypto WS ----------
const wsPrices = new Map();
function startBinanceWS(symbols = ["btcusdt","ethusdt"]) {
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
    ws.on("close", () => setTimeout(()=>startBinanceWS(symbols),3000));
    ws.on("error", () => ws.close());
  } catch (err) { console.error("WS error:", err.message || err); }
}
startBinanceWS();

// ---------- rotation helper ----------
function pickRotate(group) {
  const list = Array.isArray(SITES[group]) ? SITES[group] : null;
  if (!list || !list.length) return null;
  const idx = (cache.rotate[group] || 0) % list.length;
  const src = list[idx];
  cache.rotate[group] = (idx + 1) % list.length;
  saveCache();
  return src;
}

// ---------- update routines ----------
// Gold + Silver (silver will have its custom loop elsewhere too)
async function updateGold() {
  if (weekend()) return;
  const src = pickRotate("gold");
  if (!src) return;
  try {
    let price = null, unit="oz";
    if (src.startsWith("twelvedata:")) price = await fromTwelveData(src.split(":")[1]);
    else if (src.startsWith("yahoo:")) price = await fromYahoo(src.split(":")[1]);
    else if (src.startsWith("kitco:")) price = await fromKitco("gold");
    else if (src.startsWith("thestreetgold:")) price = await genericScrape("https://www.thestreet.com/quote/gold-price");
    if (price) { put("GOLD", price, unit, src); cache.lastUpdate.gold = now(); saveCache(); }
  } catch (e) {}
}

// This is fallback/rotation; but we also run the dedicated silver loop (below)
async function updateSilver() {
  if (weekend()) return;
  const src = pickRotate("silver");
  if (!src) return;
  try {
    let price = null, unit="oz";
    if (src.startsWith("twelvedata:")) price = await fromTwelveData(src.split(":")[1]);
    else if (src.startsWith("yahoo:")) price = await fromYahoo(src.split(":")[1]);
    else if (src === "metalsdev") price = await fromMetalsDev("silver");
    else if (src.startsWith("scrape:")) {
      // supported: scrape:saudigold:silver
      const parts = src.split(":");
      const site = parts[1];
      if (site === "saudigold") price = await fromSaudiGoldSilver();
      else price = await genericScrape("https://www.investing.com/commodities/silver");
    }
    if (price) { put("SILVER", price, unit, src); cache.lastUpdate.silver = now(); saveCache(); }
  } catch (e) {}
}

// Crypto update (expanded list from sites.json)
async function updateCrypto() {
  const src = pickRotate("crypto");
  if (!src) return;
  try {
    if (src.startsWith("binancews:")) {
      const btc = wsPrices.get("BTCUSDT"); if (btc) put("BTC", btc, "usd", "binancews");
      const eth = wsPrices.get("ETHUSDT"); if (eth) put("ETH", eth, "usd", "binancews");
    } else if (src.startsWith("coingecko:")) {
      const ids = src.split(":")[1];
      const j = await fromCoinGecko(ids);
      Object.entries(j).forEach(([k,v]) => put(k, v, "usd", "coingecko"));
    } else if (src.startsWith("coincap:")) {
      const ids = src.split(":")[1].split(",");
      for (const id of ids) {
        try { const v = await fromCoinCap(id); put(id.toUpperCase(), v, "usd", "coincap"); } catch {}
      }
    } else if (src.startsWith("dexscreener:")) {
      const v = await fromDexScreenerByToken(SLX_BSC_TOKEN); if (v) put("SLX", v, "usd", "dexscreener");
    }
    cache.lastUpdate.crypto = now(); saveCache();
  } catch (e) {}
}

// FX update
async function updateFX(base="USD", quote="EGP") {
  const src = pickRotate("fx");
  if (!src) return;
  try {
    if (src.startsWith("exchangeratehost:")) {
      const j = await getJSON(`${EXR_HOST}/convert?from=${base}&to=${quote}`);
      const val = Number(j?.result); if (val) put(`FX_${base}_${quote}`, val, "rate", "ERH");
    } else if (src.startsWith("frankfurter:")) {
      const j = await getJSON(`https://api.frankfurter.app/latest?from=${base}&to=${quote}`);
      const val = Number(j?.rates?.[quote]); if (val) put(`FX_${base}_${quote}`, val, "rate", "Frankfurter");
    } else if (src.startsWith("alphavantage:")) {
      if (!ALPHAVANTAGE_KEY) throw new Error("no ALPHAVANTAGE_KEY");
      const j = await getJSON(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${base}&to_currency=${quote}&apikey=${ALPHAVANTAGE_KEY}`);
      const val = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
      if (val) put(`FX_${base}_${quote}`, val, "rate", "AlphaVantage");
    }
    cache.lastUpdate.fx = now(); saveCache();
  } catch (e) {}
}

// original generic metals rotation (kept but metals configured to use metals.dev)
async function updateMetals() {
  const m = SITES.metals || {};
  for (const [name, sources] of Object.entries(m)) {
    let got = false;
    for (const src of sources) {
      try {
        let v = null, unit = "oz";
        if (src === "metalsdev") {
          v = await fromMetalsDev(name);
        } else if (src.startsWith("yahoo:")) {
          v = await fromYahoo(src.split(":")[1]);
        }
        if (v) { put(name.toUpperCase(), v, unit, src); got = true; break; }
      } catch (e) {}
    }
    // do not fallback to generic scrapes for metals (as you requested)
  }
  cache.lastUpdate.metals = now(); saveCache();
}

// energy update (kept)
async function updateEnergy() {
  const e = SITES.energy || {};
  for (const [name, sources] of Object.entries(e)) {
    for (const src of sources) {
      try {
        let v = null;
        if (src.startsWith("alphavantage:")) {
          // placeholder - you'd implement fromAlphaEnergy if needed
        } else if (src.startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]);
        if (v) { put(name.toUpperCase(), v, "usd", src); break; }
      } catch (e) {}
    }
  }
  cache.lastUpdate.energy = now(); saveCache();
}

// ---------- SLX loop ----------
const SLX_SOURCES = [
  { type: "geckoterminal", fn: async () => await fromGeckoTerminal(SLX_BSC_TOKEN) },
  { type: "dex_pair", fn: async () => await fromDexScreenerByPair(SLX_PAIR_ADDRESS) },
  { type: "dex_token", fn: async () => await fromDexScreenerByToken(SLX_BSC_TOKEN) },
  { type: "coincap", fn: async () => await fromCoinCap("silverx") }
];
async function updateSLXOnce() {
  const start = cache.rotate.slxLoop || 0;
  for (let i=0;i<SLX_SOURCES.length;i++){
    const idx = (start + i) % SLX_SOURCES.length;
    const src = SLX_SOURCES[idx];
    try {
      const price = await src.fn();
      if (isValidNumber(price)) {
        put("SLX", price, "usd", src.type);
        cache.lastUpdate.slx = now();
        cache.rotate.slxLoop = (idx + 1) % SLX_SOURCES.length;
        saveCache(); return;
      }
    } catch (e) {}
  }
}

// ---------- Silver dedicated loop (scrape saudigold every 5 min + metals.dev every 8 hours) ----------
async function updateSilverScrapeOnce() {
  // try saudigold first
  try {
    const p = await fromSaudiGoldSilver();
    if (isValidNumber(p)) { put("SILVER", p, "usd", "scrape:saudigold"); cache.lastUpdate.silver = now(); saveCache(); return; }
  } catch (e) { /* continue */ }
  // if not, try metals.dev
  try {
    const p2 = await fromMetalsDev("silver");
    if (isValidNumber(p2)) { put("SILVER", p2, "usd", "metalsdev"); cache.lastUpdate.silver = now(); saveCache(); return; }
  } catch (e) {}
}
function startSilverLoop() {
  // run immediate then schedule
  updateSilverScrapeOnce().catch(()=>{});
  setInterval(()=>updateSilverScrapeOnce().catch(()=>{}), 5 * 60 * 1000); // every 5 minutes
  // metals.dev hourly/8h schedule already attempted in updateSilverScrapeOnce fallback; we also schedule 8h update to ensure
  if (METALS_DEV_API_KEY || METALS_DEV_KEY1 || METALS_DEV_KEY2) {
    setInterval(()=> {
      (async()=>{
        try {
          const p = await fromMetalsDev("silver");
          if (isValidNumber(p)) { put("SILVER", p, "usd", "metalsdev"); cache.lastUpdate.silver = now(); saveCache(); }
        } catch(e){}
      })();
    }, 8 * 60 * 60 * 1000); // every 8 hours
  }
}

// ---------- Metals loops using metals.dev every 22 hours (per your instruction) ----------
const METALS_TO_LOOP = Object.keys(SITES.metals || {});

async function updateMetalOnceFromMetalsDev(metalKey) {
  try {
    const p = await fromMetalsDev(metalKey.toLowerCase());
    if (isValidNumber(p)) { put(metalKey.toUpperCase(), p, "usd", "metalsdev"); cache.lastUpdate[metalKey] = now(); saveCache(); }
  } catch (e) { /* ignore */ }
}
function startMetalsLoops() {
  for (const metal of METALS_TO_LOOP) {
    // initial run
    updateMetalOnceFromMetalsDev(metal).catch(()=>{});
    // schedule every 22 hours
    setInterval(()=> updateMetalOnceFromMetalsDev(metal).catch(()=>{}), 22 * 60 * 60 * 1000);
  }
}

// ---------- schedules ----------
setInterval(()=>{ updateGold(); updateSilver(); updateCrypto(); }, 210 * 1000); // 3.5m
setInterval(()=> updateFX("USD","EGP"), 2 * 60 * 60 * 1000); // 2h
setInterval(()=> updateMetals(), 3 * 60 * 60 * 1000); // kept generic run as safety
setInterval(()=> updateEnergy(), 5 * 60 * 60 * 1000);

// start loops
startSLXLoop();
startSilverLoop();
startMetalsLoops();

// immediate bootstrap
updateGold();
updateSilver();
updateCrypto();
updateFX("USD","EGP");
updateMetals();
updateEnergy();

// ---------- history / chart / change endpoints ----------
app.get("/api/history/:symbol", (req,res)=>{
  const symbol = String(req.params.symbol || "").toUpperCase();
  const hist = cache.history && cache.history[symbol] ? cache.history[symbol] : [];
  res.json({ symbol, history: hist });
});
app.get("/api/chart/:symbol", (req,res)=>{
  const symbol = String(req.params.symbol || "").toUpperCase();
  const days = Math.min(90, Number(req.query.days || 30));
  const hist = (cache.history && cache.history[symbol]) || [];
  res.json({ symbol, data: hist.slice(-days) });
});
app.get("/api/change/:symbol", (req,res)=>{
  const symbol = String(req.params.symbol || "").toUpperCase();
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
  } catch (e) { return res.json({ symbol, change_percent: 0 }); }
});

// ---------- existing APIs (kept) ----------
app.get("/api/health", (req,res) => res.json({ ok:true, ts:Date.now(), lastUpdate: cache.lastUpdate }));
app.get("/api/status", (req,res) => res.json({ ok:true, ts:Date.now(), lastUpdate: cache.lastUpdate }));

app.get("/api/gold",(req,res)=>{ const v = get("GOLD"); if (!v) return res.status(404).json({ error:"Not found" }); res.json(v); });
app.get("/api/silver",(req,res)=>{ const v = get("SILVER"); if (!v) return res.status(404).json({ error:"Not found" }); res.json(v); });

app.get("/api/crypto", (req,res)=>{
  const list = (req.query.list || "BTC,ETH,SLX").split(",").map(s=>s.trim().toUpperCase());
  const out = {};
  for (const s of list) { const v = get(s); out[s] = v || { error:"Not found" }; }
  res.json(out);
});
app.get("/api/crypto/silverx",(req,res)=>{ const v = get("SLX"); if (!v) return res.status(404).json({ error:"Not found" }); res.json(v); });

app.get("/api/fx",(req,res)=>{ const from = (req.query.from||"USD").toUpperCase(); const to = (req.query.to||"EGP").toUpperCase(); const v = get(`FX_${from}_${to}`); if (!v) return res.status(404).json({ error:"Not found" }); res.json({ from, to, ...v }); });

app.get("/api/metals",(req,res)=>{
  const list = (req.query.list || Object.keys(SITES.metals || {}).join(",") || "platinum,palladium,copper,aluminum,nickel,zinc,lead").split(",").map(s=>s.trim().toUpperCase());
  const out = {};
  for (const m of list) out[m] = get(m) || { error: "Not found" };
  res.json(out);
});
app.get("/api/metals/:metal",(req,res)=>{ const metal = String(req.params.metal||"").toUpperCase(); const v = get(metal); if (!v) return res.status(404).json({ error:"Not found" }); res.json(v); });

app.get("/api/energy",(req,res)=>{ const list = (req.query.list || "wti,brent,natgas").split(",").map(s=>s.trim().toUpperCase()); const out = {}; for (const n of list) out[n]=get(n)||{error:"Not found"}; res.json(out); });

// ---------- admin ----------
function okAdmin(req) { const t = req.headers["x-admin-token"] || req.query.token || req.body?.token; return String(t) === String(ADMIN_TOKEN); }
app.get("/api/cache", (req,res)=>{ if (!okAdmin(req)) return res.status(401).json({ error:"unauthorized" }); res.json({ prices: cache.prices, lastUpdate: cache.lastUpdate, historyKeys: Object.keys(cache.history||{}) }); });
app.post("/api/admin/set",(req,res)=>{ if (!okAdmin(req)) return res.status(401).json({ error:"unauthorized" }); const { symbol, price, unit="usd" } = req.body||{}; if (!symbol || !price) return res.status(400).json({ error:"symbol and price required" }); put(String(symbol).toUpperCase(), Number(price), unit, "manual"); res.json({ ok:true, saved: cache.prices[String(symbol).toUpperCase()] }); });
app.post("/api/admin/refresh",(req,res)=>{ if (!okAdmin(req)) return res.status(401).json({ error:"unauthorized" }); const what = String(req.body?.what || "all").toLowerCase(); const tasks = []; if (what==="all"||what==="gold") tasks.push(updateGold()); if (what==="all"||what==="silver") tasks.push(updateSilver()); if (what==="all"||what==="crypto") tasks.push(updateCrypto()); if (what==="all"||what==="fx") tasks.push(updateFX("USD","EGP")); if (what==="all"||what==="metals") tasks.push(updateMetals()); if (what==="all"||what==="energy") tasks.push(updateEnergy()); Promise.allSettled(tasks).then(()=>res.json({ ok:true, lastUpdate: cache.lastUpdate })); });
app.post("/api/admin/cache/clear",(req,res)=>{ if (!okAdmin(req)) return res.status(401).json({ error:"unauthorized" }); cache.prices={}; saveCache(); res.json({ ok:true }); });

// ---------- start ----------
app.listen(PORT, ()=>console.log(`Backend running on :${PORT}`));
