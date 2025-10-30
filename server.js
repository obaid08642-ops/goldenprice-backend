import express from "express";
import fetch from "node-fetch";
import cheerio from "cheerio";

/* =========================
   ENV & CONFIG
   ========================= */
const PORT = process.env.PORT || 3000;

// مفاتيح الـ APIs
const TWELVEDATA_KEY  = process.env.TWELVEDATA_KEY  || "";
const METALPRICE_KEY  = process.env.METALPRICE_KEY  || ""; // metalpriceapi.com
const ALPHAVANTAGE_KEY= process.env.ALPHAVANTAGE_KEY|| "";
// ExchangeRateHost (الخدمة المجانية لا تحتاج مفتاح، لكن بعض النسخ التجارية تحتاج KEY)
const EXR_HOST        = process.env.EXR_HOST || "https://api.exchangerate.host"; // دعها كما هي

// إعداد Scrape لمصدر TheStreetGold (أو أي صفحة موثوقة)
const SCRAPE_URL      = process.env.SCRAPE_URL || ""; // مثال: "https://www.goldprice.org/"
const SCRAPE_SEL_GOLD = process.env.SCRAPE_SEL_GOLD || ""; // مثال CSS: ".gold-price .value"
const SCRAPE_SEL_SILV = process.env.SCRAPE_SEL_SILV || ""; // مثال CSS: ".silver-price .value"

// إيقاف الطلبات أيام السبت والأحد لسوق المعادن (اختياري)
const PAUSE_WEEKEND   = (process.env.METALS_MARKET_PAUSE || "1") === "1";

// فترات التناوب
const ROTATE_MS = 210000; // 3.5 دقيقة بين كل مصدر

// قيمة TTL للكاش (كم ملي ثانية تظل النتيجة صالحة للقراءة)
const TTL_MS = 120000; // دقيقتان

/* =========================
   STATE (Cache + Rotation)
   ========================= */
const cache = new Map(); // key -> { t, ttl, data }
const setCache = (key, data, ttl=TTL_MS) => cache.set(key,{ t:Date.now(), ttl, data });
const getCache = (key) => {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.t < v.ttl) return v.data;
  return null;
};

// لوجات خفيفة
const log = (...args)=> console.log("[METALS]", ...args);

// ترتيب المصادر: 1) TwelveData 2) MetalPrice 3) AlphaVantage 4) ExchangeRateHost 5) TheStreetGold
const SOURCES = ["twelve", "metalprice", "alpha", "exhost", "scrape"];
let rotateIndex = 0;

// حماية بسيطة من معدل الطلب الزائد لو فشل مصدر ما
const backoffUntil = new Map(); // name -> timestamp(ms)
const sourceOK = name => (backoffUntil.get(name) || 0) < Date.now();
const punish   = (name, ms=180000) => backoffUntil.set(name, Date.now()+ms);

/* =========================
   HELPERS
   ========================= */
async function getJSON(url, opts={}, retries=1){
  let lastErr;
  for (let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error("HTTP "+r.status);
      return await r.json();
    }catch(e){
      lastErr=e;
      await new Promise(r=>setTimeout(r, 200+300*i));
    }
  }
  throw lastErr;
}
async function getTEXT(url, opts={}, retries=1){
  let lastErr;
  for (let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error("HTTP "+r.status);
      return await r.text();
    }catch(e){
      lastErr=e;
      await new Promise(r=>setTimeout(r, 200+300*i));
    }
  }
  throw lastErr;
}
function weekendPaused(){
  if (!PAUSE_WEEKEND) return false;
  const d = new Date().getUTCDay(); // 0=Sun,6=Sat (نستخدم UTC لتوحيد المرجع)
  return d===0 || d===6;
}

/* =========================
   SOURCE IMPLEMENTATIONS
   كلها ترجع { gold, silver } بالدولار
   ========================= */

