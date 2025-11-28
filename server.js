// server.js - final consolidated version
// Features:
// - SLX loop (geckoterminal / dexscreener pair / dexscreener token / coincap)
// - Silver: scrape SaudigoldPrice every 5 minutes + metals.dev every 8 hours
// - Metals: specific metals updated from metals.dev API keys (22 hours) or Yahoo fallback
// - Crypto: top 10 coins via CoinGecko + Binance WS for BTC/ETH realtime
// - 30-day daily history cache (for chart / change endpoints)
// - Admin endpoints, existing APIs preserved
// - Care to define all referenced functions to avoid ReferenceError
//
// ENV variables used:
// PORT, ADMIN_TOKEN, TWELVEDATA_KEY, ALPHAVANTAGE_KEY, EXR_HOST,
// METALS_DEV_KEY1, METALS_DEV_KEY2, METALS_DEV_API_KEY (fallback),
// SLX_BSC_TOKEN, SLX_PAIR_ADDRESS
//
// Dependencies: express, node-fetch, cheerio, ws, cors, fs, path
// package.json should include those.

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
const METALS_DEV_KEY1 = process.env.METALS_DEV_KEY1 || ""; // for zinc/aluminum/copper example
const METALS_DEV_KEY2 = process.env.METALS_DEV_KEY2 || ""; // for lead/nickel/platinum/palladium
const METALS_DEV_API_KEY = process.env.METALS_DEV_API_KEY || ""; // fallback single key
const SLX_BSC_TOKEN = (process.env.SLX_BSC_TOKEN || "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d").toLowerCase();
const SLX_PAIR_ADDRESS = (process.env.SLX_PAIR_ADDRESS || "0x7c755e961a8d415c4074bc7d3ba0b85f039c5168").toLowerCase();

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-admin-token"],
  })
);
app.options("*", cors());
app.use(express.static(__dirname));

