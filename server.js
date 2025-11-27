// server.js - fixed & complete
// SLX loop, Silver loop, metals scraping loops, 30-day history + chart/change endpoints
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
const EXCHANGEHOST_KEY = process.env.EXCHANGEHOST_KEY || "";
const METALS_DEV_API_KEY = process.env.METALS_DEV_API_KEY || ""; // metals.dev key
const SLX_BSC_TOKEN = process.env.SLX_BSC_TOKEN || "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d";
const SLX_PAIR_ADDRESS = process.env.SLX_PAIR_ADDRESS || "0x7c755e961a8d415c4074bc7d3ba0b85f039c5168";

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "x-admin-token"] }));
app.options("*", cors());
app.use(express.static(__dirname));

// ---------- persisted cache (prices + history) ----------
let cache = {
  prices: {},
  lastUpdate: {},
  rotate: {
    gold: 0,
    silver: 0,
    crypto: 0,
    fx: 0,
    slxLoop: 0,
    silverLoop: 0,
    metalsLoop: {},
  },
  history: {}, // symbol -> [{date, value}]
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

// ---------- sites (rotation plan) ----------
let SITES = {
  gold: ["twelvedata:XAU/USD", "yahoo:XAUUSD=X", "kitco:gold", "thestreetgold:gold"],
  silver: ["twelvedata:XAG/USD", "yahoo:XAGUSD=X", "kitco:silver"],
  crypto: ["binancews:BTCUSDT,ETHUSDT", "coingecko:bitcoin,ethereum", "coincap:bitcoin,ethereum", "dexscreener:SLX"],
  fx: ["exchangeratehost:USD,EGP", "frankfurter:USD,EGP", "alphavantage:USD,EGP"],
  metals: {}, // user-provided via sites.json (we rely on it)
  energy: { wti: ["alphavantage:WTI", "yahoo:CL=F"], brent: ["alphavantage:BRENT", "yahoo:BRN=F"], natgas: ["alphavantage:NATGAS", "yahoo:NG=F"] },
};

try {
  if (fs.existsSync(SITES_FILE)) {
    const j = JSON.parse(fs.readFileSync(SITES_FILE, "utf-8"));
    SITES = { ...SITES, ...j };
  }
} catch (e) {
  console.error("load sites.json error", e.message);
}

// ---------- helpers ----------
const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const weekend = () => { const d = new Date(); const day = d.getUTCDay(); return day === 0 || day === 6; };
function isValidNumber(n) { if (n === null || n === undefined) return false; const num = Number(n); if (!Number.isFinite(num)) return false; if (num <= 0) return false; if (num > 1e9) return false; return true; }
function todayISO() { const d = new Date(); return d.toISOString().slice(0, 10); }

// put: updates cache.prices and appends daily history (max 30 days)
function put(symbol, price, unit = "usd", src = "unknown") {
  try {
    if (!isValidNumber(price)) return;
    const num = Number(price);
    cache.prices[symbol] = { price: num, unit, src, t: now() };
    cache.history = cache.history || {};
    const hist = cache.history[symbol] || [];
    const today = todayISO();
    if (!hist.length || hist[hist.length - 1].date !== today) {
      hist.push({ date: today, value: num });
      const MAX_DAYS = 30;
      if (hist.length > MAX_DAYS) hist.splice(0, hist.length - MAX_DAYS);
      cache.history[symbol] = hist;
    } else {
      hist[hist.length - 1].value = num;
      cache.history[symbol] = hist;
    }
    saveCache();
  } catch (e) {
    console.error("put error", e.message);
  }
}
function get(symbol) { return cache.prices[symbol] || null; }

// fetch helpers
async function getJSON(url, opts = {}, retries = 1) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      lastErr = err;
      await sleep(250);
    }
  }
  throw lastErr;
}
async function getText(url, opts = {}, retries = 1) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (err) {
      lastErr = err;
      await sleep(250);
    }
  }
  throw lastErr;
}
function parsePriceCandidates(text, { min = 0.01, max = 1e7 } = {}) {
  if (!text || typeof text !== "string") return null;
  const matches = text.match(/(\d{1,3}(?:[,\d]{0,})?(?:\.\d+)?|\d+\.\d+)/g);
  if (!matches) return null;
  for (const m of matches) {
    const cleaned = m.replace(/,/g, "");
    const num = Number(cleaned);
    if (Number.isFinite(num) && num >= min && num <= max) return num;
  }
  return null;
}

