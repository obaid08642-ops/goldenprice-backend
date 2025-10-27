import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// كاش محلي
let cache = {
  metals: null,
  crypto: null,
  fx: null,
  updated: null
};

// دالة عامة للسحب مع fallback
async function fetchWithFallback(primaryUrls, backupUrls, parser) {
  const tryUrls = async (urls) => {
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
          }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        console.log(`✅ مصدر ناجح: ${url}`);
        return parser(text);
      } catch (e) {
        console.log(`❌ فشل المصدر: ${url} — ${e.message}`);
      }
    }
    return null;
  };

  // نحاول من المجموعة الأساسية
  let data = await tryUrls(primaryUrls);
  if (data) return data;

  // نحاول من الاحتياطية
  console.log("⚠️ فشل كل المصادر الأساسية، الانتقال للاحتياطية...");
  data = await tryUrls(backupUrls);
  if (data) return data;

  console.log("🚨 فشل جميع المصادر، استخدام الكاش القديم");
  return null;
}

// 🔸 أسعار الذهب والفضة
async function fetchMetals() {
  const primary = [
    "https://finance.yahoo.com/quote/GC=F",
    "https://www.kitco.com/gold-price-today-usa.html",
    "https://www.goldprice.org/",
    "https://www.investing.com/commodities/gold"
  ];
  const backup = [
    "https://www.marketwatch.com/investing/future/gold",
    "https://www.fxempire.com/markets/gold/overview",
    "https://www.nasdaq.com/market-activity/commodities/gc:cmx",
    "https://www.livepriceofgold.com/",
    "https://www.goldbroker.com/charts/gold-price",
    "https://www.silverprice.org/"
  ];

  return await fetchWithFallback(primary, backup, (html) => {
    // هنا تقدر تحط parsing logic حسب شكل الداتا
    return { gold: "loading", silver: "loading" };
  });
}

// 🔸 العملات الرقمية (Crypto)
async function fetchCrypto() {
  const primary = [
    "https://api.binance.com/api/v3/ticker/price",
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd"
  ];
  const backup = [
    "https://min-api.cryptocompare.com/data/pricemulti?fsyms=BTC,ETH&tsyms=USD",
    "https://api.coinpaprika.com/v1/tickers"
  ];

  return await fetchWithFallback(primary, backup, (jsonText) => JSON.parse(jsonText));
}

// 🔸 أسعار العملات العالمية (Forex)
async function fetchFX() {
  const primary = ["https://api.exchangerate.host/latest?base=USD"];
  const backup = ["https://open.er-api.com/v6/latest/USD"];

  return await fetchWithFallback(primary, backup, (jsonText) => JSON.parse(jsonText));
}

// نقاط النهاية API
app.get("/api/health", (req, res) => res.json({ ok: true, ws: true }));
app.get("/api/metals", async (req, res) => {
  const data = await fetchMetals();
  cache.metals = data || cache.metals;
  cache.updated = new Date();
  res.json(cache.metals || { error: "No data" });
});
app.get("/api/crypto", async (req, res) => {
  const data = await fetchCrypto();
  cache.crypto = data || cache.crypto;
  cache.updated = new Date();
  res.json(cache.crypto || { error: "No data" });
});
app.get("/api/fx", async (req, res) => {
  const data = await fetchFX();
  cache.fx = data || cache.fx;
  cache.updated = new Date();
  res.json(cache.fx || { error: "No data" });
});

app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
