import express from "express";
import axios from "axios";
import NodeCache from "node-cache";
import cron from "node-cron";
import cors from "cors";
import fs from "fs";

const app = express();
app.use(cors());
const cache = new NodeCache({ stdTTL: 1800 }); // الكاش يعيش نص ساعة

// تحميل مصادر المواقع (TheStreetGold وغيره)
const sources = JSON.parse(fs.readFileSync("./site.json", "utf8"));

const PORT = process.env.PORT || 3000;
const GOLDEN_API_KEY = "38e67a5256f04dee810b7b9928a4a8f2"; // Twelve Data
const ALPHA_KEY = "72DETEUG9X0NTCW4";
const METAL_KEY = "0dbe2529cb182e7178c611119c9d110d";
const EXCHANGE_KEY = "bfb7221c4d791da843ecef7c84076f85";

async function fetchData() {
  console.log("⏳ بدء تحديث البيانات...");

  try {
    const [gold, silver] = await Promise.all([
      axios.get(
        `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${GOLDEN_API_KEY}`
      ),
      axios.get(
        `https://api.twelvedata.com/price?symbol=XAG/USD&apikey=${GOLDEN_API_KEY}`
      ),
    ]);

    const metals = await axios.get(
      `https://api.metalpriceapi.com/v1/latest?api_key=${METAL_KEY}&base=USD&currencies=XAU,XAG,XPT,XPD,CU,AL,ZN,NI,PB,SN,FE,STEEL,PS`
    );

    const forex = await axios.get(
      `https://api.exchangerate.host/live?access_key=${EXCHANGE_KEY}`
    );

    const crypto = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,silverx&vs_currencies=usd"
    );

    cache.set("gold", gold.data.price);
    cache.set("silver", silver.data.price);
    cache.set("metals", metals.data.rates);
    cache.set("forex", forex.data.quotes);
    cache.set("crypto", crypto.data);

    console.log("✅ تم التحديث بنجاح!");
  } catch (error) {
    console.error("❌ خطأ أثناء تحديث البيانات:", error.message);
  }
}

// TheStreetGold Scraping (كمصدر احتياطي)
async function fetchStreetGold() {
  try {
    const site = sources.find((s) => s.name === "thestreetgold");
    const res = await axios.get(site.url);
    const match = res.data.match(/Gold\s*Price\s*\$?([\d,.]+)/i);
    if (match) {
      const price = parseFloat(match[1].replace(/,/g, ""));
      cache.set("gold", price);
      console.log("🟡 TheStreetGold تحديث سعر الذهب:", price);
    }
  } catch (e) {
    console.error("⚠️ TheStreetGold فشل في الجلب:", e.message);
  }
}

// تحديثات دورية (CRON Jobs)
cron.schedule("*/3 * * * *", fetchData); // كل 3 دق ونص تقريبًا
cron.schedule("*/5 * * * *", fetchStreetGold); // كل 5 دقايق
cron.schedule("0 */5 * * *", fetchData); // كل 5 ساعات للـ Alpha

// Endpoint عام للـ Front-End
app.get("/api/prices", (req, res) => {
  const data = {
    gold: cache.get("gold") || "N/A",
    silver: cache.get("silver") || "N/A",
    metals: cache.get("metals") || {},
    forex: cache.get("forex") || {},
    crypto: cache.get("crypto") || {},
  };
  res.json(data);
});

// تعديل يدوي (تحكم الأدمن)
app.use(express.json());
app.post("/api/admin/update", (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined)
    return res.status(400).json({ message: "❌ Missing key/value" });

  cache.set(key, value);
  console.log(`🛠️ تحديث يدوي من الأدمن: ${key} = ${value}`);
  res.json({ success: true, key, value });
});

app.listen(PORT, () => {
  console.log(`🚀 GoldenPrice API Server running on port ${PORT}`);
});
