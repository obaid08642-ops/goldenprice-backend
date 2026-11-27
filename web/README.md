# Price Radar website (Astro, static)

Static site: one page per language x country x asset, generated at build time from the backend API (first paint and SEO), then refreshed live in the browser.

```
npm install
PUBLIC_API_URL=https://<your-backend>.onrender.com SITE=https://<your-domain> npm run build   # output: dist/
npm run dev
```

## What it contains
- 69 countries (`src/data/countries.ts`), 30 UI languages (`src/i18n/lang/*.json`), 59 assets (`src/data/assets.ts`): metals, energy, crops, crypto, stock indices.
- Per country (main languages + English are indexed): gold home, every asset with a price, `/markets/`, `/rates/` (currency converter), `/calculators/` (gold value + zakat).
- Other languages work in every country for the home and markets pages (noindex) so the language switcher never dead-ends.
- Assets without a price yet (nickel, zinc, lead, tin, cobalt, lithium, uranium, iron ore, steel) get no page until the admin enters a price.
- SEO: hreflang between a country's languages, sitemap index (one file per language), robots.txt, llms.txt, JSON-LD (WebPage, BreadcrumbList, FAQPage), "popular searches" taken from Google autocomplete.

## Data you maintain
- `src/i18n/lang/en.json` is the source text. Translate to a new language by adding `<code>.json` (check with `node scripts/check-i18n.mjs <code>`) and the language to `src/data/languages.ts`.
- `src/data/retail/<CC>.json`: researched local retail data (VAT, making charge, bar premiums, buyback). Validate with `node scripts/check-retail.mjs <CC>`. Only medium/high confidence files are displayed; low-confidence files are research notes. The site never shows numbers without a source.
- `src/data/keywords/*.json`: harvested with `node scripts/harvest-keywords.mjs` (needs access to suggestqueries.google.com).

## Deploy on Cloudflare Pages (free)
1. Cloudflare dashboard -> Workers & Pages -> Create -> Pages -> Connect to Git -> this repo.
2. Root directory `web`, build command `npm run build`, output directory `dist`.
3. Environment variables: `PUBLIC_API_URL` (backend URL), `SITE` (final domain, e.g. https://example.com), optional `PUBLIC_ADS=1` once AdSense is approved.
4. Settings -> Builds -> Deploy hooks -> create one, add it as the repo secret `CF_DEPLOY_HOOK` so `.github/workflows/rebuild.yml` rebuilds the site hourly (keeps the server-rendered prices fresh for search engines).
