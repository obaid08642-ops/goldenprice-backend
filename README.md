
# GoldenPrice Backend — Binance + Render Ready

### ماذا يحتوي
- `server.js`  ← السيرفر (Yahoo + Investing + Kitco + GoldPrice.org) + Binance WS للكريبتو + CoinGecko fallback
- `package.json`
- `render.yaml` ← إن حبيت تستخدم Blueprint على Render
- `cache.json`  ← يتولد تلقائيًا بعد التشغيل

---

## تشغيل محلي
```
npm install
npm start
```
اختبار:
- http://localhost:3000/api/health
- http://localhost:3000/api/metals
- http://localhost:3000/api/crypto
- http://localhost:3000/api/fx

---

## نشر على Render (أسهل خطوات بدون أوامر)
1) افتح حساب GitHub + Render (مجانًا).
2) اعمل Repo جديد على GitHub باسم `goldenprice-backend` ثم من المتصفح **Upload files** وارفع: `server.js`, `package.json`, `render.yaml`, `README.md`.
3) على Render: زر **New** → **Web Service** → اربط GitHub → اختر الريبو.
4) الإعدادات:
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Environment: Node
   - (اختياري) EnvVar: `BINANCE_STREAM` لو تحب تغير الرموز.
5) Deploy.
6) بعد النجاح خُد الـ URL (مثال: `https://goldenprice-backend.onrender.com`)
7) ضع الرابط في موقعك (HTML):
```html
<script>const BACKEND="https://goldenprice-backend.onrender.com";</script>
```
وخلصنا.

---

## ملاحظات قوة وثبات
- Binance WS يعطّي سعر لحظي، وCoinGecko يضيف %التغير 24h ويعمل كـ fallback تلقائي.
- دورة مصادر المعادن كل 15 ثانية؛ يمكنك تعديل `SOURCES_INTERVAL_MS` من إعدادات Render.
- لو تغيرت صفحات Investing/Kitco DOM، راجع Logs في Render وعدّل الـ selectors في `server.js` (سطرين-٣ بالكثير).
