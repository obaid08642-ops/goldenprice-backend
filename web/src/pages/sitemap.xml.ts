import { COUNTRIES, langsFor } from "../data/countries";
import { ASSETS } from "../data/assets";
import { url } from "../lib/paths";
// One <url> per indexable (language, country, page) with hreflang alternates to its sister pages.
export function GET({ site }: { site?: URL }) {
  const base = (site?.toString() ?? "").replace(/\/$/, "");
  const slugs = [...ASSETS.map((a) => (a.slug === "gold" ? "" : a.slug)), "markets"];
  const lastmod = new Date().toISOString().slice(0, 10);
  const out: string[] = [];
  for (const s of slugs) {
    const alts = COUNTRIES.flatMap((c) => langsFor(c).map((l) => `<xhtml:link rel="alternate" hreflang="${l}-${c.code}" href="${base}${url(l, c.code, s)}"/>`));
    alts.push(`<xhtml:link rel="alternate" hreflang="x-default" href="${base}${url("en", "US", s)}"/>`);
    for (const c of COUNTRIES) for (const l of langsFor(c)) out.push(`<url><loc>${base}${url(l, c.code, s)}</loc><lastmod>${lastmod}</lastmod><changefreq>hourly</changefreq>${alts.join("")}</url>`);
  }
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${out.join("")}</urlset>`, { headers: { "Content-Type": "application/xml" } });
}
