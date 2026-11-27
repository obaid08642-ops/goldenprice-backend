// Sitemap index: one file per language (keeps each file small). Each URL lists its sister languages (hreflang).
import { LANG_CODES } from "../data/languages";
export function GET({ site }: { site?: URL }) {
  const base = (site?.toString() ?? "").replace(/\/$/, "");
  const now = new Date().toISOString().slice(0, 10);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${LANG_CODES.map((l) => `<sitemap><loc>${base}/sitemap-${l}.xml</loc><lastmod>${now}</lastmod></sitemap>`).join("")}</sitemapindex>`, { headers: { "Content-Type": "application/xml" } });
}