// ---------- persisted cache (prices + history) ----------
let cache = {
  prices: {}, // symbol -> {price, unit, src, t}
  lastUpdate: {}, // group/symbol -> timestamp
  rotate: {
    gold: 0,
    silver: 0,
    crypto: 0,
    fx: 0,
    slxLoop: 0,
    silverLoop: 0,
    metalsLoop: {}, // per-metal index
  },
  history: {}, // symbol -> [{date, value}] (daily snapshots up to N days)
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

// ---------- sites (rotation plan) ----------
let SITES = {
  gold: [
    "twelvedata:XAU/USD",
    "yahoo:XAUUSD=X",
    "kitco:gold",
    "thestreetgold:gold",
  ],
  silver: ["scrape:saudigold:silver", "metalsdev:silver"], // prefer scrape first, then metals.dev
  crypto: [
    "binancews:BTCUSDT,ETHUSDT",
    "coingecko:bitcoin,ethereum,binancecoin,cardano,solana,ripple,dogecoin,litecoin,polkadot,chainlink",
    "coincap:bitcoin,ethereum",
    "dexscreener:SLX",
  ],
  fx: ["exchangeratehost:USD,EGP", "frankfurter:USD,EGP", "alphavantage:USD,EGP"],
  metals: {
    // default list - can be replaced by sites.json uploaded by user
    zinc: ["metalsdev:zinc", "yahoo:MZN=F"],
    aluminum: ["metalsdev:aluminum", "yahoo:ALI=F"],
    copper: ["metalsdev:copper", "yahoo:HG=F"],
    lead: ["metalsdev:lead", "yahoo:LD=F"],
    nickel: ["metalsdev:nickel", "yahoo:NID=F"],
    platinum: ["metalsdev:platinum", "yahoo:XPTUSD=X"],
    palladium: ["metalsdev:palladium", "yahoo:XPDUSD=X"],
    cobalt: ["yahoo:CO=F"],
    lithium: ["yahoo:LIT=F"],
    uranium: ["yahoo:UX=F"],
    tin: ["yahoo:TIN=F"],
    iron: ["yahoo:TIO=F"],
    steel: ["yahoo:STL=F"],
  },
  energy: {
    wti: ["alphavantage:WTI", "yahoo:CL=F"],
    brent: ["alphavantage:BRENT", "yahoo:BRN=F"],
    natgas: ["alphavantage:NATGAS", "yahoo:NG=F"],
  },
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const weekend = () => {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun,6=Sat
  return day === 0 || day === 6;
};
function isValidNumber(n) {
  if (n === null || n === undefined) return false;
  const num = Number(n);
  if (!Number.isFinite(num)) return false;
  if (num <= 0) return false;
  if (num > 1e9) return false;
  return true;
}
function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// put: updates cache.prices and appends daily history (max 30 days)
function put(symbol, price, unit = "usd", src = "unknown") {
  try {
    if (!isValidNumber(price)) return;
    const num = Number(price);
    cache.prices[symbol] = { price: num, unit, src, t: now() };
    // history: append one entry per day (if latest entry date !== today)
    cache.history = cache.history || {};
    const hist = cache.history[symbol] || [];
    const today = todayISO();
    if (!hist.length || hist[hist.length - 1].date !== today) {
      hist.push({ date: today, value: num });
      // keep only last N days (30)
      const MAX_DAYS = 30;
      if (hist.length > MAX_DAYS) hist.splice(0, hist.length - MAX_DAYS);
      cache.history[symbol] = hist;
    } else {
      // replace today's value with latest (keep one entry per day)
      hist[hist.length - 1].value = num;
      cache.history[symbol] = hist;
    }
    saveCache();
  } catch (e) {
    console.error("put error", e.message || e);
  }
}
function get(symbol) {
  return cache.prices[symbol] || null;
}

// text/JSON fetch helpers
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

// try find numeric candidates in page text
function parsePriceCandidates(text, { min = 0.01, max = 1e7 } = {}) {
  if (!text || typeof text !== "string") return null;
  const matches = text.match(/(\d{1,3}(?:[,\d]{0,})?(?:\.\d+)?|\d+\.\d+)/g);
  if (!matches) return null;
  // prefer numbers with decimals and not "1" repeated; return first plausible
  for (const m of matches) {
    const cleaned = m.replace(/,/g, "");
    const num = Number(cleaned);
    if (Number.isFinite(num) && num >= min && num <= max) return num;
  }
  return null;
}

// ---------- source resolvers (kept + new) ----------

// twelvedata
async function fromTwelveData(pair) {
  if (!TWELVEDATA_KEY) throw new Error("no TWELVEDATA_KEY");
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(pair)}&apikey=${TWELVEDATA_KEY}`;
  const j = await getJSON(url);
  const v = Number(j?.price);
  if (!v) throw new Error("TD no price");
  return v;
}
// yahoo
async function fromYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?region=US&lang=en-US`;
  const j = await getJSON(url);
  const v = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!v) throw new Error("Yahoo no price");
  return Number(v);
}
// kitco
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
async function fromTheStreetGold() {
  const html = await getText("https://www.thestreet.com/quote/gold-price");
  const $ = cheerio.load(html);
  let txt = $("*[data-test='last-price']").first().text().replace(/[^\d.]/g, "");
  const v = Number(txt);
  if (!v) throw new Error("TheStreetGold parse fail");
  return v;
}

// fallback simple scrapper used for metals when others fail
async function fromMetalFallback(name) {
  const slug = `${name.toLowerCase()}-price`;
  const url = `https://www.metalary.com/${slug}/`;
  const html = await getText(url);
  const $ = cheerio.load(html);
  let txt = $("body").text();
  const p = parsePriceCandidates(txt, { min: 0.1, max: 1e7 });
  if (!p) throw new Error("Metalary parse fail");
  return p;
}

