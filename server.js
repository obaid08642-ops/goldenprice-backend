// server.js  — GoldenPriceBackend FINAL (round-robin + admin + cache)
// Node 18+  — "type": "module" في package.json
import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import cors from "cors";

// =============== ENV ===============
const PORT = process.env.PORT || 10000;

// مفاتيح اختيارية حسب المتاح
const TWELVEDATA_KEY   = process.env.TWELVEDATA_KEY   || ""; // TwelveData
const ALPHAVANTAGE_KEY = process.env.ALPHAVANTAGE_KEY || ""; // Alpha Vantage
const ADMIN_TOKEN      = process.env.ADMIN_TOKEN      || "ADMIN_12345"; // لتأمين لوحة التحكم

// =============== HELPERS ===============
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));
const now = ()=> Date.now();
const fmtTs = (t)=> new Date(t).toISOString().replace('T',' ').slice(0,19);

// ذاكرة/كاش داخلية
// cache[symbol] = { price, unit, source, ts, manual: boolean }
const cache = Object.create(null);

// سجل عمليات مختصر
const logs = [];
function log(line){
  const msg = `[${fmtTs(now())}] ${line}`;
  logs.unshift(msg);
  if (logs.length>400) logs.pop();
  console.log(msg);
}

// أداة طلب JSON مع إعادة محاولة بسيطة
async function getJSON(url, opts={}, retries=1){
  let lastErr;
  for (let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    }catch(e){
      lastErr = e;
      if(i===retries) throw e;
      await sleep(400);
    }
  }
  throw lastErr;
}

// أداة طلب نص (للـ HTML)
async function getTEXT(url, opts={}, retries=1){
  let lastErr;
  for (let i=0;i<=retries;i++){
    try{
      const r = await fetch(url, opts);
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    }catch(e){
      lastErr = e;
      if(i===retries) throw e;
      await sleep(400);
    }
  }
  throw lastErr;
}

// =============== تعاريف الأصول ===============
// الوحدة: كلها USD
// metalsIndustrial 17 item (الـ 17 الشائعة)
const metalsIndustrial = {
  COPPER:   { y: "HG=F",   label: "Copper"    },
  ALUMINUM: { y: "ALI=F",  label: "Aluminum"  },
  NICKEL:   { y: "NI=F",   label: "Nickel"    },
  ZINC:     { y: "MZN=F",  label: "Zinc"      },
  LEAD:     { y: "LE=F",   label: "Lead"      },
  TIN:      { y: "TIN=F",  label: "Tin"       },
  PLATINUM: { y: "PL=F",   label: "Platinum"  },
  PALLADIUM:{ y: "PA=F",   label: "Palladium" },
  IRON:     { y: "FEX=F",  label: "Iron (index/approx)" },
  STEEL:    { y: null,     label: "Steel (proxy)" },
  COBALT:   { y: null,     label: "Cobalt (proxy)" },
  LITHIUM:  { y: null,     label: "Lithium (proxy)" },
  URANIUM:  { y: null,     label: "Uranium (proxy)" },
  // إضافات شائعة
  SILVER:   { y: "SI=F", label: "Silver" }, // لأغراض الترتيب فقط، الفضة عندنا ضمن المجموعة السريعة أيضاً
  GOLD:     { y: "GC=F", label: "Gold"   }  // كذلك
};

// النفط والغاز
const energy = {
  WTI:  { y: "CL=F",  avFn: "WTI",         label: "WTI Crude" },
  BRENT:{ y: "BZ=F",  avFn: "BRENT",       label: "Brent Crude" },
  GAS:  { y: "NG=F",  avFn: "NATURAL_GAS", label: "Natural Gas" },
};

// الفوركس — نجرب زوج/أزواج حسب الطلب عند الاستعلام
// سنحفظ آخر زوج طُلب ونحدّثه آلياً.
let lastFXPairs = new Set(); // مثل: "USD/EGP"

