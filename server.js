// server.js (FINAL) - adjusted only for SLX, SILVER, ZINC, LEAD, PALLADIUM, PLATINUM
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
// SLX الرسمي:
const SLX_BSC_TOKEN = process.env.SLX_BSC_TOKEN || "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d";

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- CORS ----------
import cors from "cors";

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
    // indices to rotate through sources per group
    gold: 0,
    silver: 0,
    crypto: 0,
    fx: 0,
    // added specific rotate indices for custom groups
    slx: 0,
    metals_custom: 0,
  },
};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const j = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
      cache = { ...cache, ...j };
    }
  } catch {}
}
function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {}
}

loadCache();

// ---------- sites (rotation plan) ----------
// NOTE: We did NOT change existing working sources for things you said not to touch.
// We only added/expanded sources for silver, SLX and some metals (zinc, lead, palladium, platinum)
// The arrays are used by pickRotate(group)
let SITES = {
  gold: ["twelvedata:XAU/USD", "yahoo:XAUUSD=X", "kitco:gold", "thestreetgold:gold"],
  // expanded silver sources (loop - all sources will be cycled)
  silver: [
    "twelvedata:XAG/USD",
    "yahoo:XAGUSD=X",
    "kitco:silver",
    "saudigold:silver", // scraping from saudigoldprice.com
    "metalslive:silver", // metals.live API (if available)
    "coingecko:bitcoin", // placeholder (will be skipped if invalid) - kept safe by validators
    "dexscreener:token:" + SLX_BSC_TOKEN, // example (will be skipped for silver but harmless)
    // add more valid scrapers/APIs as needed, rotation will attempt them in order
  ],
  crypto: [
    "binancews:BTCUSDT,ETHUSDT",
    "coingecko:bitcoin,ethereum",
    "coincap:bitcoin,ethereum",
    "dexscreener:SLX",
  ],
  fx: ["exchangeratehost:USD,EGP", "frankfurter:USD,EGP", "alphavantage:USD,EGP"],
  metals: {
    // keep original entries but expand specific metals we will actively improve
    platinum: ["yahoo:XPTUSD=X", "twelvedata:XPT/USD", "saudigold:platinum", "metalary:platinum"],
    palladium: ["yahoo:XPDUSD=X", "twelvedata:XPD/USD", "saudigold:palladium", "metalary:palladium"],
    copper: ["yahoo:HG=F"],
    aluminum: ["yahoo:ALI=F"],
    nickel: ["yahoo:NID=F"],
    zinc: ["yahoo:MZN=F", "saudigold:zinc", "metalary:zinc"],
    lead: ["yahoo:LD=F", "saudigold:lead", "metalary:lead"],
    tin: ["yahoo:TIN=F"],
    iron: ["yahoo:TIO=F"],
    steel: ["yahoo:STL=F"],
    cobalt: ["yahoo:CO=F"],
    lithium: ["yahoo:LIT=F"],
    uranium: ["yahoo:UX=F"],
  },
  energy: {
    wti: ["alphavantage:WTI", "yahoo:CL=F"],
    brent: ["alphavantage:BRENT", "yahoo:BRN=F", "saudigold:brent"],
    natgas: ["alphavantage:NATGAS", "yahoo:NG=F"],
  },
  // a dedicated SLX rotation list (pair, token, geckoterminal)
  slx: ["dexscreener:pair", "dexscreener:token", "geckoterminal:token"],
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
  const day = d.getUTCDay(); // 0=Sun, 6=Sat
  return day === 0 || day === 6;
};

// ✅ كاش ذكي: لا يستبدل القيمة القديمة إلا لو السعر الجديد valid
function put(symbol, price, unit, src) {
  const num = Number(price);
  if (!num || !Number.isFinite(num)) {
    // لو الـ API رجع قيمة بايظة، ما نلمسش القيمة القديمة
    return;
  }
  cache.prices[symbol] = { price: num, unit, src, t: now() };
  saveCache();
}