// alpha energy / fx helpers
async function fromAlphaEnergy(symbol) {
  if (!ALPHAVANTAGE_KEY) throw new Error("no ALPHAVANTAGE_KEY");
  // For WTI/Brent/NATGAS assume custom endpoints (Alpha Vantage might not have direct)
  // Use a generic time series query if available - fallback to error if not present.
  const url = `https://www.alphavantage.co/query?function=COMMODITY_EXCHANGE_RATE&symbol=${symbol}&apikey=${ALPHAVANTAGE_KEY}`;
  try {
    const j = await getJSON(url);
    // attempt to find a numeric in response
    const text = JSON.stringify(j);
    const p = parsePriceCandidates(text, { min: 0.01, max: 1e6 });
    if (!p) throw new Error("AlphaEnergy parse fail");
    return p;
  } catch (e) {
    throw new Error("AlphaEnergy fail");
  }
}
async function fromAlphaFX(base, quote) {
  if (!ALPHAVANTAGE_KEY) throw new Error("no ALPHAVANTAGE_KEY");
  const j = await getJSON(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${base}&to_currency=${quote}&apikey=${ALPHAVANTAGE_KEY}`);
  const val = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
  if (!val) throw new Error("AlphaFX no price");
  return val;
}
async function fromExchangeRateHost(base, quote) {
  const j = await getJSON(`${EXR_HOST}/convert?from=${base}&to=${quote}`);
  const val = Number(j?.result);
  if (!val) throw new Error("ERH no price");
  return val;
}
async function fromFrankfurter(base, quote) {
  const j = await getJSON(`https://api.frankfurter.app/latest?from=${base}&to=${quote}`);
  const val = Number(j?.rates?.[quote]);
  if (!val) throw new Error("Frankfurter no price");
  return val;
}

// coin gecko simple
async function fromCoinGecko(ids) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
  const j = await getJSON(url);
  const out = {};
  ids.split(",").forEach((id) => {
    const v = Number(j?.[id]?.usd);
    if (v) out[id.toUpperCase()] = v;
  });
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
  const v = Number(j?.data?.attributes?.price_usd || j?.data?.attributes?.priceUsd);
  if (!v) throw new Error("GeckoTerminal no price");
  return v;
}

// metals.dev wrapper that supports two keys per user request and long polling intervals
async function fromMetalsDevWithKey(metal, keySelector = 1) {
  const key =
    (keySelector === 1 && METALS_DEV_KEY1) ||
    (keySelector === 2 && METALS_DEV_KEY2) ||
    METALS_DEV_API_KEY ||
    "";
  if (!key) throw new Error("no metals.dev key");
  const url = `https://api.metals.dev/v1/metal/spot?api_key=${encodeURIComponent(key)}&metal=${encodeURIComponent(metal)}&currency=USD`;
  const j = await getJSON(url, {}, 1);
  const price = Number(j?.rate?.price || j?.rate?.ask || j?.rate?.bid || j?.rate?.last);
  if (!price) throw new Error("MetalsDev no price");
  return price;
}

// generic scrapers (we rely on parsePriceCandidates on page body)
async function genericScrape(url) {
  const html = await getText(url, {}, 1);
  const $ = cheerio.load(html);
  const text = $("body").text();
  const v = parsePriceCandidates(text, { min: 0.01, max: 1e8 });
  if (!v) throw new Error("generic scrape fail");
  return v;
}

// specific scraper for saudigoldprice.com/silverprice/ (target: silver)
async function fromSaudiGoldSilver() {
  // This function attempts targeted extraction from saudigoldprice.com
  try {
    const url = "https://saudigoldprice.com/silverprice/";
    const html = await getText(url, {}, 1);
    const $ = cheerio.load(html);
    // Try find table cell that includes "أونصة الفضة" or "سعر أونصة الفضة" or numbers in first table.
    let candidate = null;
    // 1) common selectors: table rows with numbers
    $("table, tbody, tr, td").each((i, el) => {
      const txt = $(el).text().replace(/\s+/g, " ").trim();
      if (!candidate) {
        // look for Arabic 'الفضة' and number nearby
        if (/الفضة|فِضة|سعر أونصة الفضة|أونصة الفضة/i.test(txt)) {
          const found = parsePriceCandidates(txt, { min: 1, max: 1e6 });
          if (found) candidate = found;
        }
      }
    });
    // 2) fallback: search any text on page for a number that seems plausible (1..1000)
    if (!candidate) {
      const textBody = $("body").text();
      candidate = parsePriceCandidates(textBody, { min: 1, max: 1e6 });
    }
    if (!candidate) throw new Error("saudigold parse fail");
    return candidate;
  } catch (e) {
    throw new Error("saudigold parse fail");
  }
}

