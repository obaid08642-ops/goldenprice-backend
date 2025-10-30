import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// ========= ENV =========
const PORT = process.env.PORT || 10000;

const ADMIN_TOKEN       = process.env.ADMIN_TOKEN || "CHANGE_ME_ADMIN_123";
const TWELVEDATA_KEY    = process.env.TWELVEDATA_KEY || "";
const ALPHAVANTAGE_KEY  = process.env.ALPHAVANTAGE_KEY || "";
const METALPRICE_KEY    = process.env.METALPRICE_KEY || "";
const EXCHANGERATE_KEY  = process.env.EXCHANGERATE_KEY || "";
const COINGECKO_KEY     = process.env.COINGECKO_KEY || "";
const COINCAP_KEY       = process.env.COINCAP_KEY || "";
const SILVERX_CONTRACT  = process.env.SILVERX_CONTRACT || "";

// ========= STATIC (Admin UI) =========
app.use(express.static("public"));

// ========= HELPERS =========
const nowISO = () => new Date().toISOString();
const isWeekend = () => {
  const d = new Date().getUTCDay(); // 0 Sun, 6 Sat
  return d === 0 || d === 6;
};
const okNum = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

async function jfetch(url, opt = {}) {
  const res = await fetch(url, { timeout: 20000, ...opt });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ========= CACHE =========
// هيكل الكاش: { gold: {usd, source, t}, silver:{}, crypto:{BTC:{}, ETH:{}}, metals:{X:{},...}, oilgas:{WTI:{},...}, fx:{USD_EUR:{},...}}
const cache = {
  gold: null,
  silver: null,
  crypto: {},     // symbol -> {usd, source, t}
  metals: {},     // metal code -> {usdPerUnit, source, t}
  oilgas: {},     // {WTI, BRENT, NG}
  fx: {},         // "USD_EUR" -> rate
  last: {}        // category -> ISO time
};

// ========= ROTATION WINDOWS (minutes) =========
const ROTATE_MINUTES = 3;            // كل 3 دقائق نبدّل المصدر
const AV_INTERVAL_HOURS = 6;         // AlphaVantage كل 6 ساعات (توفير ريكوست)
const WEEKEND_PAUSE = true;          // إيقاف الدهب/الفضة في الويك إند

// ========= PROVIDERS: GOLD / SILVER =========
// 1) TwelveData
async function getGoldFromTwelve() {
  if (!TWELVEDATA_KEY) throw new Error("No TwelveData key");
  const u = `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${TWELVEDATA_KEY}`;
  const j = await jfetch(u);
  const price = parseFloat(j.price);
  if (!okNum(price)) throw new Error("bad price twelve gold");
  return { usd: price, source: "twelvedata" };
}
async function getSilverFromTwelve() {
  if (!TWELVEDATA_KEY) throw new Error("No TwelveData key");
  const u = `https://api.twelvedata.com/price?symbol=XAG/USD&apikey=${TWELVEDATA_KEY}`;
  const j = await jfetch(u);
  const price = parseFloat(j.price);
  if (!okNum(price)) throw new Error("bad price twelve silver");
  return { usd: price, source: "twelvedata" };
}

// 2) MetalPriceAPI
async function getFromMetalPrice(symbol /* XAU|XAG */) {
  if (!METALPRICE_KEY) throw new Error("No MetalPriceAPI key");
  const u = `https://api.metalpriceapi.com/v1/latest?api_key=${METALPRICE_KEY}&base=USD&currencies=${symbol}`;
  const j = await jfetch(u);
  const val = j.rates?.[symbol];
  if (!okNum(val)) throw new Error("bad metalprice rate");
  // API returns number of SYMBOL per USD, invert to get USD per SYMBOL (1 unit)
  const usd = 1 / val;
  return { usd, source: "metalpriceapi" };
}

// 3) AlphaVantage (XAUUSD / XAGUSD via FX)? غير متاح مباشر كـ price فنعتمد على metalprice/twelve
// نستخدمه للمشتقات والنفط.. (سيُستدعى في فئات أخرى)

// 4) ExchangeRate / Frankfurter (للـ FX لو احتجنا تحويلات)
// احتياطي فقط — هنا لا نستخدمه مباشرة للذهب/الفضة

// 5) TheStreetGold (scrape)
async function getGoldFromTheStreet() {
  const url = "https://www.thestreet.com/quote/gold"; // صفحة عامة
  const html = await (await fetch(url)).text();
  const $ = cheerio.load(html);
  // محاولة انتقاء رقم (fallback عام)
  const txt = $("body").text();
  const m = txt.replace(/,/g, "").match(/Gold[^0-9]{0,20}(\d{3,5}\.?\d{0,2})/i);
  if (!m) throw new Error("parse thestreet failed");
  const price = parseFloat(m[1]);
  if (!okNum(price)) throw new Error("bad thestreet price");
  return { usd: price, source: "thestreet" };
}

// دوران المصادر
const goldProviders = [getGoldFromTwelve, () => getFromMetalPrice("XAU"), getGoldFromTheStreet];
const silverProviders = [getSilverFromTwelve, () => getFromMetalPrice("XAG")];

function pickProviderIndex() {
  const minute = Math.floor(Date.now() / (ROTATE_MINUTES * 60 * 1000));
  return minute % 3; // حتى لو القائمة أقصر سنعدّل بالـ clamp
}

// ========= CRYPTO =========
async function getCryptoFromCG(symbol /* 'bitcoin','ethereum' */) {
  const u = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(symbol)}&vs_currencies=usd`;
  const j = await jfetch(u);
  const usd = j?.[symbol]?.usd;
  if (!okNum(usd)) throw new Error("coingecko empty");
  return { usd, source: "coingecko" };
}

// ========= OIL / GAS (AlphaVantage) =========
async function getAVCommodity(func /* 'WTI'|'BRENT'|'NATURAL_GAS' */) {
  if (!ALPHAVANTAGE_KEY) throw new Error("No AlphaVantage key");
  const u = `https://www.alphavantage.co/query?function=${func}&interval=daily&apikey=${ALPHAVANTAGE_KEY}`;
  const j = await jfetch(u);
  const series = j?.data || j?.intervals || j?.series || j; // مرونة
  // fallback: بعض الردود تأتي بهذا الشكل:
  const last = j?.data?.[0]?.value ?? j?.[Object.keys(j).find(k=>k.toLowerCase().includes("price"))];
  if (okNum(last)) return { usd: last, source: `alphavantage:${func}` };
  // محاولة عامة
  let val;
  if (Array.isArray(series) && series[0]) {
    const any = Object.values(series[0]).find(v => okNum(parseFloat(v)));
    val = parseFloat(any);
  }
  if (!okNum(val)) throw new Error("AV parse fail");
  return { usd: val, source: `alphavantage:${func}` };
}

