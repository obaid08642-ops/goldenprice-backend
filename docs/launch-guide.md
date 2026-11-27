# Launch guide (Price Radar)

Do these in order. Each step says what you get and what to send back to me (never send passwords or keys in chat; put keys in Render/Cloudflare settings yourself).

## 1) Domain
Pick one main domain (a .com is the safest for trust and for ad approval). Point the other domains to it with a redirect (Cloudflare: Rules > Redirect Rules). Put the main domain on Cloudflare: https://dash.cloudflare.com/sign-up then "Add a domain" and change the nameservers at the registrar.

## 2) Cloudflare Pages (hosts the website, free)
1. https://dash.cloudflare.com > Workers & Pages > Create > Pages > Connect to Git > choose `goldenprice-backend` (branch `main`).
2. Build settings: Framework preset Astro, Root directory `web`, Build command `npm install && npm run build`, Output directory `dist`.
3. Environment variables (Production): `PUBLIC_API_URL` = `https://goldenprice-backend.onrender.com`, `SITE` = `https://YOURDOMAIN.com`, `NODE_VERSION` = `22`.
4. Save and deploy (the first build takes ~4 minutes). Then Custom domains > add your domain.
5. Hourly refresh: Settings > Builds > Deploy hooks > create one, copy the URL, then GitHub repo > Settings > Secrets and variables > Actions > New secret named `CF_DEPLOY_HOOK`.
Limit to remember: a Pages project holds at most 20,000 files. Check the count after each big addition (`find web/dist -type f | wc -l`).

## 3) Render (backend) settings to check
In the service Environment tab: `ADMIN_TOKEN` (change it to a new long random value), `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `SITE_URL` (your https domain), optional `RESEND_API_KEY`, `ALERT_EMAIL`. NOWPayments IPN URL: `https://goldenprice-backend.onrender.com/api/billing/nowpayments`.

## 4) Google Search Console
https://search.google.com/search-console > Add property > Domain (verify with the DNS TXT record in Cloudflare) > Sitemaps > submit `https://YOURDOMAIN.com/sitemap.xml`.

## 5) Bing Webmaster Tools
https://www.bing.com/webmasters > Import from Google Search Console (one click) > the sitemap is imported too. Bing also feeds DuckDuckGo and several AI assistants.

## 6) Cloudflare Web Analytics (free, no cookies)
Cloudflare dashboard > Analytics & Logs > Web Analytics > Add a site > copy the script line and send it to me; I add it to the layout. (If the domain is on Cloudflare you can also enable it with one click.)

## 7) Google AdSense (after the site is live)
https://adsense.google.com > sign up with the final domain. Needs: the site online for some weeks with real content, privacy/cookie/terms/contact pages (already there), and a way to see the domain verification. Send me your publisher ID (`ca-pub-...`) and I add `ads.txt` and the ad slots. Expect review of days to weeks; do not click your own ads.

## 8) Email (optional, free tier)
https://resend.com > add your domain (DNS records in Cloudflare) > API Keys > create. Needed only for price alerts and approval emails. Without it, alerts are not sent.

## 9) Payments
NOWPayments (crypto) is connected. For cards you need a second provider; see the chat for options.