// additional site-specific scrapers (if used later)
async function fromInvestingSilver() {
  return await genericScrape("https://www.investing.com/commodities/silver");
}
async function fromMarketWatchSilver() {
  return await genericScrape("https://www.marketwatch.com/investing/future/silver");
}
async function fromTradingEconomicsSilver() {
  return await genericScrape("https://tradingeconomics.com/commodity/silver");
}

// generic scrapers for other metals using SITES entries (scrape:site:metal)
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
    saudigold: (m) => `https://saudigoldprice.com/${m === "silver" ? "silverprice/" : ""}`,
  };
  const builder = map[site];
  if (!builder) throw new Error("unknown scrape site");
  const url = builder(metal);
  return await genericScrape(url);
}

// ---------- crypto WS (unchanged) ----------
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
    console.error("WS error:", err.message || err);
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

// ---------- update routines (original kept, run as before) ----------

async function updateGold() {
  if (weekend()) return;
  let src = pickRotate("gold");
  if (!src) return;
  let price = null,
    unit = "oz",
    used = src;
  try {
    if (src.startsWith("twelvedata:")) price = await fromTwelveData(src.split(":")[1]);
    else if (src.startsWith("yahoo:")) price = await fromYahoo(src.split(":")[1]);
    else if (src.startsWith("kitco:")) price = await fromKitco("gold");
    else if (src.startsWith("thestreetgold:")) price = await fromTheStreetGold();
    if (price && isValidNumber(price)) {
      put("GOLD", price, unit, used);
      cache.lastUpdate.gold = now();
      saveCache();
    }
  } catch (e) {
    // ignore
  }
}

async function updateSilver_originalRotation() {
  // keep original rotation in SITES.silver if present (but we also run enhanced silver loop)
  if (weekend()) return;
  let src = Array.isArray(SITES.silver) ? SITES.silver[cache.rotate.silver % SITES.silver.length] : null;
  if (!src) return;
  let price = null,
    unit = "oz",
    used = src;
  try {
    if (typeof src === "string" && src.startsWith("twelvedata:")) price = await fromTwelveData(src.split(":")[1]);
    else if (typeof src === "string" && src.startsWith("yahoo:")) price = await fromYahoo(src.split(":")[1]);
    else if (typeof src === "string" && src.startsWith("kitco:")) price = await fromKitco("silver");
    if (price && isValidNumber(price)) {
      put("SILVER", price, unit, used);
      cache.lastUpdate.silver = now();
      saveCache();
    }
  } catch (e) {
    // ignore
  }
}

// crypto update (expanded to top 10)
async function updateCrypto() {
  let src = pickRotate("crypto");
  if (!src) return;
  try {
    if (src.startsWith("binancews:")) {
      const btc = wsPrices.get("BTCUSDT");
      const eth = wsPrices.get("ETHUSDT");
      if (btc) put("BTC", btc, "usd", "binancews");
      if (eth) put("ETH", eth, "usd", "binancews");
    } else if (src.startsWith("coingecko:")) {
      const ids = src.split(":")[1]; // expecting comma-separated ids
      const j = await fromCoinGecko(ids);
      // map common ids to symbols
      const map = {
        bitcoin: "BTC",
        ethereum: "ETH",
        binancecoin: "BNB",
        cardano: "ADA",
        solana: "SOL",
        ripple: "XRP",
        dogecoin: "DOGE",
        litecoin: "LTC",
        polkadot: "DOT",
        chainlink: "LINK",
      };
      Object.entries(map).forEach(([id, symbol]) => {
        if (j[id.toUpperCase()]) put(symbol, j[id.toUpperCase()], "usd", "coingecko");
      });
    } else if (src.startsWith("coincap:")) {
      const BTC = await fromCoinCap("bitcoin");
      const ETH = await fromCoinCap("ethereum");
      if (BTC) put("BTC", BTC, "usd", "coincap");
      if (ETH) put("ETH", ETH, "usd", "coincap");
    } else if (src.startsWith("dexscreener:")) {
      try {
        const v = await fromDexScreenerByToken(SLX_BSC_TOKEN);
        if (v) put("SLX", v, "usd", "dexscreener");
      } catch {}
    }
    cache.lastUpdate.crypto = now();
    saveCache();
  } catch (e) {
    // ignore
  }
}

