// server.js
// Backend for GoldenPrice - updated: metals.dev-only updates for specified metals, 30-day history, chart/change endpoints.
// ESM module (type: "module" in package.json)

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
const EXR_HOST = process.env.EXR_HOST || "https://api.exchangerate.host";
const METALS_DEV_API_KEY = process.env.METALS_DEV_API_KEY || ""; // general
const METALS_DEV_KEY1 = process.env.METALS_DEV_KEY1 || ""; // e.g. zinc/aluminum/copper
const METALS_DEV_KEY2 = process.env.METALS_DEV_KEY2 || ""; // e.g. lead/nickel/platinum/palladium
const SLX_BSC_TOKEN = process.env.SLX_BSC_TOKEN || "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d";
const SLX_PAIR_ADDRESS = process.env.SLX_PAIR_ADDRESS || "0x7c755e961a8d415c4074bc7d3ba0b85f039c5168";

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "x-admin-token"] }));
app.options("*", cors());
app.use(express.static(__dirname));

// ---------- cache + history ----------
let cache = {
  prices: {},        // symbol -> { price, unit, src, t }
  lastUpdate: {},    // symbol/group -> timestamp
  rotate: {
    gold: 0,
    silver: 0,
    crypto: 0,
    fx: 0,
    slxLoop: 0,
    silverLoop: 0,
    metalsLoop: {},
  },
  history: {},       // symbol -> [{ date: 'YYYY-MM-DD', value }]
};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const j = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      cache = { ...cache, ...j };
      cache.rotate = cache.rotate || {};
      cache.rotate.metalsLoop = cache.rotate.metalsLoop || {};
      cache.history = cache.history || {};
    }
  } catch (e) {
    console.error("loadCache error:", e.message);
  }
}
function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error("saveCache error:", e.message);
  }
}
loadCache();

// ---------- sites (keeps original lists; SITES.metals may be overridden by sites.json) ----------
let SITES = {
  gold: [
    "twelvedata:XAU/USD",
    "yahoo:XAUUSD=X",
    "kitco:gold",
    "thestreetgold:gold"
  ],
  silver: ["twelvedata:XAG/USD", "yahoo:XAGUSD=X", "kitco:silver"],
  crypto: [
    "binancews:BTCUSDT,ETHUSDT",
    "coingecko:bitcoin,ethereum",
    "coincap:bitcoin,ethereum",
    "dexscreener:SLX"
  ],
  fx: ["exchangeratehost:USD,EGP", "frankfurter:USD,EGP", "alphavantage:USD,EGP"],
  metals: {}, // will be overridden if sites.json present
  energy: {
    wti: ["alphavantage:WTI", "yahoo:CL=F"],
    brent: ["alphavantage:BRENT", "yahoo:BRN=F"],
    natgas: ["alphavantage:NATGAS", "yahoo:NG=F"]
  }
};
try {
  if (fs.existsSync(SITES_FILE)) {
    const j = JSON.parse(fs.readFileSync(SITES_FILE, "utf8"));
    SITES = { ...SITES, ...j };
  }
} catch (e) {
  console.error("load sites.json error", e.message);
}

// ---------- helpers ----------
const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0,10);
}
function isValidNumber(n) {
  if (n === null || n === undefined) return false;
  const num = Number(n);
  if (!Number.isFinite(num)) return false;
  if (num <= 0) return false;
  if (num > 1e12) return false;
  return true;
}

// put: update current price and append daily history (1 entry per day, keep last 30)
function put(symbol, price, unit="usd", src="unknown") {
  try {
    if (!isValidNumber(price)) return;
    const num = Number(price);
    cache.prices[symbol] = { price: num, unit, src, t: now() };
    // history logic (one entry per day)
    cache.history = cache.history || {};
    const hist = cache.history[symbol] || [];
    const today = todayISO();
    if (!hist.length || hist[hist.length - 1].date !== today) {
      hist.push({ date: today, value: num });
      const MAX = 30;
      if (hist.length > MAX) hist.splice(0, hist.length - MAX);
      cache.history[symbol] = hist;
    } else {
      hist[hist.length - 1].value = num;
      cache.history[symbol] = hist;
    }
    cache.lastUpdate[symbol] = now();
    saveCache();
  } catch (e) {
    console.error("put error", e.message);
  }
}
function get(symbol) {
  return cache.prices[symbol] || null;
}

