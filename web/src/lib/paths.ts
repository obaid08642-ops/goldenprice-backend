import { COUNTRIES, langsFor, type Country } from "../data/countries";
import { LANG_CODES, type Lang } from "../data/languages";
import { ASSETS } from "../data/assets";
export const SITE_NAME = "Golden Price"; // brand placeholder until the domain/name is final
/** home (gold) = "", markets = "markets", rates = "rates", calculators = "calculators", other assets = slug */
export const url = (lang: Lang, cc: string, slug = "") => `/${lang}/${cc.toLowerCase()}/${slug && slug !== "gold" ? slug + "/" : ""}`;
// Primary = the country's own languages + English: fully built (every page) and indexed.
export const isPrimary = (lang: Lang, c: Country) => langsFor(c).includes(lang);
// Other languages work in every country, but only for the lightweight pages (home + markets) and are noindex.
export const combos = () => COUNTRIES.flatMap((c) => LANG_CODES.map((l) => ({ lang: l, country: c, primary: isPrimary(l, c) })));
export const LIGHT_PAGES = ["", "markets"];
export const pageExists = (lang: Lang, c: Country, slug: string, assetSlugs: string[]) => isPrimary(lang, c) ? (slug === "" || slug === "markets" || slug === "rates" || slug === "calculators" || assetSlugs.includes(slug)) : LIGHT_PAGES.includes(slug);
export { ASSETS };