async function updateFX(base = "USD", quote = "EGP") {
  let src = pickRotate("fx");
  if (!src) return;
  try {
    if (src.startsWith("exchangeratehost:")) {
      const v = await fromExchangeRateHost(base, quote);
      put(`FX_${base}_${quote}`, v, "rate", "ERH");
    } else if (src.startsWith("frankfurter:")) {
      const v = await fromFrankfurter(base, quote);
      put(`FX_${base}_${quote}`, v, "rate", "Frankfurter");
    } else if (src.startsWith("alphavantage:")) {
      const v = await fromAlphaFX(base, quote);
      put(`FX_${base}_${quote}`, v, "rate", "AlphaVantage");
    }
    cache.lastUpdate.fx = now();
    saveCache();
  } catch (e) {
    // ignore
  }
}

// ---------- metals update using metals.dev keys (22 hours) ----------
async function updateMetals() {
  // Iterate configured SITES.metals and prefer metals.dev entries if present.
  const m = SITES.metals || {};
  for (const [name, sources] of Object.entries(m)) {
    let got = false;
    // If site sources include metalsdev with explicit key token, use that; else default mapping:
    try {
      // Try metals.dev with key selection by grouping:
      const lower = name.toLowerCase();
      // group assignment per user: zinc, aluminum, copper => KEY1; lead,nickel,platinum,palladium => KEY2
      const group1 = ["zinc", "aluminum", "copper"];
      const group2 = ["lead", "nickel", "platinum", "palladium"];
      let price = null;
      if (group1.includes(lower) && (METALS_DEV_KEY1 || METALS_DEV_API_KEY)) {
        price = await fromMetalsDevWithKey(lower, 1);
        if (isValidNumber(price)) {
          put(name.toUpperCase(), price, "usd", "metals.dev:key1");
          got = true;
        }
      } else if (group2.includes(lower) && (METALS_DEV_KEY2 || METALS_DEV_API_KEY)) {
        price = await fromMetalsDevWithKey(lower, 2);
        if (isValidNumber(price)) {
          put(name.toUpperCase(), price, "usd", "metals.dev:key2");
          got = true;
        }
      } else if (METALS_DEV_API_KEY) {
        // fallback single key
        price = await fromMetalsDevWithKey(lower, 0);
        if (isValidNumber(price)) {
          put(name.toUpperCase(), price, "usd", "metals.dev");
          got = true;
        }
      }
      // If not gotten yet, try configured sources (yahoo / others) in order
      if (!got && Array.isArray(sources)) {
        for (const src of sources) {
          try {
            if (typeof src === "string" && src.startsWith("yahoo:")) {
              const v = await fromYahoo(src.split(":")[1]);
              if (isValidNumber(v)) {
                put(name.toUpperCase(), v, "usd", src);
                got = true;
                break;
              }
            } else if (typeof src === "string" && src.startsWith("twelvedata:")) {
              const v = await fromTwelveData(src.split(":")[1]);
              if (isValidNumber(v)) {
                put(name.toUpperCase(), v, "usd", src);
                got = true;
                break;
              }
            } else if (typeof src === "string" && src.startsWith("scrape:")) {
              // format scrape:site:metal
              const parts = src.split(":");
              const site = parts[1];
              const metal = parts[2] || name.toLowerCase();
              const v = await fromScrapeSite(site, metal);
              if (isValidNumber(v)) {
                put(name.toUpperCase(), v, "usd", `scrape:${site}`);
                got = true;
                break;
              }
            }
          } catch (e) {
            // continue to next source
          }
        }
      }
      // if still not got, try metalary fallback
      if (!got) {
        try {
          const v2 = await fromMetalFallback(name);
          if (isValidNumber(v2)) {
            put(name.toUpperCase(), v2, "usd", "metalary-fallback");
            got = true;
          }
        } catch {}
      }
    } catch (e) {
      // ignore per-metal failures
    }
    // continue to next metal
  }
  cache.lastUpdate.metals = now();
  saveCache();
}