// المجموعة السريعة (ذهب/فضّة)
const fastMetals = {
  GOLD:   { td: "XAU/USD", y: "GC=F",  html: "https://www.thestreet.com/quote/xauusd" },
  SILVER: { td: "XAG/USD", y: "SI=F",  html: "https://www.thestreet.com/quote/xagusd" }
};

// الكريبتو
const cryptoMap = {
  BTC: { gecko: "bitcoin",   coincap: "bitcoin"  },
  ETH: { gecko: "ethereum",  coincap: "ethereum" },
  SLX: { gecko: null,        coincap: null, dexAddr: "0x34317C020E78D30feBD2Eb9f5fa8721aA575044d" } // SilverX (BSC)
};

// =============== مصادر (دوال) ===============

// ----- TwelveData: سعر بسيط للرمز/الزوج -----
async function srcTwelveData(symbol){
  if(!TWELVEDATA_KEY) throw new Error("TD key missing");
  const j = await getJSON(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVEDATA_KEY}`);
  const v = Number(j?.price);
  if(!v) throw new Error("TD no price");
  return v;
}

// ----- Yahoo Finance chart/meta بسيط -----
async function srcYahooQuote(ticker){
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?region=US&lang=en-US`);
  const v = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  const n = Number(v);
  if(!n) throw new Error("Yahoo no price");
  return n;
}

// ----- TheStreet (صفحات مبسطة) — سنحاول التقاط رقم أولي (بدون سيلكتور معقّد) -----
async function srcTheStreetNumber(url){
  const html = await getTEXT(url);
  // محاولة استخراج أول رقم كبير مع كسور
  const m = html.replace(/,/g,'').match(/(\d{3,5}\.\d{1,2})/);
  if(!m) throw new Error("TheStreet no number");
  return Number(m[1]);
}

// ----- CoinGecko -----
async function srcCoinGecko(id){
  const j = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
  const v = Number(j?.[id]?.usd);
  if(!v) throw new Error("Gecko no price");
  return v;
}

// ----- CoinCap -----
async function srcCoinCap(id){
  const j = await getJSON(`https://api.coincap.io/v2/assets/${id}`);
  const v = Number(j?.data?.priceUsd);
  if(!v) throw new Error("CoinCap no price");
  return v;
}

