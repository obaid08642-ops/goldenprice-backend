// server.js – GoldenPrice (ملف واحد)
// Node >=18 (fetch داخلي)
// لا يحتاج Cheerio (تجنُّب مشاكل ESM); سكراب بسيط لـ TheStreetGold عبر regex آمن.

const express = require('express');
const app = express();

// ====== إعدادات عامة ======
const PORT = process.env.PORT || 10000;

// مفاتيح الـ API من الإنفايرونمنت
const TWELVE_KEY = process.env.TWELVEDATA_KEY || '';        //  TwelveData
const ALPHA_KEY   = process.env.ALPHA_VANTAGE_KEY || '';    //  AlphaVantage

// فواصل زمنية (دقائق) – يمكنك تغييرها من الإنفايرونمنت عند الحاجة
const INTERVAL_GOLD_MIN   = Number(process.env.INTERVAL_GOLD_MIN)   || 5;   // تناوب كل 5 دقايق
const INTERVAL_SILVER_MIN = Number(process.env.INTERVAL_SILVER_MIN) || 5;
const INTERVAL_CRYPTO_MIN = Number(process.env.INTERVAL_CRYPTO_MIN) || 2;
const INTERVAL_FX_MIN     = Number(process.env.INTERVAL_FX_MIN)     || 10;
// Alpha Vantage: نوفر الطلبات — كل 6 ساعات (يمكن تزودها لـ 10 ساعات)
const INTERVAL_ALPHA_HRS  = Number(process.env.INTERVAL_ALPHA_HRS)  || 6;

// ========== أدوات مساعدة ==========
const nowTs = () => Date.now();
const isWeekend = () => {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun,6=Sat
  return day === 0 || day === 6;
};

// تحويل نص يحتوي رقماً لسعر (regex يتحمل الفواصل وعلامة الدولار)
function pickNumberLikePrice(text) {
  if (!text) return null;
  // أمثلة: 2,345.67 أو 2345.67 أو $2,345.67
  const m = text.replace(/\s+/g,' ').match(/(?:\$?\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/);
  if (!m) return null;
  const raw = m[1].replace(/,/g,'');
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

// ========== الكاش ==========
const CACHE = {
  gold:    { usd: null, source: null, t: null },
  silver:  { usd: null, source: null, t: null },
  crypto:  { /* BTC:{usd,source,t}, ETH:{...} */ },
  fx:      { /* base->symbols map later */ },
  metals:  { value: {}, lastUpdated: null },  // Alpha Vantage: WTI/Brent/NATGAS/COPPER/ALUMINUM
  oilgas:  { value: {}, lastUpdated: null },  // alias على نفس البيانات
  last:    {}
};

// ========== مصادر الدهب/الفضة بالتناوب ==========
let goldIndex = 0;
let silverIndex = 0;

// gold sources rotation
const GOLD_SOURCES = [
  'twelvedata',   // يتطلب key – قد يرفض XAU على بعض الخطط، بنجرب أولاً
  'thestreet',    // سكراب خفيف (بدون Cheerio)
  'yahoo'         // GC=F (فيوتشر) – تقدير قريب للسعر الفوري
];

// silver sources rotation
const SILVER_SOURCES = [
  'twelvedata',
  'thestreet',   // نحاول صفحة الفضة
  'yahoo'        // SI=F (فيوتشر)
];

// ========== طلبات HTTP ==========
async function httpGetJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'goldenprice/1.0' }});
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
async function httpGetText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'goldenprice/1.0' }});
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ========== الدهب ==========
async function fetchGold_Twelve() {
  if (!TWELVE_KEY) throw new Error('TWELVE_KEY missing');
  // TwelveData قد يرفض الرمز XAU/USD على الخطة المجانية لبعض الحسابات
  const url = `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${TWELVE_KEY}`;
  const j = await httpGetJson(url);
  if (j && j.price) {
    const v = Number(j.price);
    if (Number.isFinite(v)) return { usd: v, source: 'twelvedata' };
  }
  // أحياناً يرجّع {code:404,...} — نرمي خطأ لنجرب المصدر التالي
  throw new Error(j && j.message ? j.message : 'No price');
}

