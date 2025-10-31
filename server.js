import express from "express";

// ================== CONFIG ==================
const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "ADMIN_12345";

// تدوير المصادر: مؤشرات لكل فئة
const ROT = {
  gold: 0, silver: 0, crypto: 0,
  metals: 0, oilgas: 0, fx: 0
};

// فواصل زمنية (ثوانٍ)
const INTERVALS = {
  gold: 210,       // 3.5 min
  silver: 210,     // 3.5 min
  crypto: 210,     // 3.5 min
  metals: 7200,    // 120 min
  oilgas: 7200,    // 120 min
  fx: 7200         // 120 min
};

// ============== SOURCES (loop order) ==============
// Yahoo Finance quote API (غير رسمي لكنه JSON)
const YQ = s => `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(s)}`;
// CoinGecko & CoinCap
const CG_SIMPLE = ids => `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
const COINCAP = sym => `https://api.coincap.io/v2/assets/${sym}`;
// FX
const FX_HOST = (from,to) => `https://api.exchangerate.host/convert?from=${from}&to=${to}`;
const FX_FRANK = (from,to) => `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
// DexScreener (SLX) — ضع الـ pair أو الـ token في ENV إن أحببت
const DEX_SLX = process.env.DEXSCREENER_SLX || "";

// metals tickers على ياهو
const Y_TICK = {
  GOLD: "GC=F",
  SILVER: "SI=F",
  COPPER: "HG=F",
  PLATINUM: "PL=F",
  PALLADIUM: "PA=F",
  ALUMINUM: "ALI=F", // قد لا يتوفر دائمًا
  NICKEL: "NICKELM.NS", // بديل تقريبي (قد يفشل) — يمكن تغييره لاحقًا
  ZINC: "ZINC.NS",      // تقريبي
  TIN: "TIN.NS",        // تقريبي
  LEAD: "LEAD.NS"       // تقريبي
};

const ENERGY_TICK = {
  WTI: "CL=F",
  GAS: "NG=F",
  BRENT: "BZ=F"
};

// ============== CACHE ==============
const cache = {
  // المفاتيح ستكون مثل: GOLD, SILVER, CRYPTO:BTC, FX:USD:EGP, METAL:COPPER, ENERGY:WTI
  data: {}, // key -> { usd, source, at, manual?: true }
  last: { gold:null, silver:null, crypto:null, metals:null, oilgas:null, fx:null }
};

// ============== HELPERS ==============
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, timeoutMs=10000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: c.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function setValue(key, usd, source) {
  cache.data[key] = { usd: Number(usd), source, at: new Date().toISOString() };
}

function weekendPause() {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun,6=Sat
  return (day === 0 || day === 6);
}

function nextIndex(arrName, len) {
  ROT[arrName] = (ROT[arrName] + 1) % len;
  return ROT[arrName];
}

// ============== PROVIDERS ==============
// GOLD / SILVER (loop Yahoo -> TwelveData (اختياري))
async function updateGold() {
  if (weekendPause()) return; // توفير ريكوستات السبت/الأحد
  const sources = [
    async () => { // Yahoo
      const j = await fetchJson(YQ(Y_TICK.GOLD));
      const q = j.quoteResponse?.result?.[0];
      setValue("GOLD", q?.regularMarketPrice, "Yahoo(GC=F)");
    }
  ];
  // TwelveData إذا متاح مفتاح
  if (process.env.TWELVEDATA_KEY) {
    sources.push(async () => {
      const url = `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${process.env.TWELVEDATA_KEY}`;
      const j = await fetchJson(url);
      setValue("GOLD", j.price, "TwelveData(XAU/USD)");
    });
  }
  const i = nextIndex("gold", sources.length);
  await sources[i]().catch(()=>{});
  cache.last.gold = new Date().toISOString();
}

async function updateSilver() {
  if (weekendPause()) return;
  const sources = [
    async () => {
      const j = await fetchJson(YQ(Y_TICK.SILVER));
      const q = j.quoteResponse?.result?.[0];
      setValue("SILVER", q?.regularMarketPrice, "Yahoo(SI=F)");
    }
  ];
  if (process.env.TWELVEDATA_KEY) {
    sources.push(async () => {
      const url = `https://api.twelvedata.com/price?symbol=XAG/USD&apikey=${process.env.TWELVEDATA_KEY}`;
      const j = await fetchJson(url);
      setValue("SILVER", j.price, "TwelveData(XAG/USD)");
    });
  }
  const i = nextIndex("silver", sources.length);
  await sources[i]().catch(()=>{});
  cache.last.silver = new Date().toISOString();
}