// ----- DexScreener (SLX على BSC) -----
async function srcDexScreenerByTokenBSC(addr){
  const j = await getJSON(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
  const pairs = j?.pairs;
  const v = Array.isArray(pairs) && Number(pairs[0]?.priceUsd);
  if(!v) throw new Error("DexScreener no price");
  return v;
}

// ----- AlphaVantage Energy -----
async function srcAlphaEnergy(fn){
  if(!ALPHAVANTAGE_KEY) throw new Error("AV key missing");
  const j = await getJSON(`https://www.alphavantage.co/query?function=${fn}&interval=daily&apikey=${ALPHAVANTAGE_KEY}`);
  // نحاول آخر قيمة
  const arr = j?.data || j?.series || j?.["data"];
  // بعض الردود تكون "data" مصفوفة {date, value}
  let v;
  if (Array.isArray(arr) && arr.length){
    v = Number(arr[0]?.value || arr[0]?.price || arr[0]?.close);
  }
  if(!v){
    // fallback: أحيانًا شكل مختلف
    const any = JSON.stringify(j);
    const m = any.match(/"value"\s*:\s*"(\d+(\.\d+)?)"/);
    if(m) v = Number(m[1]);
  }
  if(!v) throw new Error("AV energy no price");
  return v;
}

// ----- exchangerate.host (فوركس) -----
async function srcFX_ExchangerateHost(from, to){
  const j = await getJSON(`https://api.exchangerate.host/convert?from=${from}&to=${to}`);
  const v = Number(j?.result);
  if(!v) throw new Error("FX host no rate");
  return v;
}

// ----- AlphaVantage فوركس -----
async function srcFX_Alpha(from, to){
  if(!ALPHAVANTAGE_KEY) throw new Error("AV key missing");
  const j = await getJSON(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${ALPHAVANTAGE_KEY}`);
  const v = Number(j?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
  if(!v) throw new Error("AV fx no rate");
  return v;
}

// =============== سياسات التناوب والجدولة ===============

// هل اليوم سبت/أحد — لإيقاف ذهب/فضة (توفير ريكوست)
function isWeekend(){
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun .. 6=Sat
  return day===0 || day===6;
}

// مؤشرات Round-Robin
let rrGold = 0;   // 0: TD, 1: Yahoo, 2: TheStreet
let rrSilver = 0; // نفس
let rrCrypto = 0; // 0: Gecko, 1: CoinCap, 2: Dex(SLX فقط عند الحاجة)
let rrEnergy = 0; // 0: Yahoo, 1: Alpha, 2: MarketWatch(مبسّط ضمن Yahoo هنا)
let rrMetals = 0; // 0: Yahoo, 1: TradingEconomics(بديل نصي بسيط), 2: MarketWatch

// تحديث/تخزين في الكاش
function setPrice(symbol, price, source, unit="USD", manual=false){
  cache[symbol] = { price, unit, source, ts: now(), manual: !!manual };
  log(`SET ${symbol} = ${price} ${unit} via ${source}${manual?" [MANUAL]":""}`);
}

// =============== وظائف تحديث لكل فئة ===============

// ذهب/فضة — كل 210s بالتناوب
async function updateGold(){
  if (isWeekend()) { log("GOLD weekend pause"); return; }
  const symbol="GOLD";
  if (cache[symbol]?.manual) { log("GOLD manual override"); return; }

  const order = [
    async ()=>{ if(!TWELVEDATA_KEY) throw new Error("TD missing"); const v=await srcTwelveData("XAU/USD"); setPrice(symbol,v,"TwelveData"); },
    async ()=>{ const v=await srcYahooQuote(fastMetals.GOLD.y); setPrice(symbol,v,"Yahoo"); },
    async ()=>{ const v=await srcTheStreetNumber(fastMetals.GOLD.html); setPrice(symbol,v,"TheStreet"); },
  ];
  const idx = rrGold % order.length; rrGold++;
  try{ await order[idx](); } catch(e){ log(`ERR GOLD: ${e.message}`); }
}

async function updateSilver(){
  if (isWeekend()) { log("SILVER weekend pause"); return; }
  const symbol="SILVER";
  if (cache[symbol]?.manual) { log("SILVER manual override"); return; }
  const order = [
    async ()=>{ if(!TWELVEDATA_KEY) throw new Error("TD missing"); const v=await srcTwelveData("XAG/USD"); setPrice(symbol,v,"TwelveData"); },
    async ()=>{ const v=await srcYahooQuote(fastMetals.SILVER.y); setPrice(symbol,v,"Yahoo"); },
    async ()=>{ const v=await srcTheStreetNumber(fastMetals.SILVER.html); setPrice(symbol,v,"TheStreet"); },
  ];
  const idx = rrSilver % order.length; rrSilver++;
  try{ await order[idx](); } catch(e){ log(`ERR SILVER: ${e.message}`); }
}

// كريبتو — كل 300s
async function updateCryptoOne(sym){
  const S = sym.toUpperCase();
  if (cache[`CRYPTO:${S}`]?.manual){ log(`CRYPTO ${S} manual override`); return; }

  const meta = cryptoMap[S];
  if(!meta) return;

  const order = [
    async ()=>{ if(!meta.gecko) throw new Error("no gecko id"); const v=await srcCoinGecko(meta.gecko); setPrice(`CRYPTO:${S}`,v,"CoinGecko"); },
    async ()=>{ if(!meta.coincap) throw new Error("no coincap id"); const v=await srcCoinCap(meta.coincap); setPrice(`CRYPTO:${S}`,v,"CoinCap"); },
    async ()=>{ if(S!=="SLX") throw new Error("dex only for SLX"); const v=await srcDexScreenerByTokenBSC(meta.dexAddr); setPrice(`CRYPTO:${S}`,v,"DexScreener"); },
  ];
  let idx = rrCrypto % order.length; rrCrypto++;
  // SLX: نبدأ مباشرة بـ Dexscreener أولاً
  if (S==="SLX") idx = 2;

  try{ await order[idx](); } catch(e){ log(`ERR CRYPTO ${S}: ${e.message}`); }
}

// طاقة — كل ساعتين
async function updateEnergyOne(key){
  const def = energy[key];
  const symbol = `ENERGY:${key}`;
  if (cache[symbol]?.manual){ log(`${symbol} manual override`); return; }
  const order = [
    async ()=>{ const v=await srcYahooQuote(def.y); setPrice(symbol,v,`Yahoo(${def.y})`); },
    async ()=>{ const v=await srcAlphaEnergy(def.avFn); setPrice(symbol,v,`AlphaVantage(${def.avFn})`); },
    async ()=>{ const v=await srcYahooQuote(def.y); setPrice(symbol,v,`Yahoo-2(${def.y})`); },
  ];
  const idx = rrEnergy % order.length; rrEnergy++;
  try{ await order[idx](); } catch(e){ log(`ERR ENERGY ${key}: ${e.message}`); }
}

// معادن صناعية — كل ساعتين
async function updateMetalIndustrialOne(key){
  const def = metalsIndustrial[key];
  const symbol = `METAL:${key}`;
  if (cache[symbol]?.manual){ log(`${symbol} manual override`); return; }

  const order = [
    async ()=>{ if(!def.y) throw new Error("no yahoo ticker"); const v=await srcYahooQuote(def.y); setPrice(symbol,v,`Yahoo(${def.y})`); },
    async ()=>{ // TradingEconomics (تقريب نصي): نحاول التقاط رقم من صفحة البحث
      const html = await getTEXT(`https://api.tradingeconomics.com/commodities`);
      const m = html.match(/"${def.label}".*?"Last":\s*([0-9.]+)/i);
      if(!m) throw new Error("TE no number");
      const v = Number(m[1]); if(!v) throw new Error("TE bad number");
      setPrice(symbol,v,"TradingEconomics");
    },
    async ()=>{ if(!def.y) throw new Error("no yahoo 2"); const v=await srcYahooQuote(def.y); setPrice(symbol,v,`Yahoo-2(${def.y})`); }
  ];
  const idx = rrMetals % order.length; rrMetals++;
  try{ await order[idx](); } catch(e){ log(`ERR METAL ${key}: ${e.message}`); }
}

