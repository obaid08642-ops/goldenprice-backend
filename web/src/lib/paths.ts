import { COUNTRIES, langsFor, type Country } from "../data/countries";
import { LANG_CODES, type Lang } from "../data/languages";
import { ASSETS } from "../data/assets";
export const url = (lang: Lang, cc: string, slug = "") => `/${lang}/${cc.toLowerCase()}/${slug && slug !== "gold" ? slug + "/" : ""}`;
// Every language works in every country (UI choice), but only the country's own languages + English are indexed.
export const isPrimary = (lang: Lang, c: Country) => langsFor(c).includes(lang);
export const combos = () => COUNTRIES.flatMap((c) => LANG_CODES.map((l) => ({ lang: l, country: c, primary: isPrimary(l, c) })));
export const pageSlugs = ["", ...ASSETS.filter((a) => a.slug !== "gold").map((a) => a.slug), "markets"];
export const SITE_NAME = "Golden Price"; // brand placeholder until the domain/name is final