// ========= INDUSTRIAL & RARE METALS (17) =========
// سنحاول عبر MetalPriceAPI إن توفرت الرموز؛ وإلا نتركها فارغة لحين توفر خطة مناسبة.
const METAL_CODES = {
  // ثمينة
  XAU: "Gold",
  XAG: "Silver",
  XPT: "Platinum",
  XPD: "Palladium",
  // صناعية / أساسية (سنحاول بـ TradingEconomics لاحقًا لو رغبت)
  COPPER: "Copper",
  ALUMINUM: "Aluminum",
  NICKEL: "Nickel",
  ZINC: "Zinc",
  LEAD: "Lead",
  TIN: "Tin",
  IRON: "Iron",
  STEEL: "Steel",
  // نادرة (placeholder names)
  RHODIUM: "Rhodium",
  COBALT: "Cobalt",
  LITHIUM: "Lithium",
  URANIUM: "Uranium",
  TITANIUM: "Titanium"
};

async function getMetalUSD(metalCode) {
  // XAU/XAG/XPT/XPD تدعمها MetalPriceAPI؛
  const mapMP = { XAU: "XAU", XAG: "XAG", XPT: "XPT", XPD: "XPD" };
  if (mapMP[metalCode]) return getFromMetalPrice(mapMP[metalCode]);
  // لبقية المعادن الصناعية — سنحاول AlphaVantage (غير متاح بشكل موحد) لذا نعيد null مؤقتًا
  throw new Error("unsupported on current free tier");
}

