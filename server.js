// server.js (ESM)
// ====== Imports ======
import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ====== ENV & App ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "ADMIN_12345";
const TWELVEDATA_KEY = process.env.TWELVEDATA_KEY || "";
const ALPHAVANTAGE_KEY = process.env.ALPHAVANTAGE_KEY || "";
const METALPRICE_KEY = process.env.METALPRICE_KEY || "";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // <-- لخدمة /admin.html

// ====== Load Sites Map (rotation) ======
let SITES = {};
try {
  SITES = JSON.parse(fs.readFileSync(path.join(__dirname, "sites.json"), "utf8"));
  console.log("[BOOT] sites.json loaded.");
} catch (e) {
  console.error("[BOOT] sites.json missing or invalid, using built-in minimal map.", e.message);
  SITES = {}; // سيستبدل بمحتوى ملفك المرفق أدناه
}

// ====== In-memory cache & helpers ======
const cache = {
  gold: null, silver: null,
  crypto: {},        // e.g. { BTC: {...}, ETH: {...}, SLX: {...} }
  metals: {},        // e.g. { COPPER: {...}, ... }
  oilgas: {},        // { WTI: {...}, BRENT: {...}, GAS: {...} }
  fx: {},            // keyed "USD:EGP"
  last: { gold:null, silver:null, crypto:null, metals:null, oilgas:null, fx:null }
};

const rotIndex = {}; // rotation pointer per key
const logs = [];     // ring buffer logs
const log = (msg, lvl="INFO") => {
  const line = `[${new Date().toISOString()}] ${lvl} ${msg}`;
  console.log(line);
  logs.push(line);
  if (logs.length > 1000) logs.shift();
};
const weekend = () => {
  const d = new Date().getUTCDay(); // 0=Sun .. 6=Sat
  return (d === 0 || d === 6);
};

// ====== Utils ======
const readJSON = async (res) => { try { return await res.json(); } catch { return null; } };
const readText = async (res) => { try { return await res.text(); } catch { return ""; } };

const setCache = (bucket, key, usd, source) => {
  const item = { usd: Number(usd), source, t: Date.now() };
  if (bucket === "gold" || bucket === "silver") cache[bucket] = item;
  else cache[bucket][key] = item;
};

const pickNext = (bucket, key) => {
  const map = SITES[bucket]?.[key] || [];
  if (!map.length) return null;
  const rid = `${bucket}:${key}`;
  rotIndex[rid] = ((rotIndex[rid] ?? -1) + 1) % map.length;
  return map[rotIndex[rid]];
};

// ====== Fetchers (APIs & Scrapers) ======
// Each provider descriptor: { type:"api"|"scrape", name, url, …parser… }

async function fetchFromProvider(desc, ctx) {
  try {
    if (desc.type === "api") {
      let url = desc.url;
      // expand placeholders
      url = url.replace("{TWELVEDATA_KEY}", TWELVEDATA_KEY)
               .replace("{ALPHAVANTAGE_KEY}", ALPHAVANTAGE_KEY)
               .replace("{METALPRICE_KEY}", METALPRICE_KEY)
               .replace("{SYMBOL}", ctx?.symbol ?? "")
               .replace("{FROM}", ctx?.from ?? "")
               .replace("{TO}", ctx?.to ?? "");

      const r = await fetch(url, { timeout: 20000 });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await readJSON(r);
      const usd = await desc.parser(j, ctx);
      if (usd == null || isNaN(usd)) throw new Error("no price");
      return { usd, via: desc.name };
    }

    if (desc.type === "scrape") {
      const r = await fetch(desc.url, { timeout: 20000, headers: desc.headers || {} });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await readText(r);
      const $ = cheerio.load(html);
      const usd = await desc.selector($, ctx);
      if (usd == null || isNaN(usd)) throw new Error("no number");
      return { usd, via: desc.name };
    }

    throw new Error("unknown provider type");
  } catch (e) {
    throw new Error(`${desc.name}: ${e.message}`);
  }
}

// ====== Rotating update per key ======
async function rotateUpdate(bucket, key, ctx) {
  const p = pickNext(bucket, key);
  if (!p) { log(`NO PROVIDERS for ${bucket}:${key}`, "ERROR"); return false; }
  try {
    const { usd, via } = await fetchFromProvider(p, ctx);
    setCache(bucket, key, usd, via);
    cache.last[bucket] = new Date().toISOString();
    log(`SET ${bucket.toUpperCase()}:${key ?? ""} = ${usd} USD via ${via}`);
    return true;
  } catch (e) {
    log(`ERR ${bucket.toUpperCase()}:${key ?? ""} => ${e.message}`, "ERROR");
    return false;
  }
}

// ====== Schedules ======
// gold/silver: every 3.5 minutes (skip Sat/Sun)
// crypto: every 5 minutes
// metals/oilgas/fx: every 2 hours
const MS = {
  GOLD_SILVER: 3.5 * 60 * 1000,
  CRYPTO: 5 * 60 * 1000,
  SLOW: 2 * 60 * 60 * 1000
};

