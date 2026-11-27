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
import { dbEnabled, initDb, recordPrice, pruneTicks, dailyHistory, recentTicks, listSymbols, bulkDaily } from "./db.js";

// ---------- paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, "cache.json");
const SITES_FILE = path.join(__dirname, "sites.json");

// ---------- env ----------
const PORT = Number(process.env.PORT || 10000);
// No default token: admin endpoints are disabled until ADMIN_TOKEN is set.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
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
// Serve only ./public (admin page). Never expose server.js, cache.json or sites.json.
app.use(express.static(path.join(__dirname, "public")));

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
    // Only real futures symbols are used as fallback. Other metals rely on metals.dev + manual admin entry.
    zinc: ["metalsdev:zinc"],
    aluminum: ["metalsdev:aluminum", "yahoo:ALI=F"],
    copper: ["metalsdev:copper", "yahoo:HG=F"],
    lead: ["metalsdev:lead"],
    nickel: ["metalsdev:nickel"],
    platinum: ["metalsdev:platinum", "yahoo:PL=F"],
    palladium: ["metalsdev:palladium", "yahoo:PA=F"],
    cobalt: ["metalsdev:cobalt"],
    lithium: ["metalsdev:lithium"],
    uranium: ["metalsdev:uranium"],
    tin: ["metalsdev:tin"],
    iron: ["metalsdev:iron"],
    steel: ["metalsdev:steel"],
  },
  energy: {
    wti: ["yahoo:CL=F"],
    brent: ["yahoo:BZ=F"],
    natgas: ["yahoo:NG=F"],
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
function put(symbol, price, unit = "usd", src = "unknown", force = false) {
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
    recordPrice(symbol, num, src, force).catch((e) => console.error("db record error", e.message || e));
  } catch (e) {
    console.error("put error", e.message || e);
  }
}
function get(symbol) {
  return cache.prices[symbol] || null;
}