// ========= FX (احتياطي للتحويل) =========
async function getUsdEur() {
  const u = "https://api.frankfurter.dev/latest?from=USD&to=EUR";
  const j = await jfetch(u);
  const rate = j?.rates?.EUR;
  if (!okNum(rate)) throw new Error("fx empty");
  return { rate, source: "frankfurter" };
}

// ========= SILVERX (PancakeSwap) =========
async function getSilverX() {
  if (!SILVERX_CONTRACT || !SILVERX_CONTRACT.startsWith("0x")) {
    throw new Error("SILVERX_CONTRACT missing");
  }
  const u = `https://api.pancakeswap.info/api/v2/tokens/${SILVERX_CONTRACT}`;
  const j = await jfetch(u);
  const price = parseFloat(j?.data?.price);
  if (!okNum(price)) throw new Error("pancakeswap empty");
  return { usd: price, source: "pancakeswap" };
}

// ========= UPDATE FUNCTIONS =========
async function updateGold() {
  if (WEEKEND_PAUSE && isWeekend() && cache.gold) return cache.gold; // استخدم الكاش في الويك إند
  const idx = clamp(pickProviderIndex(), 0, goldProviders.length - 1);
  const order = [...goldProviders.slice(idx), ...goldProviders.slice(0, idx)];
  for (const fn of order) {
    try {
      const r = await fn();
      cache.gold = { ...r, t: Date.now() };
      cache.last.gold = nowISO();
      return cache.gold;
    } catch {}
  }
  if (!cache.gold) throw new Error("all gold providers failed");
  return cache.gold;
}

async function updateSilver() {
  if (WEEKEND_PAUSE && isWeekend() && cache.silver) return cache.silver;
  const idx = clamp(pickProviderIndex(), 0, silverProviders.length - 1);
  const order = [...silverProviders.slice(idx), ...silverProviders.slice(0, idx)];
  for (const fn of order) {
    try {
      const r = await fn();
      cache.silver = { ...r, t: Date.now() };
      cache.last.silver = nowISO();
      return cache.silver;
    } catch {}
  }
  if (!cache.silver) throw new Error("all silver providers failed");
  return cache.silver;
}

async function updateCrypto(symList = ["bitcoin", "ethereum"]) {
  for (const s of symList) {
    try {
      const r = await getCryptoFromCG(s);
      cache.crypto[s.toUpperCase()] = { ...r, t: Date.now() };
    } catch {}
  }
  cache.last.crypto = nowISO();
  return cache.crypto;
}

async function updateOilGas() {
  // لتقليل الاستهلاك، لا نحدث AlphaVantage إلا كل AV_INTERVAL_HOURS
  const last = cache.last.oilgas ? new Date(cache.last.oilgas) : null;
  const need = !last || (Date.now() - last.getTime()) > AV_INTERVAL_HOURS * 3600 * 1000;
  if (!need && Object.keys(cache.oilgas).length) return cache.oilgas;

  const map = { WTI: "WTI", BRENT: "BRENT", NG: "NATURAL_GAS" };
  for (const k of Object.keys(map)) {
    try {
      const r = await getAVCommodity(map[k]);
      cache.oilgas[k] = { ...r, t: Date.now() };
    } catch {}
  }
  cache.last.oilgas = nowISO();
  return cache.oilgas;
}

async function updateMetals() {
  const keys = Object.keys(METAL_CODES);
  for (const m of keys) {
    try {
      const r = await getMetalUSD(m);
      cache.metals[m] = { usd: r.usd, source: r.source, t: Date.now() };
    } catch {
      // نتركها كما هي إن فشلت
    }
  }
  cache.last.metals = nowISO();
  return cache.metals;
}

async function updateFX() {
  try {
    const r = await getUsdEur();
    cache.fx["USD_EUR"] = { rate: r.rate, source: r.source, t: Date.now() };
    cache.last.fx = nowISO();
  } catch {}
  return cache.fx;
}

