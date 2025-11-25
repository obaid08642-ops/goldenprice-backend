// server.js - updated by assistant (adds SLX loop, Silver loop + scraping loops for metals)
// Keep the rest of your original code intact — only added/extended functions for SLX/Silver/other metals loops.

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
const METALS_DEV_API_KEY = process.env.METALS_DEV_API_KEY || ""; // new env for metals.dev
const SLX_BSC_TOKEN = process.env.SLX_BSC_TOKEN || "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d";
const SLX_PAIR_ADDRESS = process.env.SLX_PAIR_ADDRESS || "0x7c755e961a8d415c4074bc7d3ba0b85f039c5168"; // pancake pair (if known)

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- CORS ----------
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-admin-token"],
  })
);
app.options("*", cors());

// serve admin.html + any static files in root
app.use(express.static(__dirname));

// ---------- in-memory + persisted cache ----------
let cache = {
  prices: {}, // symbol -> {price, unit, src, t}
  lastUpdate: {}, // group/symbol -> timestamp
  rotate: {
    // existing
    gold: 0,
    silver: 0,
    crypto: 0,
    fx: 0,
    // new rotators
    slxLoop: 0,
    silverLoop: 0,
    metalsLoop: {}, // per-metal index: metalsLoop['ZINC'] = 0
  },
};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const j = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
      cache = { ...cache, ...j };
      // ensure objects exist
      cache.rotate = cache.rotate || {};
      cache.rotate.metalsLoop = cache.rotate.metalsLoop || {};
    }
  } catch (e) {}
}
function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {}
}

loadCache();

// ---------- sites (rotation plan) ----------
// NOTE: we keep everything already existing untouched. We'll add separate arrays for SLX + Silver Loop + metals loops.
let SITES = {
  gold: [
    "twelvedata:XAU/USD",
    "yahoo:XAUUSD=X",
    "kitco:gold",
    "thestreetgold:gold",
  ],
  silver: ["twelvedata:XAG/USD", "yahoo:XAGUSD=X", "kitco:silver"],
  crypto: [
    "binancews:BTCUSDT,ETHUSDT",
    "coingecko:bitcoin,ethereum",
    "coincap:bitcoin,ethereum",
    "dexscreener:SLX",
  ],
  fx: ["exchangeratehost:USD,EGP", "frankfurter:USD,EGP", "alphavantage:USD,EGP"],
  metals: {
    platinum: ["yahoo:XPTUSD=X", "twelvedata:XPT/USD"],
    palladium: ["yahoo:XPDUSD=X", "twelvedata:XPD/USD"],
    copper: ["yahoo:HG=F"],
    aluminum: ["yahoo:ALI=F"],
    nickel: ["yahoo:NID=F"],
    zinc: ["yahoo:MZN=F"],
    lead: ["yahoo:LD=F"],
    tin: ["yahoo:TIN=F"],
    iron: ["yahoo:TIO=F"],
    steel: ["yahoo:STL=F"],
    cobalt: ["yahoo:CO=F"],
    lithium: ["yahoo:LIT=F"],
    uranium: ["yahoo:UX=F"],
  },
  energy: {
    wti: ["alphavantage:WTI", "yahoo:CL=F"],
    brent: ["alphavantage:BRENT", "yahoo:BRN=F"],
    natgas: ["alphavantage:NATGAS", "yahoo:NG=F"],
  },
};

// Try loading sites.json if present
try {
  if (fs.existsSync(SITES_FILE)) {
    const j = JSON.parse(fs.readFileSync(SITES_FILE, "utf-8"));
    SITES = j;
  }
} catch {}

// ---------- helpers ----------
const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const weekend = () => {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun,6=Sat
  return day === 0 || day === 6;
};

