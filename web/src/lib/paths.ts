import { COUNTRIES, langsFor, type Country } from "../data/countries";
import { LANG_CODES, type Lang } from "../data/languages";
import { ASSETS } from "../data/assets";
import { hasCosts } from "../data/costs";
import { hasCoins } from "../data/coins";
export const SITE_NAME = "Price Radar"; // brand name; change here only
/** home (gold) = "", markets = "markets", rates = "rates", calculators = "calculators", other assets = slug */
export const url = (lang: Lang, cc: string, slug = "") => `/${lang}/${cc.toLowerCase()}/${slug && slug !== "gold" ? slug + "/" : ""}`;
// Primary = the country's own languages + English: fully built (every page) and indexed.
export const isPrimary = (lang: Lang, c: Country) => langsFor(c).includes(lang);
// Other languages work in every country, but only for the lightweight pages (home + markets) and are noindex.
// Lite countries (global price in local currency, no local retail data) only get their own languages + English, and only the precious-metal pages.
export const combos = () => COUNTRIES.flatMap((c) => LANG_CODES.filter((l) => !c.lite || isPrimary(l, c)).map((l) => ({ lang: l, country: c, primary: isPrimary(l, c) })));
export const litePage = (slug: string) => slug === "" || ["markets", "rates", "calculators", "silver", "platinum", "palladium"].includes(slug);
export const LIGHT_PAGES = ["", "markets"];
export const pageExists = (lang: Lang, c: Country, slug: string, assetSlugs: string[]) => slug === "costs" ? isPrimary(lang, c) && hasCosts(c.code) : slug === "coins" ? isPrimary(lang, c) && hasCoins(c.code) : c.lite && !litePage(slug) ? false : isPrimary(lang, c) ? (slug === "" || ["markets", "rates", "calculators", "compare"].includes(slug) || assetSlugs.includes(slug)) : LIGHT_PAGES.includes(slug);
/** long-tail assets (stocks, extra crypto, pairs...) have one global page per language: /{lang}/p/{slug}/ */
export const assetUrl = (lang: Lang, cc: string, a: { slug: string; tail: boolean }) => (a.tail ? `/${lang}/p/${a.slug}/` : url(lang, cc, a.slug));
export { ASSETS };
