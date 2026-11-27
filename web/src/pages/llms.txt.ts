import { ASSETS } from "../data/assets";
import { COUNTRIES, langsFor } from "../data/countries";
import { ASSET_NAMES } from "../i18n/ui";
import { url, SITE_NAME } from "../lib/paths";
export function GET({ site }: { site?: URL }) {
  const base = (site?.toString() ?? "").replace(/\/$/, "");
  const lines = [`# ${SITE_NAME}`, "", "> Live prices for gold, silver, platinum, palladium, copper, aluminum, oil, natural gas, Bitcoin and Ethereum in the local currency of each country, with price charts and global vs. local estimates. Updated every few minutes.", "", "## Pages", ""];
  for (const c of COUNTRIES) {
    const l = langsFor(c)[0];
    lines.push(`- [${ASSET_NAMES.en[0]} price in ${c.code}](${base}${url(l, c.code)}) · [All markets](${base}${url(l, c.code, "markets")})`);
  }
  lines.push("", "## Notes", "", "- Prices are indicative and may be delayed. Local retail figures are estimates.", `- Assets: ${ASSETS.map((a, i) => ASSET_NAMES.en[i]).join(", ")}`);
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