// ✅ Smart put: keep last value unless new value valid number and in reasonable range
function isValidNumber(n) {
  if (n === null || n === undefined) return false;
  const num = Number(n);
  if (!Number.isFinite(num)) return false;
  if (num <= 0) return false;
  // optionally add sanity upper bound: metals rarely > 1,000,000
  if (num > 1e8) return false;
  return true;
}
function put(symbol, price, unit, src) {
  if (!isValidNumber(price)) {
    return; // don't override cached value with bad data
  }
  const num = Number(price);
  cache.prices[symbol] = { price: num, unit, src, t: now() };
  saveCache();
}
function get(symbol) {
  return cache.prices[symbol] || null;
}

// parse numeric candidates from text and pick first in plausible range
function parsePriceCandidates(text, { min = 0.1, max = 100000 } = {}) {
  if (!text || typeof text !== "string") return null;
  // match numbers with optional decimals, allow commas
  const matches = text.match(/(\d{1,3}(?:[,\d]{0,})?(?:\.\d+)?|\d+\.\d+)/g);
  if (!matches) return null;
  for (const m of matches) {
    const cleaned = m.replace(/,/g, "");
    const num = Number(cleaned);
    if (Number.isFinite(num) && num >= min && num <= max) return num;
  }
  return null;
}

async function getJSON(url, opts = {}, retries = 1) {
  let e;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      e = err;
      await sleep(200);
    }
  }
  throw e;
}

async function getText(url, opts = {}, retries = 1) {
  let e;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (err) {
      e = err;
      await sleep(200);
    }
  }
  throw e;
}