// فوركس — كل ساعتين (للأزواج التي طُلبت مؤخرًا)
async function updateFXOne(pair){
  const [from,to] = pair.split("/");
  const symbol = `FX:${from}:${to}`;
  if (cache[symbol]?.manual){ log(`${symbol} manual override`); return; }

  const order = [
    async ()=>{ const v = await srcFX_ExchangerateHost(from,to); setPrice(symbol,v,"exchangerate.host"); },
    async ()=>{ const v = await srcFX_Alpha(from,to); setPrice(symbol,v,"AlphaVantage"); },
  ];
  const idx = Math.floor(now()/1) % order.length; // بسيط
  try{ await order[idx](); } catch(e){ log(`ERR FX ${pair}: ${e.message}`); }
}

// =============== جدولة التشغيل ===============

// ذهب/فضة كل 210 ثانية
setInterval(updateGold,  210*1000);
setInterval(updateSilver,210*1000);

// كريبتو (BTC, ETH, SLX) كل 300 ثانية
const cryptoList = ["BTC","ETH","SLX"];
setInterval(()=>cryptoList.forEach(s=>updateCryptoOne(s)), 300*1000);

// طاقة كل ساعتين
setInterval(()=> Object.keys(energy).forEach(k=>updateEnergyOne(k)), 2*3600*1000);

// معادن صناعية كل ساعتين
setInterval(()=> Object.keys(metalsIndustrial).forEach(k=>updateMetalIndustrialOne(k)), 2*3600*1000);

// فوركس (الأزواج التي طُلبت) كل ساعتين
setInterval(()=> Array.from(lastFXPairs).forEach(p=>updateFXOne(p)), 2*3600*1000);

