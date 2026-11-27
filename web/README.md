# GoldenPrice website (Astro, static)

Static site, one page per language × country × asset, generated at build time from the backend API, then refreshed live in the browser.

```
npm install
PUBLIC_API_URL=https://<your-backend>.onrender.com SITE=https://<your-domain> npm run build   # output: dist/
npm run dev
```

## Deploy on Cloudflare Pages (free)
1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → this repo.
2. Root directory `web`, build command `npm run build`, output directory `dist`.
3. Environment variables: `PUBLIC_API_URL` (backend URL), `SITE` (final domain, e.g. https://example.com), optional `PUBLIC_ADS=1` once AdSense is approved.
4. Settings → Builds → Deploy hooks → create one, then add it as the repo secret `CF_DEPLOY_HOOK` so `.github/workflows/rebuild.yml` rebuilds the site hourly (keeps the server-rendered prices fresh for search engines).

## Where things live
- `src/data/languages.ts` languages · `src/data/countries.ts` countries, currencies, local-retail assumptions
- `src/i18n/ui.ts` all UI strings and asset names per language
- `src/lib/render.ts` the HTML for prices (used at build and in the browser)
- Every language works for every country; only the country's own languages plus English are indexed (hreflang + sitemap), the rest are `noindex`.