// update energy (kept)
async function updateEnergy() {
  const e = SITES.energy || {};
  for (const [name, sources] of Object.entries(e)) {
    let got = false;
    for (const src of sources) {
      try {
        let v = null;
        if (src === "alphavantage:WTI") v = await fromAlphaEnergy("WTI");
        else if (src === "alphavantage:BRENT") v = await fromAlphaEnergy("BRENT");
        else if (src === "alphavantage:NATGAS") v = await fromAlphaEnergy("NATGAS");
        else if (src.startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]);
        if (v && isValidNumber(v)) {
          put(name.toUpperCase(), v, "usd", src);
          got = true;
          break;
        }
      } catch {}
    }
  }
  cache.lastUpdate.energy = now();
  saveCache();
}

// ---------- SLX loop (4-source rotation) ----------
const SLX_SOURCES = [
  { type: "geckoterminal", fn: async () => await fromGeckoTerminal(SLX_BSC_TOKEN) },
  { type: "dex_pair", fn: async () => await fromDexScreenerByPair(SLX_PAIR_ADDRESS) },
  { type: "dex_token", fn: async () => await fromDexScreenerByToken(SLX_BSC_TOKEN) },
  { type: "coincap", fn: async () => await fromCoinCap("silverx") },
];

async function updateSLXOnce() {
  let idx = cache.rotate.slxLoop || 0;
  for (let i = 0; i < SLX_SOURCES.length; i++) {
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
    } catch (e) {
      // continue
    }
  }
  // nothing succeeded -> keep old cached value
}
function startSLXLoop() {
  updateSLXOnce().catch(() => {});
  setInterval(() => {
    updateSLXOnce().catch(() => {});
  }, 5 * 60 * 1000); // every 5 minutes
}

// ---------- Silver loop implementation ----------
// We'll run targeted saudigold scrape every 5 minutes; metals.dev every 8 hours if key present.
async function updateSilverScrapeOnce() {
  const list = [
    { name: "saudigold", fn: fromSaudiGoldSilver },
    { name: "investing", fn: fromInvestingSilver },
    { name: "marketwatch", fn: fromMarketWatchSilver },
    { name: "tradingeconomics", fn: fromTradingEconomicsSilver },
    { name: "kitco", fn: async () => await fromKitco("silver") },
  ];
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
    } catch (e) {
      // continue
    }
  }
}
async function updateSilverFromMetalsDev() {
  try {
    const price =
      (METALS_DEV_KEY1 && await fromMetalsDevWithKey("silver", 1)) ||
      (METALS_DEV_KEY2 && await fromMetalsDevWithKey("silver", 2)) ||
      (METALS_DEV_API_KEY && await fromMetalsDevWithKey("silver", 0));
    if (isValidNumber(price)) {
      put("SILVER", price, "usd", "metals.dev");
      cache.lastUpdate.silver = now();
      saveCache();
    }
  } catch (e) {
    // ignore
  }
}
function startSilverLoop() {
  // run scrape rotate every 5 minutes (user asked frequent scrape)
  updateSilverScrapeOnce().catch(() => {});
  setInterval(() => updateSilverScrapeOnce().catch(() => {}), 5 * 60 * 1000); // every 5 minutes

  // run metals.dev every ~8 hours (if key present)
  if (METALS_DEV_KEY1 || METALS_DEV_KEY2 || METALS_DEV_API_KEY) {
    updateSilverFromMetalsDev().catch(() => {});
    setInterval(() => updateSilverFromMetalsDev().catch(() => {}), 8 * 60 * 60 * 1000); // every 8 hours
  }
}