// تشغيل مبدئي سريع
(async ()=>{
  try{
    await updateGold(); await updateSilver();
    cryptoList.forEach(s=>updateCryptoOne(s));
    Object.keys(energy).forEach(k=>updateEnergyOne(k));
    Object.keys(metalsIndustrial).forEach(k=>updateMetalIndustrialOne(k));
    log("Warmup fired.");
  }catch(e){ log("Warmup error: "+e.message); }
})();

// =============== EXPRESS API ===============
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public")); // للـ admin.html

// صحّة
app.get("/api/health", (req,res)=> res.json({ok:true, ts: now()}));

// أسعار سريعة
app.get("/api/gold",   (req,res)=> res.json(cache["GOLD"]   || {error:"no data"}));
app.get("/api/silver", (req,res)=> res.json(cache["SILVER"] || {error:"no data"}));

// كريبتو
app.get("/api/crypto", (req,res)=>{
  const list = (req.query.list||"BTC,ETH,SLX").split(",").map(s=>s.trim().toUpperCase());
  const out={};
  list.forEach(sym=> out[sym] = cache[`CRYPTO:${sym}`] || {error:"no data"} );
  res.json(out);
});

// نفط/غاز
app.get("/api/oil", (req,res)=>{
  const out={};
  Object.keys(energy).forEach(k => out[k] = cache[`ENERGY:${k}`] || {error:"no data"});
  res.json(out);
});

// معادن صناعية
app.get("/api/metals", (req,res)=>{
  const list = (req.query.list||Object.keys(metalsIndustrial).join(",")).split(",").map(s=>s.trim().toUpperCase());
  const out={};
  list.forEach(k=> out[k] = cache[`METAL:${k}`] || {error:"no data"} );
  res.json(out);
});

// فوركس
app.get("/api/fx", async (req,res)=>{
  try{
    const from=(req.query.from||"USD").toUpperCase();
    const to=(req.query.to||"EGP").toUpperCase();
    const symbol = `FX:${from}:${to}`;
    lastFXPairs.add(`${from}/${to}`);
    if (!cache[symbol] || (now()-(cache[symbol].ts||0) > 3*3600*1000)){
      // تحديث فوري لو قديم جدًا
      await updateFXOne(`${from}/${to}`);
    }
    res.json(cache[symbol] || {error:"no data"});
  }catch(e){
    res.status(500).json({error: e.message||String(e)});
  }
});

// =============== ADMIN API ===============

// حالة عامة + الكاش
app.get("/api/admin/state", (req,res)=>{
  const token = req.query.token||"";
  if (token !== ADMIN_TOKEN) return res.status(403).json({error:"forbidden"});
  res.json({ ok:true, cache, time: fmtTs(now()) });
});

// سجل
app.get("/api/admin/logs", (req,res)=>{
  const token = req.query.token||"";
  if (token !== ADMIN_TOKEN) return res.status(403).json({error:"forbidden"});
  res.json({ logs });
});

// تعيين سعر يدوي
app.post("/api/admin/set", (req,res)=>{
  const { token, symbol, price } = req.body||{};
  if (token !== ADMIN_TOKEN) return res.status(403).json({error:"forbidden"});
  const p = Number(price);
  if (!symbol || !Number.isFinite(p)) return res.status(400).json({error:"bad input"});
  setPrice(symbol.toUpperCase(), p, "MANUAL", "USD", true);
  return res.json({ ok:true });
});

// إلغاء اليدوي
app.post("/api/admin/clear", (req,res)=>{
  const { token, symbol } = req.body||{};
  if (token !== ADMIN_TOKEN) return res.status(403).json({error:"forbidden"});
  const s = symbol.toUpperCase();
  if (!cache[s]) return res.status(404).json({error:"not found"});
  cache[s].manual = false;
  cache[s].source = cache[s].source?.replace(" [MANUAL]","") || cache[s].source;
  log(`CLEAR manual ${s}`);
  return res.json({ ok:true });
});

// صفحة الأدمن
app.get("/admin", (req,res)=> res.sendFile(process.cwd()+"/public/admin.html"));

// بدء السيرفر
app.listen(PORT, ()=> log(`Server running on :${PORT}`));
