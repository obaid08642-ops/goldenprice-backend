# GoldenPrice Backend — Final

Production-grade hybrid backend:
- Primary: TwelveData + API Ninjas + GoldPriceZ (precious)
- Scraping: Yahoo + X-Rates (gold)
- Backup: MarketStack + GoldAPI + AlphaVantage (FX)
- Smart caching + backoff + Binance WS for crypto
- Endpoints: /api/health, /api/status, /api/metals, /api/fx, /api/crypto

## Env Vars
API_NINJAS_KEY, TWELVEDATA_KEY, ALPHAVANTAGE_KEY, MARKETSTACK_KEY, GOLDAPI_KEY, GOLDPRICEZ_KEY, PORT=10000

## Run
npm install
npm start