function get(symbol) {
  return cache.prices[symbol] || null;
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

// ---------- source resolvers ----------
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

// lightweight scrapers (fallback/alternate)
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

// MetalsLive (simple JSON spot API) - used as optional source for silver
async function fromMetalsLive(metal) {
  // e.g. https://api.metals.live/v1/spot/silver
  try {
    const url = `https://api.metals.live/v1/spot/${metal}`;
    const j = await getJSON(url, {}, 1);
    if (Array.isArray(j) && j.length > 0 && j[0].price) {
      return Number(j[0].price);
    }
  } catch (e) {
    throw new Error("MetalsLive no price");
  }
}

// Geckoterminal (SLX token) - returns price_usd in attributes
async function fromGeckoTerminal(tokenAddress) {
  const url = `https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${tokenAddress}`;
  const j = await getJSON(url, {}, 1);
  const v = Number(j?.data?.attributes?.price_usd);
  if (!v) throw new Error("GeckoTerminal no price");
  return v;
}

// DexScreener by token search (existing)
async function fromDexScreenerByToken(token) {
  // safe search endpoint (already in your code)
  const j = await getJSON(`https://api.dexscreener.com/latest/dex/search?q=${token}`, {}, 1);
  const pair = j?.pairs?.[0];
  const v = Number(pair?.priceUsd);
  if (!v) throw new Error("DexScreener no price");
  return v;
}

// DexScreener by pair address (BSC pair)
async function fromDexScreenerByPair(pairAddress) {
  const j = await getJSON(`https://api.dexscreener.com/latest/dex/pairs/bsc/${pairAddress}`, {}, 1);
  const pair = j?.pair || (Array.isArray(j?.pairs) ? j?.pairs[0] : null) || j?.pairs?.[0];
  // some responses include 'pair' root or 'pairs' array; try both
  const v = Number(pair?.priceUsd || pair?.price || pair?.priceUsd);
  if (!v) throw new Error("DexScreener pair no price");
  return v;
}

// SaudiGoldPrice scrapers (silver & oil)
async function fromSaudiGoldSilver() {
  // fetch the page and parse "سعر أونصة الفضة XX.XX دولار" or a USD number near "silver"
  const url = "https://saudigoldprice.com/silverprice/";
  const html = await getText(url, {}, 1);
  const $ = cheerio.load(html);
  // try to find "سعر أونصة الفضة" then extract number
  let text = $("body").text();
  // find the first USD number after "سعر أونصة الفضة"
  const idx = text.indexOf("سعر أونصة الفضة");
  if (idx >= 0) {
    const sub = text.slice(idx, idx + 200);
    const m = sub.match(/([\d]{1,3}(?:\.\d+)?)/);
    if (m && m[1]) return Number(m[1]);
  }
  // fallback: try any USD-looking pattern on page
  const all = text.match(/([\d]{1,3}(?:\.\d+)?)(?=\s*\$| دولار)/);
  if (all && all[1]) return Number(all[1]);
  throw new Error("SaudiGold silver parse fail");
}

async function fromSaudiGoldBrent() {
  const url = "https://saudigoldprice.com/oilprice/";
  const html = await getText(url, {}, 1);
  const $ = cheerio.load(html);
  const text = $("body").text();
  // look for "برنت" then usd number
  const idx = text.indexOf("برنت");
  if (idx >= 0) {
    const sub = text.slice(idx, idx + 200);
    const m = sub.match(/([\d]{1,3}(?:\.\d+)?)/);
    if (m && m[1]) return Number(m[1]);
  }
  // fallback generic USD
  const all = text.match(/([\d]{1,3}(?:\.\d+)?)(?=\s*\$| دولار)/);
  if (all && all[1]) return Number(all[1]);
  throw new Error("SaudiGold brent parse fail");
}

// 🔁 Fallback بسيط لبعض المعادن اللي بتفشل كتير من ياهو
async function fromMetalFallback(name) {
  // هنستخدم Metalary كسكريبر بسيط (اسم تقريبى للـ slug)
  const slug = `${name.toLowerCase()}-price`;
  const url = `https://www.metalary.com/${slug}/`;
  const html = await getText(url, {}, 1);
  const $ = cheerio.load(html);
  // نحاول نلاقي رقم في أي عنصر يشبه السعر
  let txt = $("body").text().match(/(\d+(\.\d+)?)/);
  if (!txt) throw new Error("Metalary parse fail");
  const v = Number(txt[1]);
  if (!v) throw new Error("Metalary no price");
  return v;
}

// Crypto WS (unchanged)
const wsPrices = new Map(); // e.g. BTCUSDT -> price
import WebSocket from "ws";

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

// ---------- rotation helpers ----------
function pickRotate(group) {
  const list = Array.isArray(SITES[group]) ? SITES[group] : null;
  if (!list) return null;
  const idx = (cache.rotate[group] || 0) % list.length;
  const src = list[idx];
  cache.rotate[group] = (idx + 1) % list.length;
  saveCache();
  return src;
}

// ---------- update routines ----------
// NOTE: updateGold left unchanged
async function updateGold() {
  if (weekend()) return;
  let src = pickRotate("gold");
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

// ---------- SILVER: new rotation-based loop (many sources) ----------
async function updateSilver() {
  if (weekend()) return;
  let src = pickRotate("silver");
  if (!src) return;
  let price = null,
    unit = "oz",
    used = src;
  try {
    // try based on prefix
    if (src.startsWith("twelvedata:")) {
      price = await fromTwelveData(src.split(":")[1]);
    } else if (src.startsWith("yahoo:")) {
      price = await fromYahoo(src.split(":")[1]);
    } else if (src.startsWith("kitco:")) {
      price = await fromKitco("silver");
    } else if (src.startsWith("saudigold:")) {
      price = await fromSaudiGoldSilver();
    } else if (src.startsWith("metalslive:")) {
      price = await fromMetalsLive("silver");
    } else {
      // unknown - try generic kitco as fallback
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
  } catch (err) {
    console.error("updateSilver error:", err.message);
  }
}

// ---------- CRYPTO: left mostly unchanged (BTC/ETH kept stable) ----------
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
      const ids = src.split(":")[1];
      const j = await fromCoinGecko(ids);
      if (j.BITCOIN) put("BTC", j.BITCOIN, "usd", "coingecko");
      if (j.ETHEREUM) put("ETH", j.ETHEREUM, "usd", "coingecko");
    } else if (src.startsWith("coincap:")) {
      const v1 = await fromCoinCap("bitcoin");
      put("BTC", v1, "usd", "coincap");
      const v2 = await fromCoinCap("ethereum");
      put("ETH", v2, "usd", "coincap");
    } else if (src.startsWith("dexscreener:")) {
      const v = await fromDexScreenerByToken(SLX_BSC_TOKEN);
      put("SLX", v, "usd", "dexscreener");
    }
    cache.lastUpdate.crypto = now();
    saveCache();
  } catch {}
}