// ---------- existing source resolvers (kept) ----------
async function fromTwelveData(pair) {
  if (!TWELVEDATA_KEY) throw new Error("no TD key");
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(
    pair
  )}&apikey=${TWELVEDATA_KEY}`;
  const j = await getJSON(url);
  const v = Number(j?.price);
  if (!v) throw new Error("TD no price");
  return v;
}
async function fromYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?region=US&lang=en-US`;
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
  let txt = (
    $("span:contains(USD)").first().text() ||
    $("td:contains(USD)").first().text() ||
    ""
  ).replace(/[^\d.]/g, "");
  const v = Number(txt);
  if (!v) throw new Error("Kitco parse fail");
  return v;
}
async function fromTheStreetGold() {
  const html = await getText("https://www.thestreet.com/quote/gold-price");
  const $ = cheerio.load(html);
  let txt = $("*[data-test='last-price']")
    .first()
    .text()
    .replace(/[^\d.]/g, "");
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

// ---------- crypto websocket (unchanged) ----------
const wsPrices = new Map();
function startBinanceWS(symbols = ["btcusdt", "ethusdt"]) {
  try {
    const streams = symbols.map((s) => `${s}@ticker`).join("/");
    const ws = new WebSocket(
      `wss://stream.binance.com:9443/stream?streams=${streams}`
    );
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
  const j = await getJSON(
    `https://api.dexscreener.com/latest/dex/search?q=${token}`
  );
  const pair = j?.pairs?.[0];
  const v = Number(pair?.priceUsd);
  if (!v) throw new Error("DexScreener no price");
  return v;
}

// ---------- new resolvers for SLX + other sources ----------

// 1) Geckoterminal token endpoint (returns price_usd in attributes)
async function fromGeckoTerminal(tokenAddress) {
  const url = `https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${tokenAddress.toLowerCase()}`;
  const j = await getJSON(url, {}, 1);
  const v = Number(j?.data?.attributes?.price_usd);
  if (!v) throw new Error("GeckoTerminal no price");
  return v;
}

// 2) Dexscreener by pair (when we have pair address)
async function fromDexScreenerByPair(pairAddress) {
  // pairAddress expected hex (lowercase or uppercase)
  const url = `https://api.dexscreener.com/latest/dex/pairs/bsc/${pairAddress.toLowerCase()}`;
  const j = await getJSON(url, {}, 1);
  const pair = j?.pairs?.[0];
  const v = Number(pair?.priceUsd);
  if (!v) throw new Error("DexScreener pair no price");
  return v;
}

// 3) metals.dev API (for silver + many metals) - requires METALS_DEV_API_KEY
async function fromMetalsDev(metal) {
  if (!METALS_DEV_API_KEY) throw new Error("no METALS_DEV_API_KEY");
  const url = `https://api.metals.dev/v1/metal/spot?api_key=${encodeURIComponent(
    METALS_DEV_API_KEY
  )}&metal=${encodeURIComponent(metal)}&currency=USD`;
  const j = await getJSON(url, {}, 1);
  const price = Number(j?.rate?.price || j?.rate?.ask || j?.rate?.bid);
  if (!price) throw new Error("MetalsDev no price");
  return price;
}

// 4) Generic scrapers for specific pages (saudigoldprice, investing, tradingeconomics, marketwatch...)
async function fromSaudiGoldSilver() {
  // https://saudigoldprice.com/silverprice/
  const html = await getText("https://saudigoldprice.com/silverprice/");
  const $ = cheerio.load(html);
  // try find Arabic phrase "سعر أونصة الفضة" or any USD number on page
  const text = $("body").text();
  const v = parsePriceCandidates(text, { min: 1, max: 10000 });
  if (!v) throw new Error("saudigold parse fail");
  return v;
}
async function fromInvestingSilver() {
  // target: investing.com/silver or a silver page
  const html = await getText("https://www.investing.com/commodities/silver");
  const $ = cheerio.load(html);
  const text = $("body").text();
  const v = parsePriceCandidates(text, { min: 1, max: 10000 });
  if (!v) throw new Error("investing parse fail");
  return v;
}
async function fromMarketWatchSilver() {
  const html = await getText("https://www.marketwatch.com/investing/future/silver");
  const $ = cheerio.load(html);
  const text = $("body").text();
  const v = parsePriceCandidates(text, { min: 1, max: 10000 });
  if (!v) throw new Error("marketwatch parse fail");
  return v;
}
async function fromTradingEconomicsSilver() {
  const html = await getText("https://tradingeconomics.com/commodity/silver");
  const $ = cheerio.load(html);
  const text = $("body").text();
  const v = parsePriceCandidates(text, { min: 1, max: 10000 });
  if (!v) throw new Error("tradingeconomics parse fail");
  return v;
}

// ---------- SLX loop implementation ----------
// We'll use 4 sources (in this order of preference/rotation):
// 1) Geckoterminal token endpoint (reliable) - fromGeckoTerminal
// 2) DexScreener pair by pair address           - fromDexScreenerByPair
// 3) DexScreener token search                    - fromDexScreenerByToken
// 4) CoinCap / CoinGecko fallback (not ideal but safe)
const SLX_SOURCES = [
  { type: "geckoterminal", fn: async () => await fromGeckoTerminal(SLX_BSC_TOKEN) },
  { type: "dex_pair", fn: async () => await fromDexScreenerByPair(SLX_PAIR_ADDRESS) },
  { type: "dex_token", fn: async () => await fromDexScreenerByToken(SLX_BSC_TOKEN) },
  { type: "coincap", fn: async () => await fromCoinCap("silverx") }, // may fail if coincap id not present
];

// rotate through SLX_SOURCES using cache.rotate.slxLoop
async function updateSLXOnce() {
  let idx = cache.rotate.slxLoop || 0;
  // try sequentially from idx .. end .. then 0..idx-1 (so rotation works)
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
      // continue to next source
    }
  }
  // nothing succeeded -> keep old cached value
}

// separate loop runner (called on schedule)
function startSLXLoop() {
  // run immediately then every 5 minutes
  updateSLXOnce().catch(() => {});
  setInterval(() => {
    updateSLXOnce().catch(() => {});
  }, 5 * 60 * 1000);
}

// ---------- Silver loop implementation ----------
// Desired: lob of N scraping sources + metals.dev API every ~6 hours.
// We'll build an ordered list and rotate through it every 40 minutes (scrapers).
const SILVER_SCRAPE_SOURCES = [
  { name: "saudigold", fn: fromSaudiGoldSilver },
  { name: "investing", fn: fromInvestingSilver },
  { name: "marketwatch", fn: fromMarketWatchSilver },
  { name: "tradingeconomics", fn: fromTradingEconomicsSilver },
  { name: "kitco", fn: async () => await fromKitco("silver") },
  // add more scrapers if you want (e.g. tradingview scrapes, dailyforex, goldmaker) - generic fallback
];

