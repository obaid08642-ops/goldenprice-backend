import { ASSETS, CORE, TAIL } from "../data/assets";
import { COUNTRIES, langsFor } from "../data/countries";
import { LANG_CODES } from "../data/languages";
import { getData } from "../lib/api";
import { url, pageExists } from "../lib/paths";
export function getStaticPaths() { return LANG_CODES.map((lang) => ({ params: { lang } })); }
export async function GET({ site, params }: { site?: URL; params: { lang: string } }) {
  const base = (site?.toString() ?? "").replace(/\/$/, "");
  const lang = params.lang as any;
  const data = await getData();
  const has = (a: { sym: string }) => data.items[a.sym]?.price != null;
  const slugs = ["", "markets", "rates", "calculators", "compare", "costs", "coins", ...CORE.filter((a) => a.slug !== "gold" && has(a)).map((a) => a.slug)];
  const lastmod = new Date().toISOString().slice(0, 10);
  const out: string[] = [];
  for (const c of COUNTRIES) {
    if (!langsFor(c).includes(lang)) continue;
    for (const s of slugs.filter((x) => pageExists(lang, c, x, slugs))) {
      const alts = langsFor(c).map((l) => `<xhtml:link rel="alternate" hreflang="${l}-${c.code}" href="${base}${url(l, c.code, s)}"/>`).join("") + `<xhtml:link rel="alternate" hreflang="x-default" href="${base}${url("en", c.code, s)}"/>`;
      out.push(`<url><loc>${base}${url(lang, c.code, s)}</loc><lastmod>${lastmod}</lastmod><changefreq>hourly</changefreq>${alts}</url>`);
    }
  }
  // global pages (stocks, extra crypto, currency pairs, more commodities) + legal pages exist once per language
  const extra = [`/${lang}/p/`, ...TAIL.filter(has).map((a) => `/${lang}/p/${a.slug}/`), ...["about", "terms", "privacy", "disclaimer", "cookies", "contact"].map((p) => `/${lang}/${p}/`)];
  for (const e of extra) out.push(`<url><loc>${base}${e}</loc><lastmod>${lastmod}</lastmod></url>`);
  if (lang === "en") for (const e of ["/en/developers/"]) out.push(`<url><loc>${base}${e}</loc><lastmod>${lastmod}</lastmod></url>`);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${out.join("")}</urlset>`, { headers: { "Content-Type": "application/xml" } });
}