// ---------- metals sanity rules ----------
// Canonical units: industrial metals USD/metric ton, precious USD/troy oz, uranium USD/lb.
// Values outside [min,max] or jumping > maxJump vs. the last stored price are rejected,
// so a broken scraper/API can never publish a wildly wrong number.
const METAL_RULES = {
  COPPER: { min: 5000, max: 20000 }, ALUMINUM: { min: 1500, max: 5000 }, ZINC: { min: 1500, max: 6000 },
  LEAD: { min: 1500, max: 4000 }, NICKEL: { min: 8000, max: 40000 }, TIN: { min: 15000, max: 60000 },
  COBALT: { min: 15000, max: 80000 }, LITHIUM: { min: 5000, max: 100000 }, URANIUM: { min: 30, max: 250 },
  IRON: { min: 50, max: 250 }, STEEL: { min: 300, max: 1500 },
  PLATINUM: { min: 500, max: 3000 }, PALLADIUM: { min: 500, max: 3500 },
};
const MAX_JUMP = 0.2; // 20% between consecutive updates
function putMetal(name, price, src) {
  const sym = String(name).toUpperCase();
  const r = METAL_RULES[sym];
  const v = Number(price);
  if (r && (v < r.min || v > r.max)) {
    console.warn(`metal ${sym} rejected (out of range): ${v} from ${src}`);
    return false;
  }
  const prev = cache.prices[sym];
  if (prev && prev.src !== "manual" && Math.abs(v - prev.price) / prev.price > MAX_JUMP) {
    console.warn(`metal ${sym} rejected (jump >${MAX_JUMP * 100}%): ${prev.price} -> ${v} from ${src}`);
    return false;
  }
  put(sym, v, "usd", src);
  return true;
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
const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", Accept: "application/json" };
async function fromYahoo(ticker) {
  // Yahoo answers 429 to requests without a browser User-Agent, so always send one; try both hosts.
  let lastErr;
  for (const host of ["query1", "query2"]) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?region=US&lang=en-US`;
      const j = await getJSON(url, { headers: YAHOO_HEADERS });
      const v = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (v) return Number(v);
      lastErr = new Error("Yahoo no price");
    } catch (e) { lastErr = e; }
  }
  console.warn(`yahoo ${ticker} failed: ${lastErr?.message || lastErr}`);
  throw lastErr;
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
      try {
        if (group1.includes(lower) && (METALS_DEV_KEY1 || METALS_DEV_API_KEY)) {
          price = await fromMetalsDevWithKey(lower, 1);
          if (isValidNumber(price)) {
            got = putMetal(name, price, "metals.dev:key1");
          }
        } else if (group2.includes(lower) && (METALS_DEV_KEY2 || METALS_DEV_API_KEY)) {
          price = await fromMetalsDevWithKey(lower, 2);
          if (isValidNumber(price)) {
            got = putMetal(name, price, "metals.dev:key2");
          }
        } else if (METALS_DEV_API_KEY) {
          // fallback single key
          price = await fromMetalsDevWithKey(lower, 0);
          if (isValidNumber(price)) {
            got = putMetal(name, price, "metals.dev");
          }
        }

      } catch (e) {
        console.warn(`metals.dev ${lower} failed: ${e.message || e}`);
      }
      // If not gotten yet, try configured sources (yahoo / others) in order
      if (!got && Array.isArray(sources)) {
        for (const src of sources) {
          try {
            if (typeof src === "string" && src.startsWith("yahoo:")) {
              const tk = src.split(":")[1];
              let v = await fromYahoo(tk);
              if (tk === "HG=F") v = v * 2204.62; // USD/lb -> USD/ton
              if (isValidNumber(v)) {
                got = putMetal(name, v, src);
                break;
              }
            } else if (typeof src === "string" && src.startsWith("twelvedata:")) {
              const v = await fromTwelveData(src.split(":")[1]);
              if (isValidNumber(v)) {
                got = putMetal(name, v, src);
                break;
              }
            } else if (typeof src === "string" && src.startsWith("scrape:")) {
              // format scrape:site:metal
              const parts = src.split(":");
              const site = parts[1];
              const metal = parts[2] || name.toLowerCase();
              const v = await fromScrapeSite(site, metal);
              if (isValidNumber(v)) {
                got = putMetal(name, v, `scrape:${site}`);
                break;
              }
            }
          } catch (e) {
            // continue to next source
          }
        }
      }
    } catch (e) {
      // ignore per-metal failures
    }
    // continue to next metal
  }
  cache.lastUpdate.metals = now();
  saveCache();
}

// near real-time metals from Yahoo futures only (no API quota); other metals wait for metals.dev/manual
async function updateMetalsLive() {
  for (const [name, sources] of Object.entries(SITES.metals || {})) {
    for (const src of sources || []) {
      if (typeof src !== "string" || !src.startsWith("yahoo:")) continue;
      try {
        const tk = src.split(":")[1];
        let v = await fromYahoo(tk);
        if (tk === "HG=F") v = v * 2204.62; // USD/lb -> USD/ton
        if (putMetal(name, v, src)) break;
      } catch {}
    }
  }
}

// update energy (kept)
const ENERGY_RULES = { WTI: { min: 20, max: 250 }, BRENT: { min: 20, max: 250 }, NATGAS: { min: 0.5, max: 30 } };
async function updateEnergy() {
  const e = SITES.energy || {};
  for (const [name, sources] of Object.entries(e)) {
    const sym = name.toUpperCase();
    const r = ENERGY_RULES[sym];
    for (const src of sources) {
      try {
        // Alpha Vantage parsing is unreliable (it returned junk like 1); only trust Yahoo futures.
        if (!src.startsWith("yahoo:")) continue;
        const v = await fromYahoo(src.split(":")[1]);
        if (!isValidNumber(v)) continue;
        if (r && (v < r.min || v > r.max)) { console.warn(`energy ${sym} rejected: ${v} from ${src}`); continue; }
        put(sym, v, "usd", src);
        break;
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
  setInterval(() => updateMetals().catch(() => {}), 8 * 60 * 60 * 1000); // metals.dev (quota-limited)
  setInterval(() => updateMetalsLive().catch(() => {}), 15 * 60 * 1000); // Yahoo futures, near real-time
}

// ---------- schedules (existing + new loops) ----------
setInterval(() => {
  updateGold();
  updateSilver_originalRotation(); // keep original rotation for backward compatibility
  updateCrypto();
}, 210 * 1000); // 3.5 minutes

setInterval(() => updateFX("USD", "EGP"), 2 * 60 * 60 * 1000); // 2 hours
// don't schedule updateMetals here - startMetalsLoops manages its own schedule
setInterval(() => updateEnergy(), 15 * 60 * 1000); // 15 min (Yahoo futures)

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
app.get("/api/history/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const days = Math.min(36500, Number(req.query.days || 365));
  try {
    const rows = await dailyHistory(symbol, days);
    if (rows && rows.length) return res.json({ symbol, source: "db", history: rows });
  } catch (e) { console.error("history db error", e.message || e); }
  res.json({ symbol, source: "cache", history: (cache.history && cache.history[symbol]) || [] });
});

// chart endpoint: /api/chart/:symbol?days=30 (daily points; ?days up to 3650 when DB is on)
app.get("/api/chart/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const days = Math.min(dbEnabled ? 3650 : 90, Number(req.query.days || 30));
  try {
    let rows = await dailyHistory(symbol, days);
    const maxPts = Math.min(1500, Number(req.query.points || 400));
    if (rows && rows.length > maxPts) { const step = rows.length / maxPts; rows = rows.filter((_, i) => Math.floor(i % step) === 0 || i === rows.length - 1); }
    if (rows && rows.length) { res.set("Cache-Control", "public, max-age=300"); return res.json({ symbol, source: "db", data: rows }); }
  } catch (e) { console.error("chart db error", e.message || e); }
  res.json({ symbol, source: "cache", data: ((cache.history && cache.history[symbol]) || []).slice(-days) });
});

app.get("/api/ticks/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  try {
    const rows = await recentTicks(symbol, Math.min(720, Number(req.query.hours || 24)));
    res.json({ symbol, data: rows || [] });
  } catch (e) { res.status(500).json({ error: "db error" }); }
});

app.get("/api/symbols", async (req, res) => {
  try { res.json({ symbols: (await listSymbols()) || Object.keys(cache.prices) }); }
  catch (e) { res.json({ symbols: Object.keys(cache.prices) }); }
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

// ---------- all-currency rates (free, no key) ----------
let RATES = { base: "USD", rates: {}, updated: 0, source: "" };
async function updateRates() {
  const sources = [
    ["open.er-api.com", async () => (await getJSON("https://open.er-api.com/v6/latest/USD")).rates],
    ["exchangerate-api.com", async () => (await getJSON("https://api.exchangerate-api.com/v4/latest/USD")).rates],
  ];
  for (const [name, fn] of sources) {
    try {
      const r = await fn();
      if (r && r.EUR && r.EGP && Object.keys(r).length > 100) {
        RATES = { base: "USD", rates: r, updated: Date.now(), source: name };
        if (r.EGP) put("FX_USD_EGP", Number(r.EGP), "egp", name);
        return;
      }
    } catch (e) { console.warn(`rates from ${name} failed: ${e.message || e}`); }
  }
}
updateRates();
setInterval(() => updateRates(), 60 * 60 * 1000);
app.get("/api/rates", (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  if (!RATES.updated) return res.status(503).json({ error: "rates not ready" });
  res.json(RATES);
});

// ---------- history backfill from Yahoo (admin) ----------
const BACKFILL = { GOLD: "GC=F", SILVER: "SI=F", PLATINUM: "PL=F", PALLADIUM: "PA=F", COPPER: "HG=F", ALUMINUM: "ALI=F", WTI: "CL=F", BRENT: "BZ=F", NATGAS: "NG=F", BTC: "BTC-USD", ETH: "ETH-USD" };
async function backfillSymbol(sym, tk, range = "5y") {
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk)}?range=${range}&interval=1d`, { headers: YAHOO_HEADERS });
  const r = j?.chart?.result?.[0];
  const ts = r?.timestamp || [], cl = r?.indicators?.quote?.[0]?.close || [];
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    let v = cl[i];
    if (!isValidNumber(v)) continue;
    if (tk === "HG=F") v *= 2204.62; // USD/lb -> USD/ton
    const rule = METAL_RULES[sym] || ENERGY_RULES[sym];
    if (rule && (v < rule.min * 0.4 || v > rule.max * 2.5)) continue; // skip obviously broken points
    rows.push({ day: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: Number(v) });
  }
  return bulkDaily(sym, rows, "backfill:yahoo");
}
app.post("/api/admin/backfill", async (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  if (!dbEnabled) return res.status(400).json({ error: "database is not configured" });
  const range = ["1y", "2y", "5y", "10y", "max"].includes(req.body?.range) ? req.body.range : "5y";
  const out = {};
  for (const [sym, tk] of Object.entries(BACKFILL)) {
    try { out[sym] = await backfillSymbol(sym, tk, range); } catch (e) { out[sym] = "error: " + (e.message || e); }
  }
  res.json({ ok: true, range, inserted: out });
});