// ---------- start loops for metals (we will schedule updateMetals periodically) ----------
function startMetalsLoops() {
  // updateMetals will use metals.dev keys for the mapped metals every 22 hours
  updateMetals().catch(() => {});
  // schedule 22 hours (22 * 3600 * 1000)
  setInterval(() => updateMetals().catch(() => {}), 22 * 60 * 60 * 1000);
}

// ---------- schedules (existing + new loops) ----------
setInterval(() => {
  updateGold();
  updateSilver_originalRotation(); // keep original rotation for backward compatibility
  updateCrypto();
}, 210 * 1000); // 3.5 minutes

setInterval(() => updateFX("USD", "EGP"), 2 * 60 * 60 * 1000); // 2 hours
// don't schedule updateMetals here - startMetalsLoops manages its own schedule
setInterval(() => updateEnergy(), 5 * 60 * 60 * 1000); // 5 hours

// start new loops
startSLXLoop(); // every 5 minutes
startSilverLoop(); // scrapers every 5 minutes + metals.dev every 8 hours
startMetalsLoops(); // metals.dev scheduled every 22 hours

// kick-off originals
updateGold();
updateSilver_originalRotation();
updateCrypto();
updateFX("USD", "EGP");
updateEnergy();

// ---------- history / chart / change endpoints ----------
app.get("/api/history/:symbol", (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const hist = cache.history && cache.history[symbol] ? cache.history[symbol] : [];
  res.json({ symbol, history: hist });
});

// chart endpoint: /api/chart/:symbol?days=30  (returns last N daily points)
app.get("/api/chart/:symbol", (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const days = Math.min(90, Number(req.query.days || 30)); // cap to 90
  const hist = (cache.history && cache.history[symbol]) || [];
  const out = hist.slice(-days);
  res.json({ symbol, data: out });
});

// change percent: /api/change/:symbol?period=24h
app.get("/api/change/:symbol", (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const period = req.query.period || "24h";
  const hist = (cache.history && cache.history[symbol]) || [];
  if (!hist.length) return res.json({ symbol, change_percent: 0 });
  try {
    if (period.endsWith("h")) {
      const hrs = Number(period.slice(0, -1));
      if (hrs <= 24) {
        if (hist.length < 2) return res.json({ symbol, change_percent: 0 });
        const last = hist[hist.length - 1].value;
        const prev = hist[hist.length - 2].value;
        const change = ((last - prev) / prev) * 100;
        return res.json({ symbol, change_percent: Number(change.toFixed(4)) });
      } else {
        const daysBack = Math.round(hrs / 24);
        const idx = Math.max(0, hist.length - 1 - daysBack);
        const last = hist[hist.length - 1].value;
        const prev = hist[idx].value;
        const change = ((last - prev) / prev) * 100;
        return res.json({ symbol, change_percent: Number(change.toFixed(4)) });
      }
    } else if (period.endsWith("d")) {
      const days = Number(period.slice(0, -1));
      const idx = Math.max(0, hist.length - 1 - days);
      const last = hist[hist.length - 1].value;
      const prev = hist[idx].value;
      const change = ((last - prev) / prev) * 100;
      return res.json({ symbol, change_percent: Number(change.toFixed(4)) });
    } else {
      return res.json({ symbol, change_percent: 0 });
    }
  } catch (e) {
    return res.json({ symbol, change_percent: 0 });
  }
});

// ---------- existing APIs (keep intact) ----------
app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now(), lastUpdate: cache.lastUpdate }));
app.get("/api/status", (req, res) => res.json({ ok: true, ts: Date.now(), lastUpdate: cache.lastUpdate }));

