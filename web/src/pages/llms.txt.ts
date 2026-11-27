import { ASSETS } from "../data/assets";
import { COUNTRIES, langsFor } from "../data/countries";
import { url, SITE_NAME } from "../lib/paths";
export function GET({ site }: { site?: URL }) {
  const base = (site?.toString() ?? "").replace(/\/$/, "");
  const lines = [`# ${SITE_NAME}`, "", `> Live prices for gold, silver, platinum, copper, oil, gas, agricultural commodities, stock indices, crypto and currencies in the local currency of ${COUNTRIES.length} countries and 30 languages, with price charts, bar and coin prices, local vs. global estimates, a currency converter and gold/zakat calculators. Updated every few minutes.`, "", "## Main pages per country (language shown is the country's main language)", ""];
  for (const c of COUNTRIES) { const l = langsFor(c)[0]; lines.push(`- ${c.code} (${c.cur}): [gold](${base}${url(l, c.code)}) · [all markets](${base}${url(l, c.code, "markets")}) · [currencies](${base}${url(l, c.code, "rates")}) · [calculators](${base}${url(l, c.code, "calculators")})`); }
  lines.push("", "## Notes", "", "- Prices are indicative and may be delayed. Local retail figures, where shown, are estimates with their sources and date.", `- ${ASSETS.length} assets: metals, energy, agriculture, crypto, stock indices.`, `- Sitemap: ${base}/sitemap.xml`);
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