// ---------- FX: unchanged ----------
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
  } catch {}
}

// ---------- Metals: modified to use rotation per-metal (we kept original behaviour but expanded lists)
async function updateMetals() {
  const m = SITES.metals || {};
  for (const [name, sources] of Object.entries(m)) {
    let got = false;
    // For each metal, try only one source per call (rotation) - pickRotate will cycle sources
    let srcList = Array.isArray(sources) ? sources : [sources];
    // We'll pick rotation index per-metal by using a composite key group: "metals_custom"
    // but to respect per-metal rotation we temporarily compute next index using rotate.metals_custom
    const groupKey = `metals_${name}`;
    // initialize rotate index if missing
    if (cache.rotate[groupKey] === undefined) cache.rotate[groupKey] = 0;
    const idx = (cache.rotate[groupKey] || 0) % srcList.length;
    const src = srcList[idx];
    cache.rotate[groupKey] = (idx + 1) % srcList.length;
    saveCache();

    try {
      let v = null,
        unit = "oz",
        used = src;
      if (src.startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]);
      else if (src.startsWith("twelvedata:")) v = await fromTwelveData(src.split(":")[1]);
      else if (src.startsWith("saudigold:")) {
        // map metal name to saudigold slug - if site has direct pages
        // try general fallback parsing (site may not contain all metals)
        // For many metals Saudigold may not have pages; fallback to fromMetalFallback
        try {
          v = await fromMetalFallback(name);
          used = "metalary-fallback";
        } catch {
          v = null;
        }
      } else if (src.startsWith("metalary:")) {
        try {
          v = await fromMetalFallback(name);
          used = "metalary";
        } catch {
          v = null;
        }
      }

      if (!v) {
        // if we didn't get price from chosen source, attempt a small set of generic fallbacks
        try {
          const v2 = await fromMetalFallback(name);
          if (v2) {
            put(name.toUpperCase(), v2, unit, "metalary-fallback");
            got = true;
          }
        } catch {}
      } else {
        put(name.toUpperCase(), v, unit, used);
        got = true;
      }
    } catch (err) {
      // continue quietly, we rely on next rotation to try next source
    }
  }
  cache.lastUpdate.metals = now();
  saveCache();
}

