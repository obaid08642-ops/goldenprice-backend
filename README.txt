GoldenPriceBackend-Hybrid
===========================

تشغيل سريع:
1) ارفع الملفات إلى GitHub (repo خاصتك) أو مباشرة على Render.
2) على Render → Environment → أضف المفاتيح التالية (لا تضعها على GitHub):
   API_NINJAS_KEY = <put your key here>
   TWELVEDATA_KEY = <put your key here>
   ALPHAVANTAGE_KEY = <put your key here>
   MARKETSTACK_KEY = <put your key here>
   GOLDAPI_KEY = <optional>
   GOLDPRICEZ_KEY = <optional>
3) Deploy.

Endpoints:
- /api/health
- /api/metals?list=gold,silver,platinum,palladium,copper,aluminum,nickel,zinc,lead,tin,iron,steel,cobalt,lithium,uranium
- /api/crypto?list=BTC,ETH,SOL
- /api/fx?from=USD&to=EGP

ملاحظات:
- الكاش: 60 ثانية للمعادن/الفوركس، 10 ثواني للكريبتو.
- يوجد Backoff للمصادر التي تفشل لتجنب الحظر.
- Scrapers تستخدم Yahoo/X-Rates حالياً ويمكن توسيعها بسهولة.
