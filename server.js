// server.js (Final with Debug + Update Logs)
import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
app.use(express.static(path.join(__dirname, "public")));

let SITES = {};
try {
  SITES = JSON.parse(fs.readFileSync(path.join(__dirname, "sites.json"), "utf8"));
  console.log("[BOOT] sites.json loaded.");
} catch (e) {
  console.error("[BOOT] Failed to load sites.json:", e.message);
  SITES = {};
}

const cache = {
  metals: {},
  crypto: {},
  oilgas: {},
  fx: {},
  last: {}
};

const rotIndex = {};
const logs = [];

function log(msg, level = "INFO") {
  const line = `[${new Date().toISOString()}] ${level} ${msg}`;
  console.log(line);
  logs.push(line);
  if (logs.length > 500) logs.shift();
}

const weekend = () => {
  const d = new Date().getUTCDay();
  return d === 0 || d === 6;
};

const setCache = (bucket, key, usd, source) => {
  const obj = { usd: Number(usd), source, t: Date.now() };
  if (!cache[bucket]) cache[bucket] = {};
  cache[bucket][key] = obj;
};

const pickNext = (bucket, key) => {
  const map = SITES[bucket]?.[key] || [];
  if (!map.length) return null;
  const rid = `${bucket}:${key}`;
  rotIndex[rid] = ((rotIndex[rid] ?? -1) + 1) % map.length;
  return map[rotIndex[rid]];
};

async function fetchFromProvider(desc, ctx) {
  try {
    let url = desc.url;
    url = url
      .replace("{TWELVEDATA_KEY}", TWELVEDATA_KEY)
      .replace("{ALPHAVANTAGE_KEY}", ALPHAVANTAGE_KEY)
      .replace("{METALPRICE_KEY}", METALPRICE_KEY)
      .replace("{SYMBOL}", ctx?.symbol ?? "");

    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (desc.type === "api") {
      const j = await r.json();
      const parserFn = eval(desc.parser);
      const usd = parserFn(j, ctx);
      if (!usd || isNaN(usd)) throw new Error("no valid price");
      return { usd, via: desc.name };
    } else {
      const html = await r.text();
      const $ = cheerio.load(html);
      const selectorFn = eval(desc.selector);
      const usd = selectorFn($, ctx);
      if (!usd || isNaN(usd)) throw new Error("no valid scrape result");
      return { usd, via: desc.name };
    }
  } catch (e) {
    throw new Error(`${desc.name}: ${e.message}`);
  }
}

async function rotateUpdate(bucket, key, ctx) {
  const src = pickNext(bucket, key);
  if (!src) return;
  try {
    const { usd, via } = await fetchFromProvider(src, ctx);
    setCache(bucket, key, usd, via);
    log(`✅ ${bucket.toUpperCase()}:${key} updated ${usd} USD via ${via}`);
  } catch (e) {
    log(`❌ ${bucket}:${key} ${e.message}`, "ERROR");
  }
}

// INTERVAL LOG HERE
setInterval(() => {
  log("🟢 Auto-update cycle triggered (interval check running).");
}, 10 * 60 * 1000); // كل 10 دقايق يظهر سطر في الكونسول إن النظام بيشتغل كويس

async function updateGoldSilver() {
  if (weekend()) return;
  await rotateUpdate("metals", "gold");
  await rotateUpdate("metals", "silver");
}

async function updateCrypto() {
  for (const sym of Object.keys(SITES.crypto || {})) {
    await rotateUpdate("crypto", sym, { symbol: sym });
  }
}

async function updateOilGas() {
  for (const sym of Object.keys(SITES.oilgas || {})) {
    await rotateUpdate("oilgas", sym);
  }
}

async function updateFX() {
  for (const sym of Object.keys(SITES.fx || {})) {
    await rotateUpdate("fx", sym);
  }
}

setInterval(updateGoldSilver, 3.5 * 60 * 1000);
setInterval(updateCrypto, 5 * 60 * 1000);
setInterval(updateOilGas, 2 * 60 * 60 * 1000);
setInterval(updateFX, 2 * 60 * 60 * 1000);

// ========== ROUTES ==========
app.get("/", (req, res) => res.json({ ok: true }));

app.get("/api/logs", (req, res) => res.json({ lines: logs.slice(-200) }));

app.get("/api/status", (req, res) => {
  res.json({
    metals: cache.metals,
    crypto: cache.crypto,
    oilgas: cache.oilgas,
    fx: cache.fx,
  });
});

app.post("/api/admin/set", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  const { category, key, usd } = req.body;
  if (!category || !key) return res.status(400).json({ error: "Missing fields" });
  setCache(category.toLowerCase(), key.toUpperCase(), usd, "Manual");
  log(`🟠 Admin set ${category}:${key} => ${usd}`);
  res.json({ ok: true });
});

// ===== Start =====
app.listen(PORT, () => {
  console.log(`🚀 GoldenPrice backend ready and running on PORT: ${PORT}`);
  log(`Server started successfully on port ${PORT}`);
});
