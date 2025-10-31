/* GoldenPrice backend — stable rotating fetch + admin bindings
 * Runs on Render (PORT provided). No node-fetch needed (Node ≥18 has global fetch).
 */

import express from "express";
import cors from "cors";
import morgan from "morgan";

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

/* ====== CONFIG ====== */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "ADMIN_12345";
const PORT = process.env.PORT || 10000;

// intervals
const T_FAST = 210_000;   // 3.5 minutes (gold/silver/crypto)
const T_SLOW = 7_200_000; // 2 hours (oil/gas/metals/fx)

// helper: weekend pause for gold/silver
const isWeekend = () => {
  const d = new Date();
  const day = d.getUTCDay(); // 0 Sun, 6 Sat
  return day === 0 || day === 6;
};

/* ====== CACHE ====== */
const cache = {
  gold: { usd: null, ts: null, src: null },
  silver: { usd: null, ts: null, src: null },
  crypto: {},   // e.g. { BTC:{usd,ts,src}, ETH:{...}, SLX:{...} }
  energy: { WTI: { usd: null, ts: null, src: null }, GAS: { usd: null, ts: null, src: null } },
  metals: {
    COPPER: { usd: null, ts: null, src: null },
    PLATINUM: { usd: null, ts: null, src: null },
    PALLADIUM: { usd: null, ts: null, src: null }
  },
  fx: {},       // e.g. { "USD:EGP": { rate, ts, src } }
  manual: {}    // overrides: key -> {usd|rate, ts}
};

/* ====== SOURCE ROTATION STATE ====== */
const rot = {
  gold: 0,
  silver: 0,
  crypto: 0,
  energyWTI: 0,
  energyGAS: 0,
  metalsCOPPER: 0,
  metalsPLATINUM: 0,
  metalsPALLADIUM: 0,
  fx: 0
};

/* ====== SOURCES (no keys required) ======
   Yahoo finance quote API (server-side JSON) + CoinGecko + CoinCap + ExchangeRate.host   */
const YQ = (symbol) =>
  `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;

const sources = {
  gold: [
    async () => fromYahooF("GC=F", "Yahoo(GC=F)"),
    async () => fromTwelve("XAU/USD", "TwelveData(XAU/USD)")
  ],
  silver: [
    async () => fromYahooF("SI=F", "Yahoo(SI=F)"),
    async () => fromTwelve("XAG/USD", "TwelveData(XAG/USD)")
  ],
  crypto: [
    async (sym) => fromCoinGecko(sym, "CoinGecko"),
    async (sym) => fromCoinCap(sym, "CoinCap")
  ],
  energyWTI: [
    async () => fromYahooF("CL=F", "Yahoo(CL=F)")
  ],
  energyGAS: [
    async () => fromYahooF("NG=F", "Yahoo(NG=F)")
  ],
  metalsCOPPER: [
    async () => fromYahooF("HG=F", "Yahoo(HG=F)")
  ],
  metalsPLATINUM: [
    async () => fromYahooF("PL=F", "Yahoo(PL=F)")
  ],
  metalsPALLADIUM: [
    async () => fromYahooF("PA=F", "Yahoo(PA=F)")
  ],
  fx: [
    async (from, to) => fromFXHost(from, to, "ExchangeRate.host")
  ]
};

/* ====== LOW-LEVEL FETCHERS ====== */
async function fromYahooF(symbol, tag) {
  const r = await fetch(YQ(symbol));
  if (!r.ok) throw new Error(`${tag} http ${r.status}`);
  const j = await r.json();
  const q = j?.quoteResponse?.result?.[0];
  const price = q?.regularMarketPrice ?? q?.ask ?? q?.bid;
  if (typeof price !== "number") throw new Error(`${tag} no price`);
  return { usd: price, src: tag };
}

async function fromCoinGecko(sym, tag) {
  const id = sym.toLowerCase(); // btc, eth
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${tag} http ${r.status}`);
  const j = await r.json();
  const v = j?.[id]?.usd;
  if (typeof v !== "number") throw new Error(`${tag} no price`);
  return { usd: v, src: tag };
}

async function fromCoinCap(sym, tag) {
  const id = sym.toLowerCase();
  const r = await fetch(`https://api.coincap.io/v2/assets/${id}`);
  if (!r.ok) throw new Error(`${tag} http ${r.status}`);
  const j = await r.json();
  const v = Number(j?.data?.priceUsd);
  if (!isFinite(v)) throw new Error(`${tag} no price`);
  return { usd: v, src: tag };
}

