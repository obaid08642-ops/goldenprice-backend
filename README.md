# GoldenPrice Backend

Hybrid backend for Gold, Silver, Crypto, Oil/Gas and 17 Metals with:
- Rotating providers (TwelveData → MetalPriceAPI → TheStreetGold)
- AlphaVantage for WTI/Brent/Natural Gas (rate-limited; updates every 6h)
- CoinGecko for crypto
- PancakeSwap for SilverX (set `SILVERX_CONTRACT`)
- In-memory cache + Admin panel (manual overrides)
- Admin UI: public/admin.html (served at /admin.html; nothing else in the repo is served statically)

## Deploy (Render)
1) Create a new **Web Service** → connect this repo.
2) Build command: (none) — Render installs automatically from `package.json`.
3) Start command: `node server.js`
4) Environment:
   - `PORT` = 10000
   - `ADMIN_TOKEN` = a strong secret
   - `TWELVEDATA_KEY`, `METALPRICE_KEY`, `ALPHAVANTAGE_KEY`
   - `SILVERX_CONTRACT` = BEP-20 address on PancakeSwap
5) Open `https://your-app.onrender.com/admin.html`

## Endpoints
- `/` → health
- `/api/status`
- `/api/gold`
- `/api/silver`
- `/api/crypto/:symbol` (e.g. `bitcoin`, `ethereum`)
- `/api/oilgas` (WTI, BRENT, NG)
- `/api/metals` (bulk 17), `/api/metals/:code` (XAU,XAG,XPT,XPD,…)
- `/api/silverx`
- Admin:
  - `POST /api/admin/set`  body: `{category, key?, value, source:"manual"}`  header: `Authorization: Bearer <ADMIN_TOKEN>`
  - `POST /api/admin/refresh`  header: `Authorization: Bearer <ADMIN_TOKEN>`

## Rotation
- Providers rotate every **3 minutes** automatically.
- Weekends: gold/silver keep cached values (no API spam).

## Notes
- MetalPriceAPI supports precious metals best (XAU/XAG/XPT/XPD).  
  Industrial/rare metals are placeholders on free tiers and may return empty until a suitable API plan is added.

## Environment
- `DATABASE_URL` (Neon Postgres), `ADMIN_TOKEN` (required; admin is disabled without it, send as `x-admin-token`).
- Optional email alerts for missing/stale prices: `RESEND_API_KEY`, `ALERT_EMAIL`.
- `/api/admin/status` lists every tracked price with its age; manual entries are flagged stale after 48h.