async function fetchGold_TheStreet() {
  // صفحة عامة فيها السعر – قد تتغير، لذا نخليها غير قاتلة
  const url = 'https://www.thestreet.com/markets/commodities/gold-price';
  const html = await httpGetText(url);
  // ابحث عن block فيه "Gold Price" ثم رقم بالدولار
  const m = html.match(/Gold Price[^$]*\$\s*([\d,]+(?:\.\d+)?)/i) ||
            html.match(/gold[^<>{}]*price[^$]*\$\s*([\d,]+(?:\.\d+)?)/i);
  const v = m ? Number(m[1].replace(/,/g,'')) : pickNumberLikePrice(html);
  if (!v) throw new Error('No gold price on TheStreet');
  return { usd: v, source: 'thestreet' };
}

async function fetchGold_Yahoo() {
  // GC=F – Gold Futures (قد يختلف قليلاً عن السبوت لكنه بديل جيد)
  const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=GC=F';
  const j = await httpGetJson(url);
  const q = j?.quoteResponse?.result?.[0];
  const v = q?.regularMarketPrice || q?.postMarketPrice || q?.ask || q?.bid;
  if (!Number.isFinite(v)) throw new Error('No GC=F price');
  return { usd: Number(v), source: 'yahoo' };
}

async function rotateGold() {
  if (isWeekend()) return; // لا نحدث في الويك إند (السعر سيبقى من الكاش)
  const order = GOLD_SOURCES;
  for (let i = 0; i < order.length; i++) {
    const src = order[(goldIndex + i) % order.length];
    try {
      let data;
      if (src === 'twelvedata') data = await fetchGold_Twelve();
      else if (src === 'thestreet') data = await fetchGold_TheStreet();
      else data = await fetchGold_Yahoo();

      CACHE.gold = { ...data, t: nowTs() };
      goldIndex = (goldIndex + i + 1) % order.length; // ابدأ من التالي في الدورة القادمة
      return;
    } catch (e) {
      // جرّب اللي بعده
    }
  }
  // لو فشلوا كلهم، لا نغيّر الكاش
}

// ========== الفضة ==========
async function fetchSilver_Twelve() {
  if (!TWELVE_KEY) throw new Error('TWELVE_KEY missing');
  const url = `https://api.twelvedata.com/price?symbol=XAG/USD&apikey=${TWELVE_KEY}`;
  const j = await httpGetJson(url);
  if (j && j.price) {
    const v = Number(j.price);
    if (Number.isFinite(v)) return { usd: v, source: 'twelvedata' };
  }
  throw new Error(j && j.message ? j.message : 'No price');
}
async function fetchSilver_TheStreet() {
  const url = 'https://www.thestreet.com/markets/commodities/silver-price';
  const html = await httpGetText(url);
  const m = html.match(/Silver Price[^$]*\$\s*([\d,]+(?:\.\d+)?)/i) ||
            html.match(/silver[^<>{}]*price[^$]*\$\s*([\d,]+(?:\.\d+)?)/i);
  const v = m ? Number(m[1].replace(/,/g,'')) : pickNumberLikePrice(html);
  if (!v) throw new Error('No silver price on TheStreet');
  return { usd: v, source: 'thestreet' };
}
async function fetchSilver_Yahoo() {
  // SI=F – Silver Futures
  const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=SI=F';
  const j = await httpGetJson(url);
  const q = j?.quoteResponse?.result?.[0];
  const v = q?.regularMarketPrice || q?.postMarketPrice || q?.ask || q?.bid;
  if (!Number.isFinite(v)) throw new Error('No SI=F price');
  return { usd: Number(v), source: 'yahoo' };
}
async function rotateSilver() {
  if (isWeekend()) return;
  const order = SILVER_SOURCES;
  for (let i = 0; i < order.length; i++) {
    const src = order[(silverIndex + i) % order.length];
    try {
      let data;
      if (src === 'twelvedata') data = await fetchSilver_Twelve();
      else if (src === 'thestreet') data = await fetchSilver_TheStreet();
      else data = await fetchSilver_Yahoo();

      CACHE.silver = { ...data, t: nowTs() };
      silverIndex = (silverIndex + i + 1) % order.length;
      return;
    } catch (e) {
      // جرّب اللي بعده
    }
  }
}

// ========== كريبتو (CoinGecko) ==========
async function fetchCrypto(symbol = 'bitcoin') {
  // CoinGecko مجاني ومباشر
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(symbol)}&vs_currencies=usd`;
  const j = await httpGetJson(url);
  const v = j?.[symbol]?.usd;
  if (!Number.isFinite(v)) throw new Error(`No price for ${symbol}`);
  CACHE.crypto[symbol.toUpperCase()] = { usd: Number(v), source: 'coingecko', t: nowTs() };
  return CACHE.crypto[symbol.toUpperCase()];
}

// ========== فوركس (