async function fromTwelve(pair, tag) {
  // optional, will fail gracefully if rate-limited or no key
  const key = process.env.TWELVEDATA_KEY;
  if (!key) throw new Error("TD no key");
  const [base, quote] = pair.split("/");
  const url = `https://api.twelvedata.com/price?symbol=${base}/${quote}&apikey=${key}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${tag} http ${r.status}`);
  const j = await r.json();
  const v = Number(j?.price);
  if (!isFinite(v)) throw new Error(`${tag} no price`);
  return { usd: v, src: tag };
}

async function fromFXHost(from, to, tag) {
  const r = await fetch(`https://api.exchangerate.host/convert?from=${from}&to=${to}`);
  if (!r.ok) throw new Error(`${tag} http ${r.status}`);
  const j = await r.json();
  const v = Number(j?.result);
  if (!isFinite(v)) throw new Error(`${tag} no rate`);
  return { rate: v, src: tag };
}

/* ====== ROTATING UPDATERS ====== */
async function rotateAndSet(fnList, rotKey, setCb, ...args) {
  const idx = rot[rotKey] % fnList.length;
  rot[rotKey] = (idx + 1) % fnList.length;

  // try current, if fails try the others (don’t stop)
  for (let i = 0; i < fnList.length; i++) {
    const tryIdx = (idx + i) % fnList.length;
    try {
      const res = await fnList[tryIdx](...args);
      setCb(res.usd ?? res.rate, res.src);
      return { ok: true, src: res.src };
    } catch (e) {
      // continue to next source
      if (i === fnList.length - 1) return { ok: false, err: String(e) };
    }
  }
}

/* concrete updaters */
async function updGold() {
  if (isWeekend()) return; // pause to save requests (Sat/Sun)
  return rotateAndSet(sources.gold, "gold", (v, src) => {
    cache.gold = { usd: v, ts: Date.now(), src };
  });
}
async function updSilver() {
  if (isWeekend()) return;
  return rotateAndSet(sources.silver, "silver", (v, src) => {
    cache.silver = { usd: v, ts: Date.now(), src };
  });
}
async function updCrypto(sym = "btc") {
  sym = sym.toUpperCase();
  return rotateAndSet(sources.crypto, "crypto", (v, src) => {
    cache.crypto[sym] = { usd: v, ts: Date.now(), src };
  }, sym);
}
async function updEnergyWTI() {
  return rotateAndSet(sources.energyWTI, "energyWTI", (v, src) => {
    cache.energy.WTI = { usd: v, ts: Date.now(), src };
  });
}
async function updEnergyGAS() {
  return rotateAndSet(sources.energyGAS, "energyGAS", (v, src) => {
    cache.energy.GAS = { usd: v, ts: Date.now(), src };
  });
}
async function updMetal(name, rotKey, srcList) {
  return rotateAndSet(srcList, rotKey, (v, src) => {
    cache.metals[name] = { usd: v, ts: Date.now(), src };
  });
}
const updCopper = () => updMetal("COPPER", "metalsCOPPER", sources.metalsCOPPER);
const updPlatinum = () => updMetal("PLATINUM", "metalsPLATINUM", sources.metalsPLATINUM);
const updPalladium = () => updMetal("PALLADIUM", "metalsPALLADIUM", sources.metalsPALLADIUM);

async function updFX(from = "USD", to = "EGP") {
  return rotateAndSet(sources.fx, "fx", (v, src) => {
    cache.fx[`${from}:${to}`] = { rate: v, ts: Date.now(), src };
  }, from, to);
}

/* ====== TIMERS ====== */
function startTimers() {
  // fast loop
  setInterval(() => { if (!cache.manual.GOLD) updGold(); }, T_FAST);
  setInterval(() => { if (!cache.manual.SILVER) updSilver(); }, T_FAST);
  setInterval(() => { if (!cache.manual.BTC) updCrypto("btc"); }, T_FAST);

  // slow loop
  setInterval(() => { if (!cache.manual.WTI) updEnergyWTI(); }, T_SLOW);
  setInterval(() => { if (!cache.manual.GAS) updEnergyGAS(); }, T_SLOW);
  setInterval(() => { if (!cache.manual.COPPER) updCopper(); }, T_SLOW);
  setInterval(() => { if (!cache.manual.PLATINUM) updPlatinum(); }, T_SLOW);
  setInterval(() => { if (!cache.manual.PALLADIUM) updPalladium(); }, T_SLOW);
  setInterval(() => { updFX("USD","EGP"); }, T_SLOW);
}

