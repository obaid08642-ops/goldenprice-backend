import { bcpOf, type Lang } from "../data/languages";
const loc = (l: Lang) => `${bcpOf(l)}-u-nu-latn`; // keep Latin digits in every language (common on price sites)
export function digitsFor(v: number) { return v >= 100000 ? 0 : v >= 1 ? 2 : 4; }
export function fmt(lang: Lang, v: number | null | undefined, digits?: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const d = digits ?? digitsFor(Math.abs(v));
  return new Intl.NumberFormat(loc(lang), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}
export function pct(lang: Lang, v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${new Intl.NumberFormat(loc(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v))}%`;
}
export const countryName = (lang: Lang, code: string) => new Intl.DisplayNames([bcpOf(lang)], { type: "region" }).of(code) || code;
export const currencyName = (lang: Lang, cur: string) => new Intl.DisplayNames([bcpOf(lang)], { type: "currency" }).of(cur) || cur;