// ---------- source resolvers ----------
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
async function fromKitco(metal) {
  const map = { gold: "gold-price-today-usa", silver: "silver-price-today-usa" };
  const slug = map[metal] || "gold-price-today-usa";
  const html = await getText(`https://www.kitco.com/${slug}.html`);
  const $ = cheerio.load(html);
  let txt = ($("span:contains(USD)").first().text() || $("td:contains(USD)").first().text() || "").replace(/[^\d.]/g, "");
  const v = Number(txt);
  if (!v) throw new Error("Kitco parse fail");
  return v;
}
async function fromCoinGecko(ids) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
  const j = await getJSON(url);
  const out = {};
  ids.split(",").forEach((id) => { const v = Number(j?.[id]?.usd); if (v) out[id.toUpperCase()] = v; });
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
async function fromMetalsDev(metal) {
  if (!METALS_DEV_API_KEY) throw new Error("no METALS_DEV_API_KEY");
  const url = `https://api.metals.dev/v1/metal/spot?api_key=${encodeURIComponent(METALS_DEV_API_KEY)}&metal=${encodeURIComponent(metal)}&currency=USD`;
  const j = await getJSON(url, {}, 1);
  const price = Number(j?.rate?.price || j?.rate?.ask || j?.rate?.bid);
  if (!price) throw new Error("MetalsDev no price");
  return price;
}
async function genericScrape(url) {
  const html = await getText(url, {}, 1);
  const $ = cheerio.load(html);
  const text = $("body").text();
  const v = parsePriceCandidates(text, { min: 0.01, max: 1e7 });
  if (!v) throw new Error("generic scrape fail");
  return v;
}
async function fromSaudiGoldSilver() { return await genericScrape("https://saudigoldprice.com/silverprice/"); }
async function fromInvestingSilver() { return await genericScrape("https://www.investing.com/commodities/silver"); }
async function fromMarketWatchSilver() { return await genericScrape("https://www.marketwatch.com/investing/future/silver"); }
async function fromTradingEconomicsSilver() { return await genericScrape("https://tradingeconomics.com/commodity/silver"); }

async function fromScrapeSite(site, metal) {
  const map = {
    tradingview: (m) => `https://www.tradingview.com/symbols/${m.toUpperCase()}/`,
    investing: (m) => `https://www.investing.com/search/?q=${encodeURIComponent(m)}`,
    tradingeconomics: (m) => `https://tradingeconomics.com/commodity/${encodeURIComponent(m)}`,
    fxnewstoday: (m) => `https://fxnewstoday.com/?s=${encodeURIComponent(m)}`,
    dailyforex: (m) => `https://www.dailyforex.com/search?search=${encodeURIComponent(m)}`,
    arincen: (m) => `https://www.arincen.com/?s=${encodeURIComponent(m)}`,
    bloomberg: (m) => `https://www.bloomberg.com/search?query=${encodeURIComponent(m)}`,
    marketwatch: (m) => `https://www.marketwatch.com/search?q=${encodeURIComponent(m)}`,
    goldmaker: (m) => `https://goldmaker.fr/?s=${encodeURIComponent(m)}`,
    kitco: (m) => `https://www.kitco.com/${m === "silver" ? "silver-price-today-usa" : ""}`,
  };
  const builder = map[site];
  if (!builder) throw new Error("unknown scrape site");
  const url = builder(metal);
  return await genericScrape(url);
}