// fetch helpers
async function getJSON(url, opts={}, retries=1) {
  let lastErr;
  for (let i=0;i<=retries;i++) {
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
async function getText(url, opts={}, retries=1) {
  let lastErr;
  for (let i=0;i<=retries;i++) {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (err) {
      lastErr = err;
      await sleep(200);
    }
  }
  throw lastErr;
}

// parse numeric candidates in page text (used only when explicit scrapers are added)
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

// 1) TwelveData
async function fromTwelveData(pair) {
  if (!TWELVEDATA_KEY) throw new Error("no TWELVEDATA_KEY");
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(pair)}&apikey=${TWELVEDATA_KEY}`;
  const j = await getJSON(url);
  const v = Number(j?.price);
  if (!v) throw new Error("TD no price");
  return v;
}

// 2) Yahoo finance (chart API)
async function fromYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?region=US&lang=en-US`;
  const j = await getJSON(url);
  const v = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!v) throw new Error("Yahoo no price");
  return Number(v);
}

// 3) Kitco (basic)
async function fromKitco(metal) {
  const map = { gold: "gold-price-today-usa", silver: "silver-price-today-usa" };
  const slug = map[metal] || "gold-price-today-usa";
  const html = await getText(`https://www.kitco.com/${slug}.html`);
  // best-effort parsing
  const m = html.match(/[\d,]+\.\d+/);
  if (!m) throw new Error("Kitco parse fail");
  const num = Number(m[0].replace(/,/g,""));
  if (!isValidNumber(num)) throw new Error("Kitco number invalid");
  return num;
}

// 4) CoinGecko simple price (for cryptos list)
async function fromCoinGecko(idsCSV) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${idsCSV}&vs_currencies=usd`;
  const j = await getJSON(url);
  const out = {};
  idsCSV.split(",").forEach((id)=>{
    const v = Number(j?.[id]?.usd);
    if (v) out[id.toUpperCase()] = v;
  });
  if (!Object.keys(out).length) throw new Error("CG no prices");
  return out;
}

// 5) CoinCap single asset
async function fromCoinCap(id) {
  const j = await getJSON(`https://api.coincap.io/v2/assets/${id}`);
  const v = Number(j?.data?.priceUsd);
  if (!v) throw new Error("CoinCap no price");
  return v;
}

// 6) DexScreener token
async function fromDexScreenerByToken(token) {
  const j = await getJSON(`https://api.dexscreener.com/latest/dex/search?q=${token}`);
  const pair = j?.pairs?.[0];
  const v = Number(pair?.priceUsd);
  if (!v) throw new Error("DexScreener no price");
  return v;
}

// 7) Geckoterminal token (SLX)
async function fromGeckoTerminal(tokenAddress) {
  const url = `https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${tokenAddress.toLowerCase()}`;
  const j = await getJSON(url);
  const v = Number(j?.data?.attributes?.price_usd);
  if (!v) throw new Error("GeckoTerminal no price");
  return v;
}

// 8) metals.dev single metal endpoint (we will use multiple keys mapping)
async function fromMetalsDevWithKey(metal, apiKey) {
  if (!apiKey) throw new Error("no metals.dev key provided");
  const url = `https://api.metals.dev/v1/metal/spot?api_key=${encodeURIComponent(apiKey)}&metal=${encodeURIComponent(metal)}&currency=USD`;
  const j = await getJSON(url, {}, 1);
  // response example: { status: "success", timestamp: "...", currency: "USD", unit: "...", metal: "...", rate: { price: 3016.99, ... } }
  const price = Number(j?.rate?.price || j?.rate?.ask || j?.rate?.bid);
  if (!isValidNumber(price)) throw new Error("metals.dev no price");
  return price;
}
async function fromMetalsDev(metal) {
  // mapping: use KEY1 for zinc, aluminum, copper ; KEY2 for lead,nickel,platinum,palladium ; else METALS_DEV_API_KEY
  const m = String(metal).toLowerCase();
  if (["zinc","aluminum","aluminium","copper"].includes(m) && METALS_DEV_KEY1) {
    return await fromMetalsDevWithKey(m, METALS_DEV_KEY1);
  }
  if (["lead","nickel","platinum","palladium"].includes(m) && METALS_DEV_KEY2) {
    return await fromMetalsDevWithKey(m, METALS_DEV_KEY2);
  }
  if (METALS_DEV_API_KEY) return await fromMetalsDevWithKey(m, METALS_DEV_API_KEY);
  throw new Error("no metals.dev key available for " + metal);
}

