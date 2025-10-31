// ===== GoldenPrice Backend (Final Edition) =====
// Version: 2025-10-31
// Features: Dual Source Rotation | Manual Update | Independent Cache | Admin Integration

import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// ======== ENV CONFIG ========
const ADMIN_TOKEN = "ADMIN_12345";
const PORT = process.env.PORT || 10000;

// ======== CACHES ========
let cache = {
  gold: null,
  silver: null,
  crypto: { BTC: null, ETH: null, SLX: null },
  metals: {},
  energy: {},
  forex: {},
};

// ======== SOURCE ROTATION ========
let rotationToggle = {
  gold: 0,
  silver: 0,
  crypto: 0,
  metals: 0,
  energy: 0,
  forex: 0,
};

// ======== HELPERS ========
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const now = () => new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh" });

// ======== SCRAPING UTILS ========
const fetchScrape = async (url, regex) => {
  try {
    const { data } = await axios.get(url);
    const match = data.match(regex);
    if (match && match[1]) return parseFloat(match[1]);
  } catch {
    return null;
  }
  return null;
};

// ======== FETCHERS ========
const sources = {
  gold: [
    async () => {
      const res = await axios.get("https://query1.finance.yahoo.com/v7/finance/quote?symbols=GC=F");
      return res.data.quoteResponse.result[0].regularMarketPrice;
    },
    async () => await fetchScrape("https://www.investing.com/commodities/gold", />Gold\sPrice:\s*\$?([\d.,]+)/i),
  ],

  silver: [
    async () => {
      const res = await axios.get("https://query1.finance.yahoo.com/v7/finance/quote?symbols=SI=F");
      return res.data.quoteResponse.result[0].regularMarketPrice;
    },
    async () => await fetchScrape("https://www.investing.com/commodities/silver", />Silver\sPrice:\s*\$?([\d.,]+)/i),
  ],

  crypto: {
    BTC: [
      async () => {
        const res = await axios.get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
        return res.data.bitcoin.usd;
      },
      async () => {
        const res = await axios.get("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        return parseFloat(res.data.price);
      },
    ],
    ETH: [
      async () => {
        const res = await axios.get("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
        return res.data.ethereum.usd;
      },
      async () => {
        const res = await axios.get("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT");
        return parseFloat(res.data.price);
      },
    ],
    SLX: [
      async () => await fetchScrape("https://pancakeswap.finance/info/pairs/0x0", /price[^0-9]*([\d.]+)/i),
      async () => await fetchScrape("https://www.geckoterminal.com/bsc/pools/0x0", /price[^0-9]*([\d.]+)/i),
    ],
  },

  metals: {
    copper: [
      async () => {
        const res = await axios.get("https://query1.finance.yahoo.com/v7/finance/quote?symbols=HG=F");
        return res.data.quoteResponse.result[0].regularMarketPrice;
      },
      async () => await fetchScrape("https://www.investing.com/commodities/copper", />Copper\sPrice:\s*\$?([\d.,]+)/i),
    ],
    platinum: [
      async () => {
        const res = await axios.get("https://query1.finance.yahoo.com/v7/finance/quote?symbols=PL=F");
        return res.data.quoteResponse.result[0].regularMarketPrice;
      },
      async () => await fetchScrape("https://www.marketwatch.com/investing/future/platinum", /Last[^0-9]*([\d.]+)/i),
    ],
  },

  energy: {
    WTI: [
      async () => {
        const res = await axios.get("https://query1.finance.yahoo.com/v7/finance/quote?symbols=CL=F");
        return res.data.quoteResponse.result[0].regularMarketPrice;
      },
      async () => await fetchScrape("https://www.investing.com/commodities/crude-oil", />Crude\sOil\sPrice:\s*\$?([\d.,]+)/i),
    ],
    GAS: [
      async () => {
        const res = await axios.get("https://query1.finance.yahoo.com/v7/finance/quote?symbols=NG=F");
        return res.data.quoteResponse.result[0].regularMarketPrice;
      },
      async () => await fetchScrape("https://www.marketwatch.com/investing/future/natural-gas", /Last[^0-9]*([\d.]+)/i),
    ],
  },

  forex: [
    async () => {
      const res = await axios.get("https://api.exchangerate.host/convert?from=USD&to=EGP");
      return res.data.result;
    },
    async () => {
      const res = await axios.get("https://query1.finance.yahoo.com/v7/finance/quote?symbols=USDEGP=X");
      return res.data.quoteResponse.result[0].regularMarketPrice;
    },
  ],
};

// ======== FETCH HANDLER ========
const rotateAndFetch = async (key, subkey = null) => {
  try {
    const idx = rotationToggle[key] % 2;
    rotationToggle[key]++;
    let val;

    if (subkey && sources[key][subkey]) val = await sources[key][subkey][idx]();
    else val = await sources[key][idx]();

    if (!val) throw new Error("No price");
    const result = parseFloat(val);

    if (subkey) cache[key][subkey] = { price: result, source: idx ? "Alt" : "Main", updated: now() };
    else cache[key] = { price: result, source: idx ? "Alt" : "Main", updated: now() };

    log(`SET ${key.toUpperCase()}${subkey ? ":" + subkey : ""} = ${result} USD via ${idx ? "Alt" : "Main"}`);
  } catch (err) {
    log(`ERR ${key.toUpperCase()}${subkey ? ":" + subkey : ""} => ${err.message}`);
  }
};

// ======== AUTO UPDATES ========
const updateLoop = () => {
  rotateAndFetch("gold");
  rotateAndFetch("silver");
  for (let k in sources.crypto) rotateAndFetch("crypto", k);
  for (let k in sources.metals) rotateAndFetch("metals", k);
  for (let k in sources.energy) rotateAndFetch("energy", k);
  rotateAndFetch("forex");
};
setInterval(updateLoop, 3 * 60 * 1000); // default small loop
updateLoop();

// ======== ROUTES ========

// APIs
app.get("/api/:category/:symbol?", (req, res) => {
  const { category, symbol } = req.params;
  try {
    if (symbol && cache[category]?.[symbol]) return res.json(cache[category][symbol]);
    if (cache[category]) return res.json(cache[category]);
    res.status(404).json({ error: "Not found" });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// Manual set
app.post("/api/manual", (req, res) => {
  const { token, category, symbol, price } = req.body;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: "Unauthorized" });
  if (!category || !price) return res.status(400).json({ error: "Missing params" });

  if (symbol && cache[category]?.[symbol])
    cache[category][symbol] = { price: parseFloat(price), source: "Manual", updated: now() };
  else cache[category] = { price: parseFloat(price), source: "Manual", updated: now() };

  log(`MANUAL SET ${category.toUpperCase()}${symbol ? ":" + symbol : ""} = ${price} USD`);
  res.json({ success: true, category, symbol, price });
});

// Restart cache
app.post("/api/restart", (req, res) => {
  const { token, category, symbol } = req.body;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: "Unauthorized" });
  if (symbol && cache[category]?.[symbol]) cache[category][symbol] = null;
  else cache[category] = null;
  res.json({ success: true, message: `Cache for ${category}${symbol ? ":" + symbol : ""} cleared.` });
});

// ======== START ========
app.listen(PORT, () => log(`Server running on :${PORT}`));