// ---------- crypto WS ----------
const wsPrices = new Map();
function startBinanceWS(symbols = ["btcusdt", "ethusdt"]) {
  try {
    const streams = symbols.map((s) => `${s}@ticker`).join("/");
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    ws.on("message", (buf) => {
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
async function updateGold() {
  if (weekend()) return;
  let src = pickRotate("gold");
  if (!src) return;
  let price = null, unit = "oz", used = src;
  try {
    if (src.startsWith("twelvedata:")) price = await fromTwelveData(src.split(":")[1]);
    else if (src.startsWith("yahoo:")) price = await fromYahoo(src.split(":")[1]);
    else if (src.startsWith("kitco:")) price = await fromKitco("gold");
    else price = await genericScrape("https://www.thestreet.com/quote/gold-price");
    if (price) { put("GOLD", price, unit, used); cache.lastUpdate.gold = now(); saveCache(); }
  } catch {}
}

async function updateSilver() {
  if (weekend()) return;
  let src = pickRotate("silver");
  if (!src) return;
  let price = null, unit = "oz", used = src;
  try {
    if (src.startsWith("twelvedata:")) price = await fromTwelveData(src.split(":")[1]);
    else if (src.startsWith("yahoo:")) price = await fromYahoo(src.split(":")[1]);
    else if (src.startsWith("kitco:")) price = await fromKitco("silver");
    if (!price) {
      try { price = await fromKitco("silver"); used = "kitco-fallback"; } catch {}
    }
    if (price) { put("SILVER", price, unit, used); cache.lastUpdate.silver = now(); saveCache(); }
  } catch {}
}

async function updateCrypto() {
  let src = pickRotate("crypto");
  if (!src) return;
  try {
    if (src.startsWith("binancews:")) {
      const btc = wsPrices.get("BTCUSDT"); const eth = wsPrices.get("ETHUSDT");
      if (btc) put("BTC", btc, "usd", "binancews");
      if (eth) put("ETH", eth, "usd", "binancews");
    } else if (src.startsWith("coingecko:")) {
      const ids = "bitcoin,ethereum,ripple,cardano,solana";
      const j = await fromCoinGecko(ids);
      if (j.BITCOIN) put("BTC", j.BITCOIN, "usd", "coingecko");
      if (j.ETHEREUM) put("ETH", j.ETHEREUM, "usd", "coingecko");
      if (j.RIPPLE) put("XRP", j.RIPPLE, "usd", "coingecko");
      if (j.CARDANO) put("ADA", j.CARDANO, "usd", "coingecko");
      if (j.SOLANA) put("SOL", j.SOLANA, "usd", "coingecko");
    } else if (src.startsWith("coincap:")) {
      const BTC = await fromCoinCap("bitcoin"); const ETH = await fromCoinCap("ethereum");
      const XRP = await fromCoinCap("ripple"); const ADA = await fromCoinCap("cardano");
      const SOL = await fromCoinCap("solana");
      if (BTC) put("BTC", BTC, "usd", "coincap");
      if (ETH) put("ETH", ETH, "usd", "coincap");
      if (XRP) put("XRP", XRP, "usd", "coincap");
      if (ADA) put("ADA", ADA, "usd", "coincap");
      if (SOL) put("SOL", SOL, "usd", "coincap");
    } else if (src.startsWith("dexscreener:")) {
      const v = await fromDexScreenerByToken(SLX_BSC_TOKEN);
      if (v) put("SLX", v, "usd", "dexscreener");
    }
    cache.lastUpdate.crypto = now(); saveCache();
  } catch {}
}

async function updateFX(base = "USD", quote = "EGP") {
  let src = pickRotate("fx");
  if (!src) return;
  try {
    if (src.startsWith("exchangeratehost:")) {
      const v = await getJSON(`${process.env.EXR_HOST || "https://api.exchangerate.host"}/convert?from=${base}&to=${quote}`);
      const val = Number(v?.result);
      if (val) put(`FX_${base}_${quote}`, val, "rate", "ERH");
    } else if (src.startsWith("frankfurter:")) {
      const v = await getJSON(`https://api.frankfurter.dev/latest?from=${base}&to=${quote}`);
      const val = Number(v?.rates?.[quote]);
      if (val) put(`FX_${base}_${quote}`, val, "rate", "Frankfurter");
    } else if (src.startsWith("alphavantage:")) {
      if (!ALPHAVANTAGE_KEY) throw new Error("no ALPHAVANTAGE_KEY");
      const j = await getJSON(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${base}&to_currency=${quote}&apikey=${ALPHAVANTAGE_KEY}`);
      const val = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
      if (val) put(`FX_${base}_${quote}`, val, "rate", "AlphaVantage");
    }
    cache.lastUpdate.fx = now(); saveCache();
  } catch {}
}

// ---------- SLX loop ----------
const SLX_SOURCES = [
  { type: "geckoterminal", fn: async () => await fromGeckoTerminal(SLX_BSC_TOKEN) },
  { type: "dex_pair", fn: async () => await fromDexScreenerByPair(SLX_PAIR_ADDRESS) },
  { type: "dex_token", fn: async () => await fromDexScreenerByToken(SLX_BSC_TOKEN) },
  { type: "coincap", fn: async () => await fromCoinCap("silverx") },
];
async function updateSLXOnce() {
  const startIdx = cache.rotate.slxLoop || 0;
  for (let i = 0; i < SLX_SOURCES.length; i++) {
    const idx = (startIdx + i) % SLX_SOURCES.length;
    const src = SLX_SOURCES[idx];
    try {
      const price = await src.fn();
      if (isValidNumber(price)) {
        put("SLX", price, "usd", src.type);
        cache.lastUpdate.slx = now();
        cache.rotate.slxLoop = (idx + 1) % SLX_SOURCES.length;
        saveCache();
        return;
      }
    } catch (e) {}
  }
}
function startSLXLoop() { updateSLXOnce().catch(()=>{}); setInterval(()=>updateSLXOnce().catch(()=>{}), 5*60*1000); }

// ---------- Silver loop ----------
const SILVER_SCRAPE_SOURCES = [
  { name: "saudigold", fn: fromSaudiGoldSilver },
  { name: "investing", fn: fromInvestingSilver },
  { name: "marketwatch", fn: fromMarketWatchSilver },
  { name: "tradingeconomics", fn: fromTradingEconomicsSilver },
  { name: "kitco", fn: async () => await fromKitco("silver") },
];
async function updateSilverScrapeOnce() {
  const list = SILVER_SCRAPE_SOURCES;
  if (!list.length) return;
  const idx = cache.rotate.silverLoop || 0;
  for (let i = 0; i < list.length; i++) {
    const pick = (idx + i) % list.length;
    const src = list[pick];
    try {
      const price = await src.fn();
      if (isValidNumber(price)) {
        put("SILVER", price, "usd", `scrape:${src.name}`);
        cache.lastUpdate.silver = now();
        cache.rotate.silverLoop = (pick + 1) % list.length;
        saveCache();
        return;
      }
    } catch (e) {}
  }
}
async function updateSilverFromMetalsDev() {
  try {
    const price = await fromMetalsDev("silver");
    if (isValidNumber(price)) { put("SILVER", price, "usd", "metals.dev"); cache.lastUpdate.silver = now(); saveCache(); }
  } catch (e) {}
}
function startSilverLoop() {
  updateSilverScrapeOnce().catch(()=>{});
  setInterval(()=>updateSilverScrapeOnce().catch(()=>{}), 40*60*1000);
  if (METALS_DEV_API_KEY) { updateSilverFromMetalsDev().catch(()=>{}); setInterval(()=>updateSilverFromMetalsDev().catch(()=>{}), 6*60*60*1000); }
}

// ---------- metals loops (list) ----------
const METALS_TO_LOOP = ["ZINC","LEAD","PLATINUM","PALLADIUM","COBALT","NICKEL","COPPER"];

function buildMetalSourcesFromSites(metalKey) {
  const keyLower = metalKey.toLowerCase();
  const configured = (SITES.metals && (SITES.metals[keyLower] || SITES.metals[metalKey.toLowerCase()])) || null;
  const out = [];
  if (configured && Array.isArray(configured)) {
    for (const s of configured) {
      if (typeof s === "string") {
        if (s.startsWith("scrape:")) {
          const parts = s.split(":"); const site = parts[1]; const metal = parts[2] || keyLower;
          out.push({ name: `scrape:${site}`, fn: async () => await fromScrapeSite(site, metal) });
        } else if (s.startsWith("yahoo:")) out.push({ name: "yahoo", fn: async () => await fromYahoo(s.split(":")[1]) });
        else if (s.startsWith("twelvedata:")) out.push({ name: "twelvedata", fn: async () => await fromTwelveData(s.split(":")[1]) });
        else if (s === "metalsdev") out.push({ name: "metalsdev", fn: async () => await fromMetalsDev(keyLower) });
      }
    }
  }
  if (!out.length) {
    if (METALS_DEV_API_KEY) out.push({ name: "metalsdev", fn: async () => await fromMetalsDev(keyLower) });
    // yahoo fallback: many tickers are like XPTUSD=X, XPDUSD=X or <SYMBOL>=F
    if (keyLower === "platinum") out.push({ name: "yahoo", fn: async () => await fromYahoo("XPTUSD=X") });
    else if (keyLower === "palladium") out.push({ name: "yahoo", fn: async () => await fromYahoo("XPDUSD=X") });
    else if (keyLower === "copper") out.push({ name: "yahoo", fn: async () => await fromYahoo("HG=F") });
    else out.push({ name: "yahoo", fn: async () => await fromYahoo(`${keyLower}=F`) });
    out.push({ name: "metalary", fn: async () => await genericScrape(`https://www.metalary.com/${keyLower}-price/`) });
  }
  return out;
}

async function updateMetalOnce(metalKey) {
  const list = buildMetalSourcesFromSites(metalKey);
  if (!list || !list.length) return;
  cache.rotate.metalsLoop = cache.rotate.metalsLoop || {};
  const idx = cache.rotate.metalsLoop[metalKey] || 0;
  for (let i = 0; i < list.length; i++) {
    const pick = (idx + i) % list.length;
    const src = list[pick];
    try {
      const price = await src.fn();
      if (isValidNumber(price)) {
        put(metalKey, price, "usd", `loop:${src.name}`);
        cache.lastUpdate[metalKey] = now();
        cache.rotate.metalsLoop[metalKey] = (pick + 1) % list.length;
        saveCache();
        return;
      }
    } catch (e) {}
  }
}

// ---------- newly added: updateMetals (keeps original SITES.metals rotation + fallback) ----------
async function updateMetals() {
  const m = SITES.metals || {};
  for (const [name, sources] of Object.entries(m)) {
    let got = false;
    for (const src of sources || []) {
      try {
        let v = null;
        if (typeof src === "string") {
          if (src.startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]);
          else if (src.startsWith("twelvedata:")) v = await fromTwelveData(src.split(":")[1]);
          else if (src.startsWith("scrape:")) {
            const parts = src.split(":"); const site = parts[1]; const metal = parts[2] || name;
            v = await fromScrapeSite(site, metal);
          } else if (src === "metalsdev") v = await fromMetalsDev(name.toLowerCase());
        }
        if (v && isValidNumber(v)) {
          put(name.toUpperCase(), v, "oz", src);
          got = true;
          break;
        }
      } catch (e) {}
    }
    if (!got) {
      try {
        const v2 = await genericScrape(`https://www.metalary.com/${name.toLowerCase()}-price/`);
        if (isValidNumber(v2)) { put(name.toUpperCase(), v2, "oz", "metalary-fallback"); got = true; }
      } catch (e) {}
    }
  }
  cache.lastUpdate.metals = now();
  saveCache();
}

// ---------- updateEnergy ----------
async function updateEnergy() {
  const e = SITES.energy || {};
  for (const [name, sources] of Object.entries(e)) {
    let got = false;
    for (const src of sources || []) {
      try {
        let v = null;
        if (typeof src === "string") {
          if (src.startsWith("twelvedata:")) v = await fromTwelveData(src.split(":")[1]);
          else if (src.startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]);
          else if (src.startsWith("alphavantage:")) {
            if (!ALPHAVANTAGE_KEY) throw new Error("no ALPHAVANTAGE_KEY");
            // AlphaVantage may require different query; try TIME_SERIES_INTRADAY for futures symbol fallback
            // Fallback: use yahoo if alphavantage not returning
            // We'll attempt to call a generic Alpha endpoint for commodity (best-effort)
            // For reliability we prefer Yahoo fallback:
            // (skip alphavantage complex handling to avoid blocking; rely on yahoo)
          }
        }
        if (!v) {
          if (src && String(src).startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]);
        }
        if (v && isValidNumber(v)) {
          put(name.toUpperCase(), v, "usd", src);
          got = true;
          break;
        }
      } catch (e) {}
    }
    if (!got) {
      // fallback: try yahoo generic
      try {
        const fallbackTicker = name === "wti" ? "CL=F" : name === "brent" ? "BRN=F" : "NG=F";
        const v2 = await fromYahoo(fallbackTicker);
        if (isValidNumber(v2)) { put(name.toUpperCase(), v2, "usd", `yahoo-fallback:${fallbackTicker}`); got = true; }
      } catch (e) {}
    }
  }
  cache.lastUpdate.energy = now();
  saveCache();
}

// ---------- start loops ----------
function startMetalsLoops() {
  for (const metal of METALS_TO_LOOP) {
    updateMetalOnce(metal).catch(()=>{});
    setInterval(()=>updateMetalOnce(metal).catch(()=>{}), 60*60*1000); // 1 hour
  }
}
function startAllLoops() {
  startSLXLoop();
  startSilverLoop();
  startMetalsLoops();
}
startAllLoops();

// ---------- schedules (existing + new) ----------
setInterval(()=>{ updateGold(); updateSilver(); updateCrypto(); }, 210*1000); // 3.5 min
setInterval(()=>updateFX("USD","EGP"), 2*60*60*1000); // 2 hours
setInterval(()=>updateMetals(), 3*60*60*1000); // 3 hours (keeps original generic metals rotation)
setInterval(()=>updateEnergy(), 5*60*60*1000); // 5 hours

// initial kickoff
updateGold(); updateSilver(); updateCrypto(); updateFX("USD","EGP"); updateMetals(); updateEnergy();

// ---------- history / chart / change endpoints ----------
app.get("/api/history/:symbol", (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const hist = cache.history && cache.history[symbol] ? cache.history[symbol] : [];
  res.json({ symbol, history: hist });
});
app.get("/api/chart/:symbol", (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const days = Math.min(90, Number(req.query.days || 30));
  const hist = (cache.history && cache.history[symbol]) || [];
  const out = hist.slice(-days);
  res.json({ symbol, data: out });
});
app.get("/api/change/:symbol", (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const period = req.query.period || "24h";
  const hist = (cache.history && cache.history[symbol]) || [];
  if (!hist.length) return res.json({ symbol, change_percent: 0 });
  if (period.endsWith("h")) {
    const hrs = Number(period.slice(0,-1));
    if (hrs <= 24) {
      if (hist.length < 2) return res.json({ symbol, change_percent: 0 });
      const last = hist[hist.length-1].value; const prev = hist[hist.length-2].value;
      const change = ((last - prev) / prev) * 100;
      return res.json({ symbol, change_percent: Number(change.toFixed(4)) });
    } else {
      const daysBack = Math.round(Number(period.slice(0,-1)) / 24);
      const idx = Math.max(0, hist.length - 1 - daysBack);
      const last = hist[hist.length-1].value; const prev = hist[idx].value;
      const change = ((last - prev) / prev) * 100;
      return res.json({ symbol, change_percent: Number(change.toFixed(4)) });
    }
  } else if (period.endsWith("d")) {
    const days = Number(period.slice(0,-1));
    const idx = Math.max(0, hist.length - 1 - days);
    const last = hist[hist.length-1].value; const prev = hist[idx].value;
    const change = ((last - prev) / prev) * 100;
    return res.json({ symbol, change_percent: Number(change.toFixed(4)) });
  } else return res.json({ symbol, change_percent: 0 });
});

// ---------- existing APIs ----------
app.get("/api/health", (req,res)=> res.json({ ok:true, ts: Date.now(), lastUpdate: cache.lastUpdate }));
app.get("/api/status", (req,res)=> res.json({ ok:true, ts: Date.now(), lastUpdate: cache.lastUpdate }));

app.get("/api/gold", (req,res)=> { const v = get("GOLD"); if(!v) return res.status(404).json({ error:"Not found" }); res.json(v); });
app.get("/api/silver", (req,res)=> { const v = get("SILVER"); if(!v) return res.status(404).json({ error:"Not found" }); res.json(v); });
app.get("/api/crypto", (req,res)=> {
  const list = (req.query.list || "BTC,ETH,SLX").split(",").map(s=>s.trim().toUpperCase());
  const out = {};
  for (const s of list) { const v = get(s); out[s] = v || { error: "Not found" }; }
  res.json(out);
});
app.get("/api/crypto/bitcoin", (req,res)=> { const v = get("BTC"); if(!v) return res.status(404).json({ error:"Not found" }); res.json(v); });
app.get("/api/crypto/ethereum", (req,res)=> { const v = get("ETH"); if(!v) return res.status(404).json({ error:"Not found" }); res.json(v); });
app.get("/api/crypto/silverx", (req,res)=> { const v = get("SLX"); if(!v) return res.status(404).json({ error:"Not found" }); res.json(v); });

app.get("/api/fx", (req,res)=> {
  const from = (req.query.from || "USD").toUpperCase();
  const to = (req.query.to || "EGP").toUpperCase();
  const v = get(`FX_${from}_${to}`);
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json({ from, to, ...v });
});

app.get("/api/metals", (req,res)=> {
  const list = (req.query.list || "platinum,palladium,copper,aluminum,nickel,zinc,lead,tin,iron,steel,cobalt,lithium,uranium").split(",").map(s=>s.trim().toUpperCase());
  const out = {};
  for (const m of list) out[m] = get(m) || { error: "Not found" };
  res.json(out);
});
app.get("/api/metals/:metal", (req,res)=> { const metal = String(req.params.metal || "").toUpperCase(); const v = get(metal); if(!v) return res.status(404).json({ error:"Not found" }); res.json(v); });

app.get("/api/energy", (req,res)=> {
  const list = (req.query.list || "wti,brent,natgas").split(",").map(s=>s.trim().toUpperCase());
  const out = {};
  for (const n of list) out[n] = get(n) || { error: "Not found" };
  res.json(out);
});
app.get("/api/oilgas/wti", (req,res)=> { const v = get("WTI"); if(!v) return res.status(404).json({ error:"Not found" }); res.json(v); });
app.get("/api/oilgas/brent", (req,res)=> { const v = get("BRENT"); if(!v) return res.status(404).json({ error:"Not found" }); res.json(v); });
app.get("/api/oilgas/gas", (req,res)=> { const v = get("NATGAS"); if(!v) return res.status(404).json({ error:"Not found" }); res.json(v); });

// ---------- Admin ----------
function okAdmin(req) { const t = req.headers["x-admin-token"] || req.query.token || req.body?.token; return String(t) === String(ADMIN_TOKEN); }
app.get("/api/cache", (req,res)=> { if(!okAdmin(req)) return res.status(401).json({ error:"unauthorized" }); res.json({ prices: cache.prices, lastUpdate: cache.lastUpdate, historyKeys: Object.keys(cache.history || {}) }); });
app.post("/api/admin/set", (req,res)=> {
  if(!okAdmin(req)) return res.status(401).json({ error:"unauthorized" });
  const { symbol, price, unit = "usd" } = req.body || {};
  if(!symbol || !price) return res.status(400).json({ error:"symbol and price required" });
  put(String(symbol).toUpperCase(), Number(price), unit, "manual");
  res.json({ ok: true, saved: cache.prices[String(symbol).toUpperCase()] });
});
app.post("/api/admin/refresh", (req,res)=> {
  if(!okAdmin(req)) return res.status(401).json({ error:"unauthorized" });
  const what = String(req.body?.what || "all").toLowerCase();
  const tasks = [];
  if (what === "all" || what === "gold") tasks.push(updateGold());
  if (what === "all" || what === "silver") tasks.push(updateSilver());
  if (what === "all" || what === "crypto") tasks.push(updateCrypto());
  if (what === "all" || what === "fx") tasks.push(updateFX("USD","EGP"));
  if (what === "all" || what === "metals") tasks.push(updateMetals());
  if (what === "all" || what === "energy") tasks.push(updateEnergy());
  Promise.allSettled(tasks).then(()=> res.json({ ok:true, lastUpdate: cache.lastUpdate }));
});
app.post("/api/admin/cache/clear", (req,res)=> { if(!okAdmin(req)) return res.status(401).json({ error:"unauthorized" }); cache.prices = {}; saveCache(); res.json({ ok:true }); });

// ---------- start ----------
app.listen(PORT, ()=> console.log(`Backend running on :${PORT}`));