// ---------- crypto websocket (for realtime BTC/ETH) ----------
const wsPrices = new Map();
function startBinanceWS(symbols = ["btcusdt","ethusdt"]) {
  try {
    const streams = symbols.map(s => `${s}@ticker`).join("/");
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    ws.on("message", (buf) => {
      try {
        const j = JSON.parse(buf.toString());
        const d = j?.data;
        if (d?.s && d?.c) wsPrices.set(d.s, Number(d.c));
      } catch(_) {}
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
  let src = pickRotate("gold");
  if (!src) return;
  try {
    let price = null;
    if (src.startsWith("twelvedata:")) price = await fromTwelveData(src.split(":")[1]);
    else if (src.startsWith("yahoo:")) price = await fromYahoo(src.split(":")[1]);
    else if (src.startsWith("kitco:")) price = await fromKitco("gold");
    else if (src.startsWith("thestreetgold:")) {
      // best-effort generic fetch (kept simple)
      const html = await getText("https://www.thestreet.com/quote/gold-price");
      const m = html.match(/[\d,]+\.\d+/);
      if (m) price = Number(m[0].replace(/,/g,""));
    }
    if (isValidNumber(price)) {
      put("GOLD", price, "oz", src);
      cache.lastUpdate.gold = now();
      saveCache();
    }
  } catch(e) {}
}

async function updateSilver() {
  let src = pickRotate("silver");
  if (!src) return;
  try {
    let price = null;
    if (src.startsWith("twelvedata:")) price = await fromTwelveData(src.split(":")[1]);
    else if (src.startsWith("yahoo:")) price = await fromYahoo(src.split(":")[1]);
    else if (src.startsWith("kitco:")) price = await fromKitco("silver");
    // If metals.dev key present and you want metals.dev for silver, it will be handled by metals loop (we don't force it here).
    if (isValidNumber(price)) {
      put("SILVER", price, "oz", src);
      cache.lastUpdate.silver = now();
      saveCache();
    }
  } catch(e) {}
}

// Crypto: expand to top 10 (CoinGecko), plus WS for BTC/ETH
async function updateCrypto() {
  try {
    // first: WS values for BTC/ETH if present
    const btc = wsPrices.get("BTCUSDT");
    const eth = wsPrices.get("ETHUSDT");
    if (btc) put("BTC", btc, "usd", "binancews");
    if (eth) put("ETH", eth, "usd", "binancews");

    // coinGecko group (ids)
    const ids = "bitcoin,ethereum,binancecoin,cardano,solana,ripple,dogecoin,matic,tron,polkadot";
    const j = await fromCoinGecko(ids);
    if (j.BITCOIN) put("BTC", j.BITCOIN, "usd", "coingecko");
    if (j.ETHEREUM) put("ETH", j.ETHEREUM, "usd", "coingecko");
    if (j.BINANCECOIN) put("BNB", j.BINANCECOIN, "usd", "coingecko");
    if (j.CARDANO) put("ADA", j.CARDANO, "usd", "coingecko");
    if (j.SOLANA) put("SOL", j.SOLANA, "usd", "coingecko");
    if (j.RIPPLE) put("XRP", j.RIPPLE, "usd", "coingecko");
    if (j.DOGECOIN) put("DOGE", j.DOGECOIN, "usd", "coingecko");
    if (j.MATIC) put("MATIC", j.MATIC, "usd", "coingecko");
    if (j.TRON) put("TRX", j.TRON, "usd", "coingecko");
    if (j.POLKADOT) put("DOT", j.POLKADOT, "usd", "coingecko");

    // SLX special path via dex/geckoterminal
    try {
      const slx = await fromGeckoTerminal(SLX_BSC_TOKEN);
      if (isValidNumber(slx)) put("SLX", slx, "usd", "geckoterminal");
    } catch(e) {
      try {
        const slx2 = await fromDexScreenerByToken(SLX_BSC_TOKEN);
        if (isValidNumber(slx2)) put("SLX", slx2, "usd", "dexscreener");
      } catch(_) {}
    }

    cache.lastUpdate.crypto = now();
    saveCache();
  } catch (e) {}
}

// FX
async function updateFX(base="USD", quote="EGP") {
  try {
    const src = pickRotate("fx");
    if (!src) return;
    if (src.startsWith("exchangeratehost:")) {
      const v = await getJSON(`${EXR_HOST}/convert?from=${base}&to=${quote}`);
      const val = Number(v?.result);
      if (val) put(`FX_${base}_${quote}`, val, "rate", "ERH");
    } else if (src.startsWith("frankfurter:")) {
      const v = await getJSON(`https://api.frankfurter.app/latest?from=${base}&to=${quote}`);
      const val = Number(v?.rates?.[quote]);
      if (val) put(`FX_${base}_${quote}`, val, "rate", "Frankfurter");
    } else if (src.startsWith("alphavantage:")) {
      if (!ALPHAVANTAGE_KEY) throw new Error("no ALPHAVANTAGE_KEY");
      const j = await getJSON(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${base}&to_currency=${quote}&apikey=${ALPHAVANTAGE_KEY}`);
      const val = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
      if (val) put(`FX_${base}_${quote}`, val, "rate", "AlphaVantage");
    }
    cache.lastUpdate.fx = now();
    saveCache();
  } catch (e) {}
}

// ---------- METALS updates (using metals.dev only for the metals you asked) ----------

// Metals list that must use metals.dev and update every 22 hours
const METALS_DEV_LIST_KEY1 = ["zinc","aluminum","aluminium","copper"]; // use KEY1
const METALS_DEV_LIST_KEY2 = ["lead","nickel","platinum","palladium"];   // use KEY2
const METALS_DEV_OTHERS = ["tin","iron","steel","cobalt","lithium","uranium","uranium"]; // attempt METALS_DEV_API_KEY if set

// general update function for a given metal name (lowercase)
async function updateMetalFromMetalsDev(metal) {
  try {
    const m = metal.toLowerCase();
    const price = await fromMetalsDev(m);
    if (isValidNumber(price)) {
      // mapping symbol: uppercase common symbols, else use metal uppercase
      const symbolMap = {
        zinc: "ZINC",
        aluminum: "ALUMINUM",
        aluminium: "ALUMINUM",
        copper: "COPPER",
        lead: "LEAD",
        nickel: "NICKEL",
        platinum: "PLATINUM",
        palladium: "PALLADIUM",
        tin: "TIN",
        iron: "IRON",
        steel: "STEEL",
        cobalt: "COBALT",
        lithium: "LITHIUM",
        uranium: "URANIUM"
      };
      const sym = symbolMap[m] || m.toUpperCase();
      put(sym, price, "usd", `metals.dev:${m}`);
      cache.lastUpdate[sym] = now();
      saveCache();
    }
  } catch (e) {
    // don't fallback to scrapers per request
    // just ignore and keep cached value
  }
}

// start metals/dev loops: scheduled every 22 hours for those metals
function startMetalsDevLoops() {
  const toUpdate = Array.from(new Set([...METALS_DEV_LIST_KEY1, ...METALS_DEV_LIST_KEY2, ...METALS_DEV_OTHERS]));
  // initial run
  toUpdate.forEach(m => updateMetalFromMetalsDev(m).catch(()=>{}));
  // schedule every 22 hours (22*60*60*1000)
  const INTERVAL = 22 * 60 * 60 * 1000;
  setInterval(() => {
    toUpdate.forEach(m => updateMetalFromMetalsDev(m).catch(()=>{}));
  }, INTERVAL);
}

// ---------- original generic metals update (kept for other metals configured in SITES.metals if present) ----------
async function updateMetalsGeneric() {
  const m = SITES.metals || {};
  for (const [name, sources] of Object.entries(m)) {
    let got = false;
    for (const src of sources) {
      try {
        let v = null;
        if (typeof src === "string" && src.startsWith("yahoo:")) v = await fromYahoo(src.split(":")[1]);
        else if (typeof src === "string" && src.startsWith("twelvedata:")) v = await fromTwelveData(src.split(":")[1]);
        if (v && isValidNumber(v)) {
          put(name.toUpperCase(), v, "oz", src);
          got = true;
          break;
        }
      } catch(_) {}
    }
    // do not fallback to generic scrapers per your last instruction
    if (!got) {
      // keep existing cached value
    }
  }
  cache.lastUpdate.metals = now();
  saveCache();
}

// ---------- schedules ----------
// keep original rotation for gold/silver/crypto fx
setInterval(() => { updateGold(); updateSilver(); updateCrypto(); }, 210 * 1000); // 3.5 min
setInterval(() => updateFX("USD","EGP"), 2 * 60 * 60 * 1000); // 2h
setInterval(() => updateMetalsGeneric(), 3 * 60 * 60 * 1000); // 3h - for any configured SITES.metals non-metals.dev sources
// energy updates remain
setInterval(() => updateEnergyIfExists(), 5 * 60 * 60 * 1000); // 5h

// start metals.dev loops (22h)
startMetalsDevLoops();

// kick-off initial runs
updateGold(); updateSilver(); updateCrypto(); updateFX("USD","EGP"); updateMetalsGeneric(); updateEnergyIfExists();

// helper for energy (safe wrapper - if alpha keys exist we call)
async function updateEnergyIfExists(){
  try {
    const e = SITES.energy || {};
    for (const [name, sources] of Object.entries(e)) {
      let got = false;
      for (const src of sources) {
        try {
          let v = null;
          if (typeof src === "string" && src.startsWith("alphavantage:")) {
            // alpha energy functions not implemented fully here — skip if no key
            if (!ALPHAVANTAGE_KEY) continue;
            // implement a lightweight fetch if needed in future
          } else if (typeof src === "string" && src.startsWith("yahoo:")) {
            v = await fromYahoo(src.split(":")[1]);
          }
          if (v && isValidNumber(v)) {
            put(name.toUpperCase(), v, "usd", src);
            got = true;
            break;
          }
        } catch(_) {}
      }
    }
    cache.lastUpdate.energy = now();
    saveCache();
  } catch(e) {}
}

// ---------- history/chart/change endpoints ----------
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
  try {
    if (period.endsWith("h")) {
      const hrs = Number(period.slice(0,-1));
      if (hrs <= 24) {
        if (hist.length < 2) return res.json({ symbol, change_percent: 0 });
        const last = hist[hist.length-1].value;
        const prev = hist[hist.length-2].value;
        const change = ((last - prev) / prev) * 100;
        return res.json({ symbol, change_percent: Number(change.toFixed(4)) });
      } else {
        const daysBack = Math.round(hrs/24);
        const idx = Math.max(0, hist.length - 1 - daysBack);
        const last = hist[hist.length-1].value;
        const prev = hist[idx].value;
        const change = ((last - prev) / prev) * 100;
        return res.json({ symbol, change_percent: Number(change.toFixed(4)) });
      }
    } else if (period.endsWith("d")) {
      const days = Number(period.slice(0,-1));
      const idx = Math.max(0, hist.length - 1 - days);
      const last = hist[hist.length-1].value;
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

// ---------- existing APIs (kept & consistent output) ----------
app.get("/api/health", (req, res) => res.json({ ok:true, ts: Date.now(), lastUpdate: cache.lastUpdate }));
app.get("/api/status", (req, res) => res.json({ ok:true, ts: Date.now(), lastUpdate: cache.lastUpdate }));

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
  const list = (req.query.list || "BTC,ETH,SLX").split(",").map(s => s.trim().toUpperCase());
  const out = {};
  for (const s of list) out[s] = get(s) || { error: "Not found" };
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
  const list = (req.query.list || "ZINC,ALUMINUM,COPPER,LEAD,NICKEL,PLATINUM,PALLADIUM,TIN,IRON,STEEL,COBALT,LITHIUM,URANIUM")
    .split(",").map(s => s.trim().toUpperCase());
  const out = {};
  for (const m of list) out[m] = get(m) || { error: "Not found" };
  res.json(out);
});
app.get("/api/metals/:metal", (req, res) => {
  const metal = String(req.params.metal || "").toUpperCase();
  const v = get(metal);
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v);
});

app.get("/api/energy", (req, res) => {
  const list = (req.query.list || "WTI,BRENT,NATGAS").split(",").map(s => s.trim().toUpperCase());
  const out = {};
  for (const n of list) out[n] = get(n) || { error: "Not found" };
  res.json(out);
});
app.get("/api/oilgas/wti", (req, res) => { const v = get("WTI"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });
app.get("/api/oilgas/brent", (req, res) => { const v = get("BRENT"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });
app.get("/api/oilgas/gas", (req, res) => { const v = get("NATGAS"); if (!v) return res.status(404).json({ error: "Not found" }); res.json(v); });

// ---------- admin ----------
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
  const { symbol, price, unit = "usd"} = req.body || {};
  if (!symbol || !price) return res.status(400).json({ error: "symbol and price required" });
  put(String(symbol).toUpperCase(), Number(price), unit, "manual");
  res.json({ ok:true, saved: cache.prices[String(symbol).toUpperCase()] });
});
app.post("/api/admin/refresh", (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  const what = String(req.body?.what || "all").toLowerCase();
  const tasks = [];
  if (what==="all" || what==="gold") tasks.push(updateGold());
  if (what==="all" || what==="silver") tasks.push(updateSilver());
  if (what==="all" || what==="crypto") tasks.push(updateCrypto());
  if (what==="all" || what==="fx") tasks.push(updateFX("USD","EGP"));
  if (what==="all" || what==="metals") tasks.push(updateMetalsGeneric());
  if (what==="all" || what==="energy") tasks.push(updateEnergyIfExists());
  Promise.allSettled(tasks).then(()=>res.json({ ok:true, lastUpdate: cache.lastUpdate }));
});
app.post("/api/admin/cache/clear", (req, res) => {
  if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  cache.prices = {};
  saveCache();
  res.json({ ok:true });
});

// ---------- start ----------
app.listen(PORT, () => console.log(`Backend running on :${PORT}`));