/* ====== ADMIN AUTH ====== */
function needAdmin(req, res, next) {
  const h = req.headers.authorization || "";
  const tok = h.replace(/^Bearer\s+/i, "").trim();
  if (tok && tok === ADMIN_TOKEN) return next();
  res.status(401).json({ error: "unauthorized" });
}

/* ====== ROUTES ====== */
// status
app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    last: {
      gold: cache.gold.ts,
      silver: cache.silver.ts,
      crypto: cache.crypto.BTC?.ts ?? null,
      oilgas: Math.max(cache.energy.WTI.ts ?? 0, cache.energy.GAS.ts ?? 0) || null,
      metals: Math.max(cache.metals.COPPER.ts ?? 0, cache.metals.PLATINUM.ts ?? 0, cache.metals.PALLADIUM.ts ?? 0) || null,
      fx: cache.fx["USD:EGP"]?.ts ?? null
    },
    keys: {
      TWELVEDATA: !!process.env.TWELVEDATA_KEY
    }
  });
});

// gold/silver
app.get("/api/gold", (req, res) => res.json(cache.gold));
app.get("/api/silver", (req, res) => res.json(cache.silver));

// crypto
app.get("/api/crypto/:symbol", async (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  if (!cache.crypto[sym]) await updCrypto(sym);
  res.json(cache.crypto[sym] || { error: "no data" });
});

// oil & gas
app.get("/api/oilgas", (req, res) => {
  res.json({ WTI: cache.energy.WTI, GAS: cache.energy.GAS });
});

// metals multi
app.get("/api/metals", async (req, res) => {
  // ?list=copper,platinum,palladium
  const list = String(req.query.list || "copper,platinum").toUpperCase().split(",");
  const out = {};
  for (const k of list) {
    if (!cache.metals[k]) continue;
    out[k] = cache.metals[k];
  }
  res.json(out);
});

// fx
app.get("/api/fx", async (req, res) => {
  const from = String(req.query.from || "USD").toUpperCase();
  const to = String(req.query.to || "EGP").toUpperCase();
  const key = `${from}:${to}`;
  if (!cache.fx[key]) await updFX(from, to);
  res.json(cache.fx[key] || { error: "no data" });
});

/* ====== ADMIN ENDPOINTS ====== */
// Rotate all now (no token required per طلبك)
app.post("/api/update-all", async (req, res) => {
  try {
    await Promise.all([
      updGold(), updSilver(), updCrypto("btc"),
      updEnergyWTI(), updEnergyGAS(),
      updCopper(), updPlatinum(), updPalladium(),
      updFX("USD","EGP")
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// manual set/clear (needs token)
app.post("/api/admin/set", needAdmin, (req, res) => {
  const { category, key, value } = req.body || {};
  if (!category || !key || !(value || value === 0)) return res.status(400).json({ error: "bad payload" });

  const now = Date.now();
  const U = (usd, obj) => Object.assign(obj, { usd, ts: now, src: "MANUAL" });
  const R = (rate, obj) => Object.assign(obj, { rate, ts: now, src: "MANUAL" });

  switch (category) {
    case "metal":
      if (!cache.metals[key]) return res.status(400).json({ error: "unknown metal" });
      U(Number(value), cache.metals[key]);
      cache.manual[key] = true;
      break;
    case "gold":
      U(Number(value), cache.gold); cache.manual.GOLD = true; break;
    case "silver":
      U(Number(value), cache.silver); cache.manual.SILVER = true; break;
    case "crypto":
      if (!cache.crypto[key]) cache.crypto[key] = {};
      U(Number(value), cache.crypto[key]); cache.manual[key] = true; break;
    case "energy":
      if (!cache.energy[key]) return res.status(400).json({ error: "unknown energy" });
      U(Number(value), cache.energy[key]); cache.manual[key] = true; break;
    case "fx":
      R(Number(value), (cache.fx[key] ||= {})); cache.manual[key] = true; break;
    default:
      return res.status(400).json({ error: "unknown category" });
  }
  res.json({ ok: true, category, key, value });
});

app.post("/api/admin/clear", needAdmin, (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: "key required" });
  delete cache.manual[key];
  res.json({ ok: true, cleared: key });
});

/* ====== STATIC ADMIN PAGE ====== */
app.use(express.static(".")); // يخدم admin.html من الجذر

/* ====== BOOTSTRAP ====== */
app.listen(PORT, async () => {
  console.log(`Server running on :${PORT}`);
  // warm up initial fetches
  await Promise.allSettled([
    updGold(), updSilver(), updCrypto("btc"),
    updEnergyWTI(), updEnergyGAS(),
    updCopper(), updPlatinum(), updPalladium(),
    updFX("USD","EGP")
  ]);
  startTimers();
});