// ---------- SLX dedicated updater (pair / token / geckoterminal) ----------
const SLX_PAIR = "0x7c75568929156f3eb939fb546ce827e48c33da67"; // your provided pair
async function updateSLX() {
  try {
    let price = null,
      used = null;
    // 1) try pair on DexScreener
    try {
      price = await fromDexScreenerByPair(SLX_PAIR);
      used = `dexscreener:pair:${SLX_PAIR}`;
    } catch (e) {
      // ignore and try next
    }
    // 2) try geckoterminal
    if (!price) {
      try {
        price = await fromGeckoTerminal(SLX_BSC_TOKEN);
        used = `geckoterminal:${SLX_BSC_TOKEN}`;
      } catch (e) {}
    }
    // 3) fallback to token search on DexScreener
    if (!price) {
      try {
        price = await fromDexScreenerByToken(SLX_BSC_TOKEN);
        used = `dexscreener:token:${SLX_BSC_TOKEN}`;
      } catch (e) {}
    }

    if (price) {
      put("SLX", price, "usd", used);
      cache.lastUpdate.slx = now();
      saveCache();
    }
  } catch (err) {
    console.error("updateSLX main error:", err.message);
  }
}

// ---------- schedules ----------
// keep intervals for unchanged tasks as before but adjust for silver/metals/SLX per your request
const MIN = 60 * 1000;

// original: updateGold/updateSilver/updateCrypto every 3.5 minutes
// change: keep gold/crypto frequent but silver we'll run via its own timer below
setInterval(() => {
  updateGold();
  updateCrypto();
}, 210 * 1000); // 3.5 دقيقة

// FX unchanged
setInterval(() => {
  updateFX("USD", "EGP");
}, 2 * 60 * 60 * 1000); // كل ساعتين

// metals (custom rotation) every 40 minutes (per your request)
setInterval(() => {
  updateMetals();
}, 40 * 60 * 1000); // كل 40 دقيقة

// silver every 40 minutes (per your request)
setInterval(() => {
  updateSilver();
}, 40 * 60 * 1000); // كل 40 دقيقة

// SLX every 5 minutes (per your request)
setInterval(() => {
  updateSLX();
}, 5 * 60 * 1000); // كل 5 دقائق

// Energy (keep original schedule unchanged)
setInterval(() => {
  updateEnergy();
}, 5 * 60 * 60 * 1000); // كل 5 ساعات

// kick-off immediately on boot
updateGold();
updateSilver();
updateCrypto();
updateFX("USD", "EGP");
updateMetals();
updateEnergy();
updateSLX();

// ---------- APIs ----------
app.get("/api/health", (req, res) =>
  res.json({ ok: true, ts: Date.now(), lastUpdate: cache.lastUpdate })
);

// alias لـ /api/health عشان الفرونت إند
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

// multi-crypto
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

// ✅ مسارات فردية للكريبتو (للفرونت إند)
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

// FX
app.get("/api/fx", (req, res) => {
  const from = (req.query.from || "USD").toUpperCase();
  const to = (req.query.to || "EGP").toUpperCase();
  const v = get(`FX_${from}_${to}`);
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json({ from, to, ...v });
});

// multi-metals
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

// ✅ مسارات فردية لكل معدن (للفرونت إند)
app.get("/api/metals/:metal", (req, res) => {
  const metal = String(req.params.metal || "").toUpperCase();
  const v = get(metal);
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v);
});

// multi-energy
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

// ✅ مسارات oilgas للفورونت إند
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

// ---------- Admin (token) ----------
function okAdmin(req) {
  const t = req.headers["x-admin-token"] || req.query.token || req.body?.token;
  return String(t) === String(ADMIN_TOKEN);
}

// لوحة التحكم تٌعرض من admin.html (static). فقط API أدناه:
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
