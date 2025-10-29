const express = require("express");
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 10000;

let cache = {};
const CACHE_DURATION = 180000; // 3 دقائق

// تحميل المواقع
let sites = [];
try {
  sites = JSON.parse(fs.readFileSync("sites.json", "utf8"));
} catch (err) {
  console.error("❌ Error loading sites.json:", err.message);
}

// دالة لجلب السعر من موقع واحد
async function fetchPrice(site) {
  try {
    const res = await fetch(site.url);
    const text = await res.text();
    const $ = cheerio.load(text);
    const value = $(site.selector).first().text().trim();
    if (!value) throw new Error("Empty value");
    console.log(`✅ ${site.name}: ${value}`);
    return { name: site.name, price: value };
  } catch (err) {
    console.warn(`⚠️ Failed ${site.name}: ${err.message}`);
    return { name: site.name, price: cache[site.name]?.price || "N/A" };
  }
}

// تحديث الأسعار من كل المصادر
async function updateAllPrices() {
  console.log("🔄 Updating all prices...");
  const promises = sites.map(site => fetchPrice(site));
  const results = await Promise.all(promises);
  results.forEach(r => (cache[r.name] = { price: r.price, time: Date.now() }));
  console.log("✅ All prices updated.");
}

setInterval(updateAllPrices, CACHE_DURATION);
updateAllPrices();

// API endpoint لكل الأسعار
app.get("/api/all", (req, res) => {
  res.json(cache);
});

// Endpoint خاص بالذهب فقط
app.get("/api/gold", (req, res) => {
  const goldData = Object.fromEntries(Object.entries(cache).filter(([name]) => name.toLowerCase().includes("gold")));
  res.json(goldData);
});

// Endpoint خاص بالفضة
app.get("/api/silver", (req, res) => {
  const silverData = Object.fromEntries(Object.entries(cache).filter(([name]) => name.toLowerCase().includes("silver")));
  res.json(silverData);
});

// Endpoint لعملة SilverX (من PancakeSwap)
app.get("/api/silverx", async (req, res) => {
  try {
    const response = await fetch("https://api.dexscreener.com/latest/dex/pairs/bsc/0x34317C020E78D30feBD2Eb9f5fa8721aA575044d");
    const data = await response.json();
    const price = data?.pairs?.[0]?.priceUsd || "N/A";
    res.json({ name: "SilverX", price });
  } catch (err) {
    res.json({ name: "SilverX", price: cache["SilverX"]?.price || "N/A" });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