// rotate index key = cache.rotate.silverLoop
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
    } catch (e) {
      // continue to next source
    }
  }
  // none succeeded - keep cached value
}

// metals.dev scheduled call for silver (every 6 hours) -- this is an API source that counts against quota
async function updateSilverFromMetalsDev() {
  try {
    const price = await fromMetalsDev("silver");
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
  // run scrape rotate every 40 minutes
  updateSilverScrapeOnce().catch(() => {});
  setInterval(() => {
    updateSilverScrapeOnce().catch(() => {});
  }, 40 * 60 * 1000);

  // run metals.dev every ~6 hours (if key present)
  if (METALS_DEV_API_KEY) {
    updateSilverFromMetalsDev().catch(() => {});
    setInterval(() => {
      updateSilverFromMetalsDev().catch(() => {});
    }, 6 * 60 * 60 * 1000);
  }
}

// ---------- metals loops for other missing metals (zinc/lead/palladium/platinum/copper) ----------
// For each metal we will have a list of scrapers + metals.dev if available.
// We'll run each metal's rotation every 60-120 minutes (configurable).
const METALS_TO_LOOP = {
  ZINC: [
    { name: "metalsdev", fn: async () => await fromMetalsDev("zinc") },
    { name: "yahoo", fn: async () => await fromYahoo("MZN=F") },
    { name: "metalary", fn: async () => await fromMetalFallback("zinc") },
  ],
  LEAD: [
    { name: "metalsdev", fn: async () => await fromMetalsDev("lead") },
    { name: "yahoo", fn: async () => await fromYahoo("LD=F") },
    { name: "metalary", fn: async () => await fromMetalFallback("lead") },
  ],
  PLATINUM: [
    { name: "metalsdev", fn: async () => await fromMetalsDev("platinum") },
    { name: "yahoo", fn: async () => await fromYahoo("XPTUSD=X") },
    { name: "metalary", fn: async () => await fromMetalFallback("platinum") },
  ],
  PALLADIUM: [
    { name: "metalsdev", fn: async () => await fromMetalsDev("palladium") },
    { name: "yahoo", fn: async () => await fromYahoo("XPDUSD=X") },
    { name: "metalary", fn: async () => await fromMetalFallback("palladium") },
  ],
  COPPER: [
    { name: "metalsdev", fn: async () => await fromMetalsDev("copper") },
    { name: "yahoo", fn: async () => await fromYahoo("HG=F") },
    { name: "metalary", fn: async () => await fromMetalFallback("copper") },
  ],
};

async function updateMetalOnce(metalKey) {
  const list = METALS_TO_LOOP[metalKey];
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
    } catch (e) {
      // continue
    }
  }
  // none succeeded -> keep cached
}

function startMetalsLoops() {
  // schedule every metal update independently (every 60-120 minutes recommended)
  Object.keys(METALS_TO_LOOP).forEach((metalKey) => {
    // run immediately
    updateMetalOnce(metalKey).catch(() => {});
    // schedule every 60 minutes (you can tune to 60*60*1000 or 2*60*60*1000)
    setInterval(() => {
      updateMetalOnce(metalKey).catch(() => {});
    }, 60 * 60 * 1000); // every 1 hour
  });
}

// ---------- existing update routines left intact (gold/silver/crypto/fx/metals/energy) ----------
// We keep them, they run as before. We will only add SLX loop + silver+metals loops in parallel.