async function updateGoldSilver() {
  if (weekend()) return; // توفير ريكوست
  await rotateUpdate("metals", "gold");
  await rotateUpdate("metals", "silver");
}
async function updateCrypto() {
  for (const sym of Object.keys(SITES.crypto || {})) {
    await rotateUpdate("crypto", sym, { symbol: sym });
  }
}
async function updateMetals() {
  for (const k of Object.keys(SITES.metals || {})) {
    if (k === "gold" || k === "silver") continue;
    await rotateUpdate("metals", k);
  }
}
async function updateOilGas() {
  for (const k of Object.keys(SITES.oilgas || {})) {
    await rotateUpdate("oilgas", k);
  }
}
async function updateFX() {
  for (const k of Object.keys(SITES.fx || {})) {
    const [from, to] = k.split(":");
    await rotateUpdate("fx", k, { from, to });
  }
}

// Kick-off intervals
setInterval(updateGoldSilver, MS.GOLD_SILVER);
setInterval(updateCrypto, MS.CRYPTO);
setInterval(updateMetals, MS.SLOW);
setInterval(updateOilGas, MS.SLOW);
setInterval(updateFX, MS.SLOW);

// Warmup on boot
(async () => {
  log("Server warmup fired.");
  await updateGoldSilver();
  await updateCrypto();
  await updateMetals();
  await updateOilGas();
  await updateFX();
})();

// ====== API Routes ======
app.get("/", (req, res) => res.json({ ok: true, ts: Date.now() }));

// Quick reads
app.get("/api/gold", (req, res) => res.json(cache.metals?.gold || {}));
app.get("/api/silver", (req, res) => res.json(cache.metals?.silver || {}));
app.get("/api/crypto/:symbol", (req, res) => {
  res.json(cache.crypto?.[req.params.symbol.toUpperCase()] || {});
});
app.get("/api/oilgas", (req, res) => res.json(cache.oilgas || {}));
app.get("/api/metals", (req, res) => {
  const list = (req.query.list || "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return res.json(cache.metals || {});
  const out = {};
  for (const k of list) out[k.toUpperCase()] = cache.metals?.[k] || null;
  res.json(out);
});
app.get("/api/fx", (req, res) => {
  const from = (req.query.from || "USD").toUpperCase();
  const to = (req.query.to || "EGP").toUpperCase();
  res.json(cache.fx?.[`${from}:${to}`] || {});
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

app.get("/api/logs", (req, res) => {
  res.json({ lines: logs.slice(-200) });
});

// Force rotate now (no token needed per اتفاقنا للـ auto)
app.post("/api/updateAll", async (req, res) => {
  await updateGoldSilver();
  await updateCrypto();
  await updateMetals();
  await updateOilGas();
  await updateFX();
  res.json({ ok:true, last: cache.last });
});

// ====== Admin manual set/clear ======
function auth(req, res) {
  const token = req.headers.authorization?.split(" ")[1] || req.body.token;
  if (token !== ADMIN_TOKEN) { res.status(401).json({ error:"unauthorized" }); return false; }
  return true;
}

app.post("/api/admin/set", (req, res) => {
  if (!auth(req, res)) return;
  const { category, key, usd } = req.body;
  if (!category || usd == null) return res.status(400).json({ error:"bad request" });
  const bucket = category.toLowerCase();
  if (bucket === "gold" || bucket === "silver") {
    setCache("metals", bucket, usd, "Manual");
  } else if (bucket === "crypto") {
    setCache("crypto", key.toUpperCase(), usd, "Manual");
  } else if (bucket === "metals") {
    setCache("metals", key.toUpperCase(), usd, "Manual");
  } else if (bucket === "oilgas") {
    setCache("oilgas", key.toUpperCase(), usd, "Manual");
  } else if (bucket === "fx") {
    const fxKey = key.toUpperCase(); // e.g. "USD:EGP"
    setCache("fx", fxKey, usd, "Manual");
  } else {
    return res.status(400).json({ error:"unknown category" });
  }
  log(`ADMIN SET ${category}:${key ?? ""} = ${usd}`);
  return res.json({ ok:true });
});

app.post("/api/admin/clear", (req, res) => {
  if (!auth(req, res)) return;
  const { category, key } = req.body;
  const bucket = (category||"").toLowerCase();
  if (bucket === "gold" || bucket === "silver") cache.metals[bucket] = null;
  else if (bucket && key) {
    if (cache[bucket]) cache[bucket][key.toUpperCase()] = null;
  }
  log(`ADMIN CLEAR ${category}:${key ?? ""}`);
  res.json({ ok:true });
});

// ====== Start ======
app.listen(PORT, () => log(`Server running on :${PORT}`));