// 1) TwelveData: https://api.twelvedata.com/price?symbol=XAU/USD&apikey=KEY
async function fromTwelve(){
  if (!TWELVEDATA_KEY || !sourceOK("twelve")) throw new Error("TD disabled/backoff");
  const gold = await getJSON(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${TWELVEDATA_KEY}`);
  const silver = await getJSON(`https://api.twelvedata.com/price?symbol=XAG/USD&apikey=${TWELVEDATA_KEY}`);
  const g = Number(gold?.price);
  const s = Number(silver?.price);
  if (!g || !s) { punish("twelve"); throw new Error("TD missing price"); }
  return { gold:g, silver:s, src:"TwelveData" };
}

// 2) MetalPriceAPI: https://api.metalpriceapi.com/v1/latest?api_key=KEY&base=USD&currencies=XAU,XAG
async function fromMetalPrice(){
  if (!METALPRICE_KEY || !sourceOK("metalprice")) throw new Error("MP disabled/backoff");
  const j = await getJSON(`https://api.metalpriceapi.com/v1/latest?api_key=${METALPRICE_KEY}&base=USD&currencies=XAU,XAG`);
  const g = j?.rates?.XAU; // كم أوقية ذهب لكل 1 USD؟ أو العكس حسب الوثائق
  const s = j?.rates?.XAG;
  // بعض APIs ترجّع كم USD لكل XAU. لو لاحظت انعكاس، بدّل 1/g.
  // نفترض هنا أنها ترجع USD لكل 1 XAU/XAG (الأكثر شيوعًا).
  const gold = Number(g);
  const silver = Number(s);
  if (!gold || !silver) { punish("metalprice"); throw new Error("MP missing price"); }
  return { gold, silver, src:"MetalPriceAPI" };
}

// 3) AlphaVantage: نحاول كـ "عملة" XAU->USD (لو مدعوم)
async function fromAlpha(){
  if (!ALPHAVANTAGE_KEY || !sourceOK("alpha")) throw new Error("AV disabled/backoff");
  const gJ = await getJSON(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=XAU&to_currency=USD&apikey=${ALPHAVANTAGE_KEY}`);
  const sJ = await getJSON(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=XAG&to_currency=USD&apikey=${ALPHAVANTAGE_KEY}`);
  const g = Number(gJ?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
  const s = Number(sJ?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
  if (!g || !s) { punish("alpha", 3600000); throw new Error("AV missing price"); }
  return { gold:g, silver:s, src:"AlphaVantage" };
}

// 4) ExchangeRateHost: latest مع symbols XAU,XAG
async function fromExHost(){
  if (!sourceOK("exhost")) throw new Error("EXHOST backoff");
  const j = await getJSON(`${EXR_HOST}/latest?base=USD&symbols=XAU,XAG`);
  const g = Number(j?.rates?.XAU);
  const s = Number(j?.rates?.XAG);
  if (!g || !s) { punish("exhost"); throw new Error("EXHOST missing price"); }
  return { gold:g, silver:s, src:"ExchangeRateHost" };
}

// 5) TheStreetGold (Scrape) — تعتمد على ENV لعناصر الصفحة
async function fromScrape(){
  if (!SCRAPE_URL || !SCRAPE_SEL_GOLD || !SCRAPE_SEL_SILV || !sourceOK("scrape"))
    throw new Error("SCRAPE not configured/backoff");
  const html = await getTEXT(SCRAPE_URL, {}, 1);
  const $ = cheerio.load(html);

  const gTxt = ($(SCRAPE_SEL_GOLD).first().text() || "").replace(/[^\d.]/g,"");
  const sTxt = ($(SCRAPE_SEL_SILV).first().text() || "").replace(/[^\d.]/g,"");
  const gold = Number(gTxt);
  const silver = Number(sTxt);
  if (!gold || !silver) { punish("scrape"); throw new Error("SCRAPE missing price"); }
  return { gold, silver, src:"TheStreetGold(Scrape)" };
}

/* =========================
   ROTATION ENGINE
   ========================= */
async function rotateOnce(){
  try{
    if (weekendPaused()){
      log("Weekend pause active — skipping pull");
      return;
    }

    const name = SOURCES[rotateIndex % SOURCES.length];
    rotateIndex++;

    let res;
    if (name==="twelve")      res = await fromTwelve();
    else if (name==="metalprice") res = await fromMetalPrice();
    else if (name==="alpha")  res = await fromAlpha();
    else if (name==="exhost") res = await fromExHost();
    else if (name==="scrape") res = await fromScrape();
    else throw new Error("unknown source");

    // خزّن في الكاش
    if (res?.gold && res?.silver){
      setCache("metal:gold",   { price:res.gold,   unit:"oz", currency:"USD", source:res.src });
      setCache("metal:silver", { price:res.silver, unit:"oz", currency:"USD", source:res.src });
      log(`Rotated from ${res.src} — gold=${res.gold} silver=${res.silver}`);
    }
  }catch(e){
    log("rotate error:", e?.message || e);
  }
}

// ابدأ التناوب
setTimeout(rotateOnce, 2000);           // أول تشغيل بعد ثانيتين
setInterval(rotateOnce, ROTATE_MS);     // كل 3.5 دقيقة مصدر جديد

/* =========================
   ADMIN OVERRIDES
   ========================= */
// POST /api/admin/price  { kind:"gold"|"silver", price: 2431.5, ttlSec?: 3600, token: ADMIN_TOKEN }
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
function requireAdmin(req,res,next){
  if (!ADMIN_TOKEN) return res.status(403).json({error:"ADMIN_TOKEN not set"});
  const t = (req.body?.token || req.query?.token || "");
  if (t !== ADMIN_TOKEN) return res.status(401).json({error:"unauthorized"});
  next();
}

/* =========================
   EXPRESS APP
   ========================= */
const app = express();
app.use(express.json());

// صحّة السيرفر
app.get("/api/health", (req,res)=> res.json({ ok:true, ts:Date.now(), rotatingEverySec:ROTATE_MS/1000 }));

// إرجاع الذهب/الفضة من الكاش مباشرة
app.get("/api/gold", (req,res)=>{
  const v = getCache("metal:gold");
  if (!v) return res.status(503).json({ error:"no_price_cached_yet" });
  res.json(v);
});
app.get("/api/silver", (req,res)=>{
  const v = getCache("metal:silver");
  if (!v) return res.status(503).json({ error:"no_price_cached_yet" });
  res.json(v);
});

// إندبوينت موحّد
app.get("/api/metals", (req,res)=>{
  const list = (req.query.list || "gold,silver").split(",").map(s=>s.trim().toLowerCase());
  const out = {};
  for (const m of list){
    const v = getCache(`metal:${m}`);
    if (v) out[m]=v;
  }
  if (!Object.keys(out).length) return res.status(503).json({ error:"no_prices_cached_yet" });
  res.json(out);
});

// Admin — وضع سعر يدوي
app.post("/api/admin/price", requireAdmin, (req,res)=>{
  try{
    const kind = (req.body?.kind || "").toLowerCase();
    const price = Number(req.body?.price);
    const ttlSec = Number(req.body?.ttlSec || 3600);
    if (!["gold","silver"].includes(kind)) return res.status(400).json({error:"kind must be gold|silver"});
    if (!price) return res.status(400).json({error:"price missing"});
    setCache(`metal:${kind}`, { price, unit:"oz", currency:"USD", source:"ADMIN" }, ttlSec*1000);
    res.json({ ok:true, kind, price, ttlSec });
  }catch(e){
    res.status(500).json({error:String(e?.message||e)});
  }
});

// Admin — عرض الكاش
app.get("/api/admin/cache", requireAdmin, (req,res)=>{
  const out = {};
  for (const [k,v] of cache.entries()){
    out[k] = { ageSec: Math.round((Date.now()-v.t)/1000), ttlSec: Math.round(v.ttl/1000), data:v.data };
  }
  res.json(out);
});

// Admin — حذف مفتاح من الكاش
app.delete("/api/admin/cache", requireAdmin, (req,res)=>{
  const key = req.query.key;
  if (!key) return res.status(400).json({error:"key required"});
  cache.delete(key);
  res.json({ok:true, deleted:key});
});

app.listen(PORT, ()=> console.log("Server listening at port", PORT));