async function updateGold() {
  if (weekend()) return;
  let src = SITES && Array.isArray(SITES.gold) ? SITES.gold[cache.rotate.gold % SITES.gold.length] : null;
  if (!src) return;
  let price = null,
    unit = "oz",
    used = src;
  try {
    if (src.startsWith("twelvedata:")) {
      price = await fromTwelveData(src.split(":")[1]);
    } else if (src.startsWith("yahoo:")) {
      price = await fromYahoo(src.split(":")[1]);
    } else if (src.startsWith("kitco:")) {
      price = await fromKitco("gold");
    } else if (src.startsWith("thestreetgold:")) {
      price = await fromTheStreetGold();
    }
    if (price) {
      put("GOLD", price, unit, used);
      cache.lastUpdate.gold = now();
      saveCache();
    }
  } catch {}
}
async function updateSilver() {
  // keep original rotation (we also run our enhanced loops in parallel)
  if (weekend()) return;
  let src = SITES && Array.isArray(SITES.silver) ? SITES.silver[cache.rotate.silver % SITES.silver.length] : null;
  if (!src) return;
  let price = null,
    unit = "oz",
    used = src;
  try {
    if (src.startsWith("twelvedata:")) {
      price = await fromTwelveData(src.split(":")[1]);
    } else if (src.startsWith("yahoo:")) {
      price = await fromYahoo(src.split(":")[1]);
    } else if (src.startsWith("kitco:")) {
      price = await fromKitco("silver");
    }
    if (!price) {
      try {
        price = await fromKitco("silver");
        used = "kitco-fallback";
      } catch {}
    }
    if (price) {
      put("SILVER", price, unit, used);
      cache.lastUpdate.silver = now();
      saveCache();
    }
  } catch {}
}

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
      const ids = "bitcoin,ethereum,ripple,cardano,solana";
      const j = await fromCoinGecko(ids);
      if (j.BITCOIN) put("BTC", j.BITCOIN, "usd", "coingecko");
      if (j.ETHEREUM) put("ETH", j.ETHEREUM, "usd", "coingecko");
      if (j.RIPPLE) put("XRP", j.RIPPLE, "usd", "coingecko");
      if (j.CARDANO) put("ADA", j.CARDANO, "usd", "coingecko");
      if (j.SOLANA) put("SOL", j.SOLANA, "usd", "coingecko");

    } else if (src.startsWith("coincap:")) {
      const BTC = await fromCoinCap("bitcoin");
      const ETH = await fromCoinCap("ethereum");
      const XRP = await fromCoinCap("ripple");
      const ADA = await fromCoinCap("cardano");
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

    cache.lastUpdate.crypto = now();
    saveCache();
  } catch {}
}

