// server.js – CommonJS version (stable for Render)
const express = require("express");
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const WebSocket = require("ws");
const fs = require("fs");

// ===== CONFIG =====
const PORT = process.env.PORT || 10000;
const TWELVEDATA_KEY = process.env.TWELVEDATA_KEY || "";
const ALPHAVANTAGE_KEY = process.env.ALPHAVANTAGE_KEY || "";
const FMP_KEY = process.env.FMP_KEY || "";
const MARKETSTACK_KEY = process.env.MARKETSTACK_KEY || "";
const GOLDPRICEZ_KEY = process.env.GOLDPRICEZ_KEY || "";

// ===== UTILS =====
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();
const cache = new Map();

function getCache(k) {
  const v = cache.get(k);
  if (!v) return null;
  if (now() - v.t < v.ttl) return v.data;
  return null;
}
function setCache(k, d, ttl) {
  cache.set(k, { t: now(), ttl, data: d });
}
async function tryJson(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(r.statusText);
  return await r.json();
}
async function tryText(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(r.statusText);
  return await r.text();
}

// ===== METALS =====
const METALS = {
  gold: { unit:"oz", td:"XAU/USD", y:"XAUUSD=X" },
  silver: { unit:"oz", td:"XAG/USD", y:"XAGUSD=X" },
  platinum:{unit:"oz",td:"XPT/USD",y:"XPTUSD=X"},
  palladium:{unit:"oz",td:"XPD/USD",y:"XPDUSD=X"},
  copper:{unit:"lb",y:"HG=F"},
  aluminum:{unit:"t",y:"ALI=F"},
  zinc:{unit:"t",y:"MZN=F"},
  nickel:{unit:"t",y:"NID=F"},
  lead:{unit:"t",y:"LD=F"},
  tin:{unit:"t",y:"TIN=F"}
};
const TTL = { fast: 60000, slow: 86400000 };

async function yahoo(t) {
  const j = await tryJson(`https://query1.finance.yahoo.com/v8/finance/chart/${t}`);
  return j.chart.result[0].meta.regularMarketPrice;
}
async function td(t) {
  const j = await tryJson(`https://api.twelvedata.com/price?symbol=${t}&apikey=${TWELVEDATA_KEY}`);
  return Number(j.price);
}

async function metal(m) {
  const key = `m:${m}`;
  const c = getCache(key);
  if (c) return c;
  const meta = METALS[m];
  let v;
  try { v = await td(meta.td); } catch {}
  if (!v) try { v = await yahoo(meta.y); } catch {}
  if (!v) throw new Error("no metal data");
  const out = { price:v, unit:meta.unit };
  setCache(key, out, TTL.fast);
  return out;
}

// ===== CRYPTO =====
const wsPrices = new Map();
function startWS() {
  const pairs = ["btcusdt","ethusdt","solusdt","xrpusdt"];
  const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${pairs.map(p=>`${p}@ticker`).join("/")}`);
  ws.on("message", b=>{
    try{
      const d = JSON.parse(b).data;
      if (d?.s && d?.c) wsPrices.set(d.s, Number(d.c));
    }catch{}
  });
  ws.on("close",()=>setTimeout(startWS,3000));
}
startWS();

async function crypto(sym){
  const k = `c:${sym}`;
  const c = getCache(k);
  if (c) return c;
  const ws = wsPrices.get(`${sym.toUpperCase()}USDT`);
  if (ws){ const o={price:ws}; setCache(k,o,10000); return o;}
  const j = await tryJson(`https://api.coingecko.com/api/v3/simple/price?ids=${sym.toLowerCase()}&vs_currencies=usd`);
  const v = j?.[sym.toLowerCase()]?.usd;
  const out = { price:v };
  setCache(k,out,10000);
  return out;
}

// SLX
async function slx(){
  const j = await tryJson("https://api.dexscreener.com/latest/dex/tokens/0x34317C020E78D30feBD2Eb9f5fa8721aA575044d");
  const v = j?.pairs?.[0]?.priceUsd;
  return { price:Number(v) };
}

// ===== SCRAPING =====
let sites=[];
try{ sites=JSON.parse(fs.readFileSync("./sites.json","utf-8")); }catch{}
async function scrapeOnce(r){
  const h=await tryText(r.url);
  const $=cheerio.load(h);
  const t=$(r.selector).first().text().replace(/[, ]+/g,"").replace(/[^\d.]/g,"");
  return Number(t);
}
let idx=0;
async function rotate(){
  if(!sites.length)return;
  const r=sites[idx++%sites.length];
  try{
    const v=await scrapeOnce(r);
    setCache(`m:${r.type}`,{price:v},TTL.fast);
  }catch{}
}
setInterval(rotate,300000);

// ===== EXPRESS =====
const app = express();

app.get("/api/health",(q,r)=>r.json({ok:true}));
app.get("/api/metals",async(q,r)=>{
  try{
    const list=(q.query.list||"gold,silver").split(",");
    const out={};
    for(const m of list) out[m]=await metal(m);
    r.json(out);
  }catch(e){r.status(500).json({error:e.message});}
});
app.get("/api/crypto",async(q,r)=>{
  try{
    const list=(q.query.list||"BTC,ETH,SLX").split(",");
    const out={};
    for(const s of list){
      if(s.toUpperCase()==="SLX") out[s]=await slx();
      else out[s]=await crypto(s);
    }
    r.json(out);
  }catch(e){r.status(500).json({error:e.message});}
});

app.listen(PORT,()=>console.log("✅ Server on "+PORT));
