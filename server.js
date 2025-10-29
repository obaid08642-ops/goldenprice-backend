import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio"; // ✅ تصحيح طريقة الاستيراد
import cron from "node-cron";
import fetch from "node-fetch";
import { WebSocketServer } from "ws"; // ✅ لمكتبة ws الجديدة

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// تخزين البيانات في الذاكرة مؤقتًا
let metalsData = {};
let lastUpdated = null;

// 🔁 دالة تحديث البيانات
async function fetchMetalsData() {
  console.log("🔄 Fetching metals data...");
  try {
    const urls = [
      "https://www.metals-api.com/", 
      "https://www.investing.com/commodities/",
      "https://www.marketwatch.com/investing/future/gold"
    ];

    const results = [];

    for (const url of urls) {
      const response = await fetch(url);
      const html = await response.text();
      const $ = cheerio.load(html);

      results.push({
        url,
        title: $("title").text(),
        timestamp: new Date().toISOString()
      });
    }

    metalsData = results;
    lastUpdated = new Date().toISOString();

    console.log("✅ Metals data updated successfully at", lastUpdated);
  } catch (error) {
    console.error("❌ Error fetching metals data:", error.message);
  }
}

// 📅 جدولة التحديث كل 24 ساعة (أو عدّل المدة لو عايز)
cron.schedule("0 */24 * * *", fetchMetalsData); // كل 24 ساعة
fetchMetalsData(); // تشغيل أول مرة عند بدء السيرفر

// 🧩 API Endpoint
app.get("/api/metals", (req, res) => {
  res.json({
    success: true,
    lastUpdated,
    data: metalsData
  });
});

// 🔥 WebSocket للبث اللحظي لو عايز تحدث البيانات مباشر
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "init", data: metalsData }));
  console.log("📡 New WebSocket client connected");
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ربط WebSocket بالسيرفر HTTP
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});