// ---------- one-call overview for the website (prices + 24h change + 7-day sparkline) ----------
const OVERVIEW = ["GOLD", "SILVER", "PLATINUM", "PALLADIUM", "COPPER", "ALUMINUM", "WTI", "BRENT", "NATGAS", "BTC", "ETH"];
let overviewCache = { t: 0, body: null };
app.get("/api/overview", async (req, res) => {
  res.set("Cache-Control", "public, max-age=60");
  if (overviewCache.body && Date.now() - overviewCache.t < 60000) return res.json(overviewCache.body);
  const items = {};
  await Promise.all(OVERVIEW.map(async (sym) => {
    const cur = cache.prices[sym];
    let hist = [];
    try { hist = (await dailyHistory(sym, 12)) || []; } catch {}
    const closes = hist.map((h) => h.value);
    const today = new Date().toISOString().slice(0, 10);
    // Gold/silver are fed from spot sources while history is futures, so skip the change until a live-recorded previous close exists.
    const prevRow = [...hist].reverse().find((h) => h.date < today);
    const price = cur ? cur.price : closes[closes.length - 1] ?? null;
    items[sym] = {
      price, unit: cur?.unit || "usd", src: cur?.src || (closes.length ? "history" : null), t: cur?.t || null,
      stale: cur ? Date.now() - cur.t > 3 * 24 * 3600 * 1000 : true,
      changePct: price && prevRow && (!String(prevRow.src || "").startsWith("backfill") || !["GOLD", "SILVER"].includes(sym)) ? Number((((price - prevRow.value) / prevRow.value) * 100).toFixed(2)) : null,
      spark: closes.slice(-8),
    };
  }));
  const body = { updated: Date.now(), items };
  overviewCache = { t: Date.now(), body };
  res.json(body);
});