app.get("/api/gold", (req, res) => {
  const v = get("GOLD");
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v);
});
app.get("/api/silver", (req, res) => {
  const v = get("SILVER");
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v);
});
app.get("/api/crypto", (req, res) => {
  const list = (req.query.list || "BTC,ETH,BNB,ADA,SOL,XRP,DOGE,LTC,DOT,LINK,SLX")
    .split(",")
    .map((s) => s.trim().toUpperCase());
  const out = {};
  for (const s of list) {
    const v = get(s);
    out[s] = v || { error: "Not found" };
  }
  res.json(out);
});
app.get("/api/crypto/bitcoin", (req, res) => { const v = get("BTC"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });
app.get("/api/crypto/ethereum", (req, res) => { const v = get("ETH"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });
app.get("/api/crypto/silverx", (req, res) => { const v = get("SLX"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });

app.get("/api/fx", (req, res) => {
  const from = (req.query.from || "USD").toUpperCase();
  const to = (req.query.to || "EGP").toUpperCase();
  const v = get(`FX_${from}_${to}`);
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json({ from, to, ...v });
});

app.get("/api/metals", (req, res) => {
  const list = (req.query.list || "platinum,palladium,copper,aluminum,nickel,zinc,lead,tin,iron,steel,cobalt,lithium,uranium")
    .split(",")
    .map((s) => s.trim().toUpperCase());
  const out = {};
  for (const m of list) {
    out[m] = get(m) || { error: "Not found" };
  }
  res.json(out);
});
app.get("/api/metals/:metal", (req, res) => {
  const metal = String(req.params.metal || "").toUpperCase();
  const v = get(metal);
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v);
});

app.get("/api/energy", (req, res) => {
  const list = (req.query.list || "wti,brent,natgas").split(",").map((s) => s.trim().toUpperCase());
  const out = {};
  for (const n of list) {
    out[n] = get(n) || { error: "Not found" };
  }
  res.json(out);
});
app.get("/api/oilgas/wti", (req, res) => { const v = get("WTI"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });
app.get("/api/oilgas/brent", (req, res) => { const v = get("BRENT"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });
app.get("/api/oilgas/gas", (req, res) => { const v = get("NATGAS"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });

// ---------- Admin endpoints ----------
function okAdmin(req) {
  const t = req.headers["x-admin-token"] || req.query.token || req.body?.token;
  return String(t) === String(ADMIN_TOKEN);
}
app.get("/api/cache", (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  res.json({ prices: cache.prices, lastUpdate: cache.lastUpdate, historyKeys: Object.keys(cache.history || {}) });
});
app.post("/api/admin/set", (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  const { symbol, price, unit = "usd" } = req.body || {};
  if (!symbol || !price) return res.status(400).json({ error: "symbol and price required" });
  put(String(symbol).toUpperCase(), Number(price), unit, "manual");
  res.json({ ok: true, saved: cache.prices[String(symbol).toUpperCase()] });
});
app.post("/api/admin/refresh", (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  const what = String(req.body?.what || "all").toLowerCase();
  const tasks = [];
  if (what === "all" || what === "gold") tasks.push(updateGold());
  if (what === "all" || what === "silver") tasks.push(updateSilver_originalRotation());
  if (what === "all" || what === "crypto") tasks.push(updateCrypto());
  if (what === "all" || what === "fx") tasks.push(updateFX("USD", "EGP"));
  if (what === "all" || what === "metals") tasks.push(updateMetals());
  if (what === "all" || what === "energy") tasks.push(updateEnergy());
  Promise.allSettled(tasks).then(() => res.json({ ok: true, lastUpdate: cache.lastUpdate }));
});
app.post("/api/admin/cache/clear", (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  cache.prices = {};
  saveCache();
  res.json({ ok: true });
});

// ---------- start ----------
app.listen(PORT, () => console.log(`Backend running on :${PORT}`));
