
/**
 * GoldenPrice Backend — Hardened + Binance WS
 * Node 18+, Express, node-fetch@2, cheerio, ws
 *
 * Metals:
 *   - Primary: Yahoo JSON (GC=F, SI=F)
 *   - Fallbacks: Investing (gold/silver), GoldPrice.org, Kitco (heuristics)
 * Crypto:
 *   - Primary: Binance WebSocket (btcusdt, ethusdt)
 *   - Fallback: CoinGecko every 15s
 * FX:
 *   - exchangerate.host
 *
 * Endpoints:
 *   GET /api/health
 *   GET /api/metals
 *   GET /api/crypto
 *   GET /api/fx
 *   GET /api/history/gold
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const fetch = require('node-fetch'); // v2
const cheerio = require('cheerio');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SOURCES_INTERVAL = parseInt(process.env.SOURCES_INTERVAL_MS || '15000', 10);
const FX_INTERVAL = parseInt(process.env.FX_INTERVAL_MS || '15000', 10);
const CG_INTERVAL = parseInt(process.env.CRYPTO_INTERVAL_MS || '15000', 10);
const USER_AGENT = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const BINANCE_STREAM = process.env.BINANCE_STREAM || 'wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade';

const CACHE_FILE = path.join(__dirname, 'cache.json');
const OZ_TO_GRAM = 31.1034768;

// ---- State ----
let metalsCache = { gold: null, silver: null, updated: null };
let cryptoCache = { BTCUSDT: null, ETHUSDT: null, updated: null };
let fxCache = { base: 'USD', rates: {}, updated: null };
let historyCache = { goldGramPoints: [] };

// ---- Utils ----
function nowISO(){ return new Date().toISOString(); }
function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
function delay(ms){ return new Promise(res => setTimeout(res, ms)); }
function jitter(ms){ const j = Math.floor(Math.random()*ms*0.2); return ms + j; }

async function fetchWithRetry(url, opts={}, retries=2){
  let attempt = 0;
  let lastErr;
  while(attempt <= retries){
    try{
      const res = await fetch(url, {
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENT, ...(opts.headers||{}) },
        ...opts
      });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    }catch(e){
      lastErr = e;
      attempt++;
      if(attempt <= retries) await delay(jitter(500));
    }
  }
  throw lastErr;
}

function saveCache(){
  try{
    const obj = { metalsCache, cryptoCache, fxCache, historyCache };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj,null,2), 'utf8');
  }catch(e){}
}
function loadCache(){
  try{
    if(fs.existsSync(CACHE_FILE)){
      const j = JSON.parse(fs.readFileSync(CACHE_FILE,'utf8'));
      metalsCache = j.metalsCache || metalsCache;
      cryptoCache = j.cryptoCache || cryptoCache;
      fxCache = j.fxCache || fxCache;
      historyCache = j.historyCache || historyCache;
    }
  }catch(e){}
}

// ---- Metals: Sources ----

// 1) Yahoo JSON (Primary)
async function srcYahoo(){
  const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=GC=F,SI=F';
  const res = await fetchWithRetry(url);
  const j = await res.json();
  const arr = j?.quoteResponse?.result || [];
  const gold = arr.find(x=>x.symbol==='GC=F');
  const silver = arr.find(x=>x.symbol==='SI=F');

  let updated = false;
  if(gold?.regularMarketPrice){
    metalsCache.gold = {
      ounce: toNum(gold.regularMarketPrice),
      gram: toNum(gold.regularMarketPrice)/OZ_TO_GRAM,
      change24h: toNum(gold.regularMarketChangePercent),
      source: 'Yahoo'
    };
    updated = true;
  }
  if(silver?.regularMarketPrice){
    metalsCache.silver = {
      ounce: toNum(silver.regularMarketPrice),
      gram: toNum(silver.regularMarketPrice)/OZ_TO_GRAM,
      change24h: toNum(silver.regularMarketChangePercent),
      source: 'Yahoo'
    };
    updated = true;
  }
  if(updated){
    metalsCache.updated = nowISO();
    return true;
  }
  return false;
}

// Investing Gold
async function srcInvestingGold(){
  const url = 'https://www.investing.com/commodities/gold';
  const res = await fetchWithRetry(url);
  const html = await res.text();
  const $ = cheerio.load(html);
  const candidates = [
    'div[data-test="instrument-price-last"]',
    'span[data-test="instrument-price-last"]',
    '.text-5xl', '.instrument-price_last__KQzyA',
  ];
  let price = null;
  for(const sel of candidates){
    const txt = $(sel).first().text().replace(/[, ]/g,'');
    if(txt && /^[0-9]+(\.[0-9]+)?$/.test(txt)){ price = toNum(txt); break; }
  }
  if(!price){
    const m = $('body').text().match(/Gold\s+(?:Futures|Spot).*?([0-9]{3,5}\.[0-9]{1,2})/i);
    if(m && m[1]) price = toNum(m[1]);
  }
  if(price){
    metalsCache.gold = { ounce: price, gram: price/OZ_TO_GRAM, change24h: null, source:'Investing(Gold)' };
    metalsCache.updated = nowISO();
    return true;
  }
  return false;
}

// Investing Silver
async function srcInvestingSilver(){
  const url = 'https://www.investing.com/commodities/silver';
  const res = await fetchWithRetry(url);
  const html = await res.text();
  const $ = cheerio.load(html);
  const candidates = [
    'div[data-test="instrument-price-last"]',
    'span[data-test="instrument-price-last"]',
    '.text-5xl', '.instrument-price_last__KQzyA',
  ];
  let price = null;
  for(const sel of candidates){
    const txt = $(sel).first().text().replace(/[, ]/g,'');
    if(txt && /^[0-9]+(\.[0-9]+)?$/.test(txt)){ price = toNum(txt); break; }
  }
  if(!price){
    const m = $('body').text().match(/Silver\s+(?:Futures|Spot).*?([0-9]{1,3}\.[0-9]{1,2})/i);
    if(m && m[1]) price = toNum(m[1]);
  }
  if(price){
    metalsCache.silver = { ounce: price, gram: price/OZ_TO_GRAM, change24h: null, source:'Investing(Silver)' };
    metalsCache.updated = nowISO();
    return true;
  }
  return false;
}

// GoldPrice.org
async function srcGoldPriceOrg(){
  const url = 'https://goldprice.org/';
  const res = await fetchWithRetry(url);
  const html = await res.text();
  const $ = cheerio.load(html);
  const text = $('body').text();
  const mg = text.match(/Gold\s*Price\s*\$?\s*([0-9]{3,5}\.?[0-9]{0,2})/i);
  const ms = text.match(/Silver\s*Price\s*\$?\s*([0-9]{1,3}\.?[0-9]{0,2})/i);
  let updated = false;
  if(mg && mg[1]){
    const p = toNum(mg[1]);
    metalsCache.gold = { ounce: p, gram: p/OZ_TO_GRAM, change24h: null, source:'GoldPrice.org' };
    updated = true;
  }
  if(ms && ms[1]){
    const p = toNum(ms[1]);
    metalsCache.silver = { ounce: p, gram: p/OZ_TO_GRAM, change24h: null, source:'GoldPrice.org' };
    updated = true;
  }
  if(updated){ metalsCache.updated = nowISO(); return true; }
  return false;
}

// Kitco
async function srcKitco(){
  const url = 'https://www.kitco.com/charts/livegold.html';
  const res = await fetchWithRetry(url);
  const html = await res.text();
  const $ = cheerio.load(html);
  const text = $('body').text();
  const mg = text.match(/Gold\s*Price.*?([0-9]{3,5}\.[0-9]{1,2})/i);
  const ms = text.match(/Silver\s*Price.*?([0-9]{1,3}\.[0-9]{1,2})/i);
  let updated = false;
  if(mg && mg[1]){
    const p = toNum(mg[1]);
    metalsCache.gold = { ounce: p, gram: p/OZ_TO_GRAM, change24h: null, source:'Kitco' };
    updated = true;
  }
  if(ms && ms[1]){
    const p = toNum(ms[1]);
    metalsCache.silver = { ounce: p, gram: p/OZ_TO_GRAM, change24h: null, source:'Kitco' };
    updated = true;
  }
  if(updated){ metalsCache.updated = nowISO(); return true; }
  return false;
}

const sourceFns = [srcYahoo, srcInvestingGold, srcInvestingSilver, srcGoldPriceOrg, srcYahoo, srcKitco];
let srcIndex = 0;
async function rotateSources(){
  const fn = sourceFns[srcIndex];
  srcIndex = (srcIndex + 1) % sourceFns.length;
  try {
    const ok = await fn();
    if(!ok) console.warn('[rotate] Source returned no update');
  } catch(e){
    console.error('[rotate] Source error:', e.message);
  } finally { saveCache(); }
}

// ---- Crypto: Binance WS (primary) + CoinGecko (fallback) ----
let ws;
let wsAlive = false;
let wsReconnectTimer = null;

function startBinanceWS(){
  try{
    ws = new WebSocket(BINANCE_STREAM);
    ws.on('open', ()=>{
      wsAlive = true;
      console.log('Binance WS connected');
    });
    ws.on('message', (raw)=>{
      try{
        const msg = JSON.parse(raw.toString());
        // Combined stream -> msg.stream, msg.data
        const d = msg?.data;
        if(!d) return;
        // For trade stream: d.p = price string, s = symbol
        if(typeof d.p !== 'undefined' && d.s){
          const price = toNum(d.p);
          if(!price) return;
          if(d.s.toUpperCase()==='BTCUSDT'){
            cryptoCache.BTCUSDT = { price, change24h: cryptoCache.BTCUSDT?.change24h ?? null };
          } else if(d.s.toUpperCase()==='ETHUSDT'){
            cryptoCache.ETHUSDT = { price, change24h: cryptoCache.ETHUSDT?.change24h ?? null };
          }
          cryptoCache.updated = nowISO();
        }
      }catch(e){ /* ignore parse */ }
    });
    ws.on('close', ()=>{
      console.warn('Binance WS closed');
      wsAlive = false;
      scheduleWSReconnect();
    });
    ws.on('error', (e)=>{
      console.error('Binance WS error', e.message);
      wsAlive = false;
      try{ ws.close(); }catch{}
      scheduleWSReconnect();
    });
  }catch(e){
    console.error('WS start error', e.message);
    scheduleWSReconnect();
  }
}
function scheduleWSReconnect(){
  if(wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(()=>{
    wsReconnectTimer = null;
    startBinanceWS();
  }, 3000);
}

// CoinGecko fallback every 15s (fills 24h change + boots initial if WS slow)
async function updateCryptoFallback(){
  try{
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true';
    const res = await fetchWithRetry(url);
    const j = await res.json();
    const btc = toNum(j?.bitcoin?.usd);
    const btcchg = toNum(j?.bitcoin?.usd_24h_change);
    const eth = toNum(j?.ethereum?.usd);
    const ethchg = toNum(j?.ethereum?.usd_24h_change);
    if(btc){
      cryptoCache.BTCUSDT = { price: cryptoCache.BTCUSDT?.price ?? btc, change24h: btcchg };
    }
    if(eth){
      cryptoCache.ETHUSDT = { price: cryptoCache.ETHUSDT?.price ?? eth, change24h: ethchg };
    }
    cryptoCache.updated = nowISO();
  }catch(e){
    console.warn('CoinGecko fallback error', e.message);
  }finally { saveCache(); }
}

// ---- FX ----
async function updateFX(){
  try{
    const url = 'https://api.exchangerate.host/latest?base=USD';
    const res = await fetchWithRetry(url);
    const j = await res.json();
    fxCache.base = j.base;
    fxCache.rates = j.rates;
    fxCache.updated = nowISO();
  }catch(e){
    console.warn('FX error', e.message);
  }finally { saveCache(); }
}

// ---- History ----
function pushHistoryPoint(){
  if(metalsCache?.gold?.gram){
    historyCache.goldGramPoints.push({ ts: Date.now(), gram: metalsCache.gold.gram });
    if(historyCache.goldGramPoints.length > 300){
      historyCache.goldGramPoints.splice(0, historyCache.goldGramPoints.length - 300);
    }
    saveCache();
  }
}

// ---- Bootstrap ----
loadCache();
(async ()=>{
  await updateFX();
  await updateCryptoFallback(); // seed change%
  await srcYahoo();            // seed metals
  metalsCache.updated = nowISO();
  saveCache();
})();

setInterval(rotateSources, SOURCES_INTERVAL);
setInterval(updateFX, FX_INTERVAL);
setInterval(updateCryptoFallback, CG_INTERVAL);

// Start Binance WS
startBinanceWS();

// ---- API ----
app.get('/', (req,res)=> res.send('GoldenPrice backend OK'));
app.get('/api/health', (req,res)=> res.json({ ok:true, now: nowISO(), ws: wsAlive }));
app.get('/api/metals', (req,res)=> res.json(metalsCache));
app.get('/api/crypto', (req,res)=> res.json(cryptoCache));
app.get('/api/fx', (req,res)=> res.json(fxCache));
app.get('/api/history/gold', (req,res)=> res.json(historyCache.goldGramPoints));

app.listen(PORT, ()=> console.log(`GoldenPrice backend listening on ${PORT}`));