app.get("/api/metals", (req, res) => {
  const list = (req.query.list || "platinum,palladium,copper,aluminum,nickel,zinc,lead,tin,iron,steel,cobalt,lithium,uranium")
    .split(",")
    .map((s) => s.trim().toUpperCase());
  const out = {};
  for (const m of list) {
    const v = get(m);
    out[m] = v ? { ...v, stale: Date.now() - v.t > 3 * 24 * 3600 * 1000 } : { error: "Not found" };
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
  return !!ADMIN_TOKEN && String(t) === String(ADMIN_TOKEN);
}
app.get("/api/cache", (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  res.json({ prices: cache.prices, lastUpdate: cache.lastUpdate, historyKeys: Object.keys(cache.history || {}) });
});
app.post("/api/admin/set", (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  const { symbol, price, unit = "usd", force = false } = req.body || {};
  const sym = String(symbol || "").toUpperCase();
  const num = Number(price);
  if (!sym || !isValidNumber(num)) return res.status(400).json({ error: "symbol and a positive price are required" });
  // Typo guard: ask for explicit confirmation (force) when the value looks wrong.
  const rule = METAL_RULES[sym] || ENERGY_RULES[sym];
  if (!force && rule && (num < rule.min || num > rule.max)) {
    return res.status(422).json({ error: `outside the expected range ${rule.min}-${rule.max}`, needsConfirm: true });
  }
  const prev = cache.prices[sym];
  if (!force && prev && Math.abs(num - prev.price) / prev.price > 0.3) {
    return res.status(409).json({ error: `differs from the current ${prev.price} by more than 30%`, needsConfirm: true });
  }
  put(sym, num, unit, "manual", true);
  res.json({ ok: true, saved: cache.prices[sym] });
});
// Per-symbol freshness so the admin sees what needs attention (stale, missing, or manual-only).
const EXPECTED = ["GOLD", "SILVER", "BTC", "ETH", "FX_USD_EGP", ...Object.keys(METAL_RULES), "WTI", "BRENT", "NATGAS"];
function statusReport() {
  const t = Date.now();
  return EXPECTED.map((sym) => {
    const v = cache.prices[sym];
    if (!v) return { symbol: sym, state: "missing" };
    const ageH = (t - v.t) / 3600000;
    const limit = v.src === "manual" ? 48 : 6; // manual entries should be re-checked every 2 days
    return { symbol: sym, price: v.price, unit: v.unit, src: v.src, ageHours: Number(ageH.toFixed(1)), state: ageH > limit ? "stale" : "ok" };
  });
}
app.get("/api/admin/status", (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  res.json({ db: dbEnabled, emailAlerts: !!(RESEND_API_KEY && ALERT_EMAIL), items: statusReport() });
});

// Email alert (optional): set RESEND_API_KEY + ALERT_EMAIL. Sent when something is missing/stale, at most once per day per set.
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const ALERT_EMAIL = process.env.ALERT_EMAIL || "";
let lastAlertKey = "", lastAlertAt = 0;
async function checkAlerts() {
  const bad = statusReport().filter((x) => x.state !== "ok");
  if (!bad.length || !RESEND_API_KEY || !ALERT_EMAIL) return;
  const key = bad.map((x) => x.symbol + ":" + x.state).join(",");
  if (key === lastAlertKey && Date.now() - lastAlertAt < 24 * 3600 * 1000) return;
  lastAlertKey = key; lastAlertAt = Date.now();
  const lines = bad.map((x) => `- ${x.symbol}: ${x.state}${x.ageHours ? ` (${x.ageHours}h old, source ${x.src})` : ""}`).join("\n");
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "GoldenPrice <onboarding@resend.dev>", to: [ALERT_EMAIL], subject: `GoldenPrice: ${bad.length} price(s) need attention`, text: `These prices are missing or stale. Open the admin page and update them:\n\n${lines}\n` }),
    });
  } catch (e) { console.error("alert email failed", e.message || e); }
}
setInterval(() => checkAlerts().catch(() => {}), 60 * 60 * 1000);
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
initDb().then((on) => console.log(on ? "DB ready" : "DB disabled (no DATABASE_URL)")).catch((e) => console.error("DB init failed", e.message || e));
setInterval(() => pruneTicks().catch(() => {}), 6 * 60 * 60 * 1000);
app.listen(PORT, () => console.log(`Backend running on :${PORT}`));