// ========= SCHEDULER =========
async function autoRefresh() {
  try { await updateGold(); } catch {}
  try { await updateSilver(); } catch {}
  try { await updateCrypto(["bitcoin","ethereum"]); } catch {}
  try { await updateOilGas(); } catch {}
  try { await updateMetals(); } catch {}
  try { await updateFX(); } catch {}
}
// أول تشغيل + كل دقيقة
autoRefresh();
setInterval(autoRefresh, 60 * 1000);

// ========= ADMIN AUTH =========
function isAdmin(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : (req.query.token || req.body?.token);
  return token && token === ADMIN_TOKEN;
}

// ========= ROUTES =========
app.get("/", (req, res) => {
  res.json({ message: "GoldenPrice backend running successfully ✅", time: nowISO() });
});

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    last: cache.last,
    keys: {
      TWELVEDATA: !!TWELVEDATA_KEY,
      METALPRICEAPI: !!METALPRICE_KEY,
      ALPHAVANTAGE: !!ALPHAVANTAGE_KEY
    }
  });
});

// Gold / Silver
app.get("/api/gold", async (req, res) => {
  try { res.json(await updateGold()); }
  catch (e) { res.status(503).json({ error: String(e.message || e) }); }
});
app.get("/api/silver", async (req, res) => {
  try { res.json(await updateSilver()); }
  catch (e) { res.status(503).json({ error: String(e.message || e) }); }
});

// Crypto
app.get("/api/crypto/:symbol", async (req, res) => {
  try {
    const sym = (req.params.symbol || "").toLowerCase();
    const r = await getCryptoFromCG(sym);
    cache.crypto[sym.toUpperCase()] = { ...r, t: Date.now() };
    res.json(cache.crypto[sym.toUpperCase()]);
  } catch (e) { res.status(503).json({ error: String(e.message || e) }); }
});

// Oil & Gas
app.get("/api/oilgas", async (req, res) => {
  try { res.json(await updateOilGas()); }
  catch (e) { res.status(503).json({ error: String(e.message || e) }); }
});

// Metals (17)
app.get("/api/metals", async (req, res) => {
  try { res.json(await updateMetals()); }
  catch (e) { res.status(503).json({ error: String(e.message || e) }); }
});
app.get("/api/metals/:code", async (req, res) => {
  try {
    const c = (req.params.code || "").toUpperCase();
    if (!METAL_CODES[c]) return res.status(404).json({ error: "Unknown metal" });
    const r = await getMetalUSD(c);
    cache.metals[c] = { usd: r.usd, source: r.source, t: Date.now() };
    res.json(cache.metals[c]);
  } catch (e) { res.status(503).json({ error: String(e.message || e) }); }
});

// SilverX
app.get("/api/silverx", async (req, res) => {
  try {
    const r = await getSilverX();
    res.json({ ...r, t: Date.now() });
  } catch (e) { res.status(503).json({ error: String(e.message || e) }); }
});

// FX
app.get("/api/fx/usd-eur", async (req, res) => {
  try { res.json(await getUsdEur()); }
  catch (e) { res.status(503).json({ error: String(e.message || e) }); }
});

// ========= ADMIN (manual override/update) =========
app.post("/api/admin/set", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: "Unauthorized" });
  const { category, key, value, source } = req.body || {};
  if (!category) return res.status(400).json({ error: "category required" });

  const stamp = { t: Date.now(), source: source || "manual" };

  try {
    if (category === "gold") cache.gold = { usd: Number(value), ...stamp };
    else if (category === "silver") cache.silver = { usd: Number(value), ...stamp };
    else if (category === "crypto" && key) {
      cache.crypto[key.toUpperCase()] = { usd: Number(value), ...stamp };
    } else if (category === "metals" && key) {
      cache.metals[key.toUpperCase()] = { usd: Number(value), ...stamp };
    } else if (category === "oilgas" && key) {
      cache.oilgas[key.toUpperCase()] = { usd: Number(value), ...stamp };
    } else {
      return res.status(400).json({ error: "bad payload" });
    }
    res.json({ ok: true, category, key: key || null, value: Number(value) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/admin/refresh", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    await autoRefresh();
    res.json({ ok: true, last: cache.last });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ========= BOOT =========
app.listen(PORT, () => {
  console.log(`Hybrid backend on ${PORT}`);
});