// CRYPTO (BTC و ETH كمثال – تضيف رموز أخرى من الفرونت)
async function updateCrypto() {
  const sources = [
    async () => {
      const j = await fetchJson(CG_SIMPLE("bitcoin,ethereum"));
      if (j.bitcoin?.usd) setValue("CRYPTO:BTC", j.bitcoin.usd, "CoinGecko");
      if (j.ethereum?.usd) setValue("CRYPTO:ETH", j.ethereum.usd, "CoinGecko");
    },
    async () => {
      const b = await fetchJson(COINCAP("bitcoin"));
      const e = await fetchJson(COINCAP("ethereum"));
      if (b.data?.priceUsd) setValue("CRYPTO:BTC", b.data.priceUsd, "CoinCap");
      if (e.data?.priceUsd) setValue("CRYPTO:ETH", e.data.priceUsd, "CoinCap");
    }
  ];
  const i = nextIndex("crypto", sources.length);
  await sources[i]().catch(()=>{});
  // SLX (من DexScreener إن تم ضبطه) — وإلا نعتمد manual
  if (DEX_SLX) {
    try {
      const j = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/${DEX_SLX}`);
      const p = j.pairs?.[0]?.priceUsd;
      if (p) setValue("CRYPTO:SLX", p, "DexScreener");
    } catch {}
  }
  cache.last.crypto = new Date().toISOString();
}

// METALS إضافية (Copper/Platinum…)
async function updateMetals() {
  const list = [
    ["METAL:COPPER", Y_TICK.COPPER, "Copper"],
    ["METAL:PLATINUM", Y_TICK.PLATINUM, "Platinum"],
    ["METAL:PALLADIUM", Y_TICK.PALLADIUM, "Palladium"]
  ];
  const idx = nextIndex("metals", 1); // حاليًا مصدر واحد (Yahoo)، أضف مصادر أخرى لاحقًا
  if (idx === 0) {
    for (const [key,tkr,name] of list) {
      try {
        const j = await fetchJson(YQ(tkr));
        const q = j.quoteResponse?.result?.[0];
        if (q?.regularMarketPrice) setValue(key, q.regularMarketPrice, `Yahoo(${tkr})`);
      } catch {}
    }
  }
  cache.last.metals = new Date().toISOString();
}

// OIL & GAS
async function updateOilGas() {
  const sources = [
    async () => { // Yahoo
      for (const [key,tkr] of [["ENERGY:WTI", ENERGY_TICK.WTI], ["ENERGY:GAS", ENERGY_TICK.GAS]]) {
        try {
          const j = await fetchJson(YQ(tkr));
          const q = j.quoteResponse?.result?.[0];
          if (q?.regularMarketPrice) setValue(key, q.regularMarketPrice, `Yahoo(${tkr})`);
        } catch {}
      }
    }
  ];
  const i = nextIndex("oilgas", sources.length);
  await sources[i]().catch(()=>{});
  cache.last.oilgas = new Date().toISOString();
}

// FX (مثال: USD->EGP) — يشتغل عند الطلب أيضًا
async function updateFX(from="USD", to="EGP") {
  const sources = [
    async () => {
      const j = await fetchJson(FX_HOST(from,to));
      if (j.result) setValue(`FX:${from}:${to}`, j.result, "exchangerate.host");
    },
    async () => {
      const j = await fetchJson(FX_FRANK(from,to));
      const v = j.rates?.[to];
      if (v) setValue(`FX:${from}:${to}`, v, "frankfurter.app");
    }
  ];
  const i = nextIndex("fx", sources.length);
  await sources[i]().catch(()=>{});
  cache.last.fx = new Date().toISOString();
}

// ============== SCHEDULERS ==============
function schedule(fn, secs) {
  fn().catch(()=>{});
  setInterval(() => fn().catch(()=>{}), secs * 1000);
}
schedule(updateGold,   INTERVALS.gold);
schedule(updateSilver, INTERVALS.silver);
schedule(updateCrypto, INTERVALS.crypto);
schedule(updateMetals, INTERVALS.metals);
schedule(updateOilGas, INTERVALS.oilgas);
// FX يحدث حين يُطلب أو كل 120 دقيقة لزوج USD/EGP
schedule(() => updateFX("USD","EGP"), INTERVALS.fx);

// ============== SERVER ==============
const app = express();
app.use(express.json());
app.use(express.static("public")); // يقدم /admin.html

// auth helper
function requireAdmin(req, res, next) {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : h;
  if (tok !== ADMIN_TOKEN) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ======= APIs =======
app.get("/api/status", (req,res)=>{
  res.json({
    ok: true,
    last: cache.last,
    keys: Object.keys(cache.data).length
  });
});

app.get("/api/gold", (req,res)=> res.json(cache.data["GOLD"]||{}));
app.get("/api/silver", (req,res)=> res.json(cache.data["SILVER"]||{}));

app.get("/api/crypto/:symbol", (req,res)=>{
  const k = `CRYPTO:${req.params.symbol.toUpperCase()}`;
  res.json(cache.data[k]||{});
});

app.get("/api/metals", (req,res)=>{
  // ?list=copper,platinum
  const out = {};
  const list = (req.query.list||"COPPER,PLATINUM").split(",").map(s=>s.trim().toUpperCase());
  for (const n of list) out[n] = cache.data[`METAL:${n}`] || {};
  res.json(out);
});

app.get("/api/oilgas", (req,res)=>{
  res.json({
    WTI: cache.data["ENERGY:WTI"]||{},
    GAS: cache.data["ENERGY:GAS"]||{}
  });
});

app.get("/api/fx", async (req,res)=>{
  const from = (req.query.from||"USD").toUpperCase();
  const to = (req.query.to||"EGP").toUpperCase();
  const k = `FX:${from}:${to}`;
  if (!cache.data[k]) await updateFX(from,to).catch(()=>{});
  res.json(cache.data[k]||{});
});

// ======= Admin endpoints =======
app.post("/admin/refresh", async (_req,res)=>{
  // يدير التتابع فورًا لكل الفئات
  await Promise.all([
    updateGold(), updateSilver(), updateCrypto(),
    updateMetals(), updateOilGas(), updateFX("USD","EGP")
  ]).catch(()=>{});
  res.json({ ok:true, last: cache.last });
});

app.post("/admin/manual", requireAdmin, (req,res)=>{
  const { key, usd } = req.body || {};
  if (!key || typeof usd === "undefined") return res.status(400).json({ error:"missing key or usd" });
  setValue(key.toUpperCase(), usd, "MANUAL");
  cache.data[key.toUpperCase()].manual = true;
  res.json({ ok:true, key: key.toUpperCase(), value: cache.data[key.toUpperCase()] });
});

app.delete("/admin/manual/:key", requireAdmin, (req,res)=>{
  const k = req.params.key.toUpperCase();
  if (cache.data[k]?.manual) delete cache.data[k];
  res.json({ ok:true, key:k });
});

app.listen(PORT, ()=> {
  console.log(`Server running on :${PORT}`);
});