async function updateFX(base = "USD", quote = "EGP") {
  let src = SITES && Array.isArray(SITES.fx) ? SITES.fx[cache.rotate.fx % SITES.fx.length] : null;
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
  } catch {}
}
async function updateMetals() {
  // keep existing rotation for SITES.metals (we also run the new per-metal loops)
  const m = SITES.metals || {};
  for (const [name, sources] of Object.entries(m)) {
    let got = false;
    for (const src of sources) {
      try {
        let v = null,
          unit = "oz";
        if (src.startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]);
        else if (src.startsWith("twelvedata:")) v = await fromTwelveData(src.split(":")[1]);
        if (v) {
          put(name.toUpperCase(), v, unit, src);
          got = true;
          break;
        }
      } catch {}
    }
    if (!got) {
      try {
        const v2 = await fromMetalFallback(name);
        if (v2) {
          put(name.toUpperCase(), v2, "oz", "metalary-fallback");
          got = true;
        }
      } catch {}
    }
  }
  cache.lastUpdate.metals = now();
  saveCache();
}
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
        if (v) {
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

// ---------- schedules (existing + new loops) ----------
const MIN = 60 * 1000;
// existing intervals (unchanged)
setInterval(() => {
  updateGold();
  updateSilver();
  updateCrypto();
}, 210 * 1000); // 3.5 minute rotation
setInterval(() => {
  updateFX("USD", "EGP");
}, 2 * 60 * 60 * 1000); // 2 hours
setInterval(() => {
  updateMetals();
}, 3 * 60 * 60 * 1000); // 3 hours
setInterval(() => {
  updateEnergy();
}, 5 * 60 * 60 * 1000); // 5 hours

// new loops: start them (they run independently)
startSLXLoop();     // every 5 minutes (SLX)
startSilverLoop();  // scrapers every 40 minutes + metals.dev every ~6 hours
startMetalsLoops(); // other metals every 1 hour (adjustable)

// kick-off immediately on boot for the original routines
updateGold();
updateSilver();
updateCrypto();
updateFX("USD", "EGP");
updateMetals();
updateEnergy();

// ---------- APIs ----------
app.get("/api/health", (req, res) =>
  res.json({ ok: true, ts: Date.now(), lastUpdate: cache.lastUpdate })
);
app.get("/api/status", (req, res) =>
  res.json({ ok: true, ts: Date.now(), lastUpdate: cache.lastUpdate })
);

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
  const list = (req.query.list || "BTC,ETH,SLX")
    .split(",")
    .map((s) => s.trim().toUpperCase());
  const out = {};
  for (const s of list) {
    const v = get(s);
    if (v) out[s] = v;
    else out[s] = { error: "Not found" };
  }
  res.json(out);
});
app.get("/api/crypto/bitcoin", (req, res) => {
  const v = get("BTC");
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v);
});
app.get("/api/crypto/ethereum", (req, res) => {
  const v = get("ETH");
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v);
});
app.get("/api/crypto/silverx", (req, res) => {
  const v = get("SLX");
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v);
});
app.get("/api/fx", (req, res) => {
  const from = (req.query.from || "USD").toUpperCase();
  const to = (req.query.to || "EGP").toUpperCase();
  const v = get(`FX_${from}_${to}`);
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json({ from, to, ...v });
});
app.get("/api/metals", (req, res) => {
  const list = (
    req.query.list ||
    "platinum,palladium,copper,aluminum,nickel,zinc,lead,tin,iron,steel,cobalt,lithium,uranium"
  )
    .split(",")
    .map((s) => s.trim().toUpperCase());
  const out = {};
  for (const m of list) {
    const v = get(m);
    if (v) out[m] = v;
    else out[m] = { error: "Not found" };
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
  const list = (req.query.list || "wti,brent,natgas")
    .split(",")
    .map((s) => s.trim().toUpperCase());
  const out = {};
  for (const n of list) {
    const v = get(n);
    if (v) out[n] = v;
    else out[n] = { error: "Not found" };
  }
  res.json(out);
});
app.get("/api/oilgas/wti", (req, res) => {
  const v = get("WTI");
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v);
});
app.get("/api/oilgas/brent", (req, res) => {
  const v = get("BRENT");
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v);
});
app.get("/api/oilgas/gas", (req, res) => {
  const v = get("NATGAS");
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v);
});

// ---------- Admin ----------
function okAdmin(req) {
  const t =
    req.headers["x-admin-token"] || req.query.token || req.body?.token;
  return String(t) === String(ADMIN_TOKEN);
}
app.get("/api/cache", (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  res.json({
    prices: cache.prices,
    lastUpdate: cache.lastUpdate,
  });
});
app.post("/api/admin/set", (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  const { symbol, price, unit = "usd" } = req.body || {};
  if (!symbol || !price)
    return res.status(400).json({ error: "symbol and price required" });
  put(String(symbol).toUpperCase(), Number(price), unit, "manual");
  res.json({ ok: true, saved: cache.prices[String(symbol).toUpperCase()] });
});
app.post("/api/admin/refresh", (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  const what = String(req.body?.what || "all").toLowerCase();
  const tasks = [];
  if (what === "all" || what === "gold") tasks.push(updateGold());
  if (what === "all" || what === "silver") tasks.push(updateSilver());
  if (what === "all" || what === "crypto") tasks.push(updateCrypto());
  if (what === "all" || what === "fx") tasks.push(updateFX("USD", "EGP"));
  if (what === "all" || what === "metals") tasks.push(updateMetals());
  if (what === "all" || what === "energy") tasks.push(updateEnergy());
  Promise.allSettled(tasks).then(() => {
    res.json({ ok: true, lastUpdate: cache.lastUpdate });
  });
});
app.post("/api/admin/cache/clear", (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  cache.prices = {};
  saveCache();
  res.json({ ok: true });
});

// ---------- start ----------
app.listen(PORT, () => console.log(`Backend running on :${PORT}`));
