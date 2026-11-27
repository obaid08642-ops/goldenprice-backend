// Pure HTML renderers used at build time (first paint for SEO) and again in the browser (live updates).
import { ASSETS, perUnit, unitsFor, type Asset } from "../data/assets";
import { TOP_CURRENCIES, type Country } from "../data/countries";
import type { Lang } from "../data/languages";
import { ASSET_NAMES, t } from "../i18n/ui";
import { countryName, currencyName, fmt, pct } from "./format";
import { url } from "./paths";
import type { Data } from "./api";

export interface Ctx { lang: Lang; country: Country; asset: Asset; unit: string; data: Data }
const UNIT_KEY: Record<string, string> = { gram: "u_gram", ounce: "u_ounce", kilo: "u_kilo", tola: "u_tola", ton: "u_ton", coin: "u_coin" };
export const assetName = (lang: Lang, a: Asset) => ASSET_NAMES[lang][ASSETS.indexOf(a)];
export function unitLabel(lang: Lang, a: Asset, unit: string) {
  if (unit === "unit") return t(lang, a.sym === "NATGAS" ? "u_mmbtu" : "u_barrel");
  return t(lang, UNIT_KEY[unit] as any);
}
export const defaultUnit = (a: Asset) => unitsFor(a)[0];
const rateOf = (c: Ctx) => c.data.rates[c.country.cur] ?? 1;
const usdOf = (c: Ctx, a = c.asset) => c.data.items[a.sym]?.price ?? null;
/** price of asset `a` in the page currency per `unit` */
export function local(c: Ctx, a: Asset, unit: string): number | null {
  const u = usdOf(c, a);
  return u == null ? null : perUnit(a, u, unit) * rateOf(c);
}
const cls = (v: number | null) => (v == null ? "" : v >= 0 ? "up" : "dn");
const arrow = (v: number | null) => (v == null ? "" : v >= 0 ? "▲ " : "▼ ");

export function spark(vals: number[], up: boolean, w = 92, h = 28) {
  if (vals.length < 2) return "";
  const mn = Math.min(...vals), mx = Math.max(...vals), p = 2;
  const d = vals.map((v, i) => `${i ? "L" : "M"}${(p + ((w - 2 * p) * i) / (vals.length - 1)).toFixed(1)} ${(h - p - ((h - 2 * p) * (v - mn)) / (mx - mn || 1)).toFixed(1)}`).join("");
  return `<svg class="sp ${up ? "up" : "dn"}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function renderHero(c: Ctx) {
  const { lang, country, asset, unit } = c;
  const it = c.data.items[asset.sym];
  const price = local(c, asset, unit);
  const units = unitsFor(asset, country.tola);
  const seg = units.length > 1
    ? `<div class="seg" role="group">${units.map((u) => `<button type="button" data-unit="${u}" class="${u === unit ? "on" : ""}">${unitLabel(lang, asset, u)}</button>`).join("")}</div>` : "";
  const usd = it?.price;
  const ounce = asset.kind === "precious" && usd ? `<span class="chip n">${t(lang, "u_ounce")} · $${fmt(lang, usd)}</span>` : usd ? `<span class="chip n">USD $${fmt(lang, usd)}</span>` : "";
  return `<div class="hh"><div class="k">${assetName(lang, asset)} · ${t(lang, "per", { u: unitLabel(lang, asset, unit) })} · ${countryName(lang, country.code)}</div>${seg}</div>
<div class="p n" data-price>${fmt(lang, price)}<small>${country.cur}</small></div>
<div class="chips"><span class="chip n ${cls(it?.changePct ?? null)}">${arrow(it?.changePct ?? null)}${pct(lang, it?.changePct)} ${t(lang, "today")}</span>${ounce}<span class="chip k" data-updated></span></div>`;
}

export function renderSide(c: Ctx) {
  const { lang, country, asset } = c;
  const r = country.retail;
  const name = assetName(lang, asset);
  let out = "";
  if (r && (asset.sym === "GOLD" || asset.sym === "SILVER")) {
    const purity = asset.sym === "GOLD" ? r.karat / 24 : 0.925;
    const g = local(c, asset, "gram");
    if (g != null) {
      const glob = g * purity, loc = glob * (1 + r.premium), est = loc * (1 + r.making);
      const lab = asset.sym === "GOLD" ? `${r.karat}K` : "925";
      out += `<div class="card"><div class="k">${t(lang, "global_vs_local")} · ${lab}</div>
<div class="kv"><div><span class="k">${t(lang, "global_price")}</span><b class="n">${fmt(lang, glob)}</b></div><div><span class="k">${t(lang, "local_estimate")}</span><b class="n">${fmt(lang, loc)}</b></div></div>
<div class="est"><span class="k">${t(lang, "est_retail")}</span><div><b class="n">${fmt(lang, est)} ${country.cur}</b></div></div><div class="k small">${t(lang, "est_note")}</div></div>`;
    }
  }
  if (asset.karats || asset.purities) {
    const rows = (asset.karats ?? asset.purities!).map((k) => {
      const f = asset.karats ? k / 24 : k / 1000;
      return `<div class="row"><span>${asset.karats ? k + "K" : k}</span><span class="k n">${asset.karats ? ((k / 24) * 100).toFixed(1) + "%" : ""}</span><b class="n">${fmt(lang, (local(c, asset, "gram") ?? 0) * f)}</b></div>`;
    }).join("");
    out += `<div class="card"><div class="k">${t(lang, "karat_title", { a: name })} · ${country.cur}/${t(lang, "u_gram")}</div>${rows}</div>`;
  } else {
    const units = unitsFor(asset, country.tola);
    out += `<div class="card"><div class="k">${name} · ${country.cur}</div>${units.map((u) => `<div class="row"><span>${t(lang, "per", { u: unitLabel(lang, asset, u) })}</span><b class="n">${fmt(lang, local(c, asset, u))}</b></div>`).join("")}</div>`;
  }
  return out;
}

export function renderCurrencies(c: Ctx) {
  const { lang, asset, data } = c;
  const it = data.items[asset.sym];
  const usd = it?.price;
  const second = asset.kind === "precious" ? "gram" : asset.kind === "industrial" ? "kilo" : null;
  const rows = TOP_CURRENCIES.map((cur) => {
    const r = data.rates[cur] ?? 1;
    const a = usd != null ? usd * r : null;
    const b = usd != null && second ? perUnit(asset, usd, second) * r : null;
    return `<tr><td>${currencyName(lang, cur)} <span class="k">${cur}</span></td><td class="n">${fmt(lang, a)}</td>${second ? `<td class="n">${fmt(lang, b)}</td>` : ""}<td class="n ${cls(it?.changePct ?? null)}">${pct(lang, it?.changePct)}</td></tr>`;
  }).join("");
  const h1 = asset.kind === "precious" ? t(lang, "col_ounce") : t(lang, "price");
  return `<table><thead><tr><th></th><th>${h1}</th>${second ? `<th>${second === "gram" ? t(lang, "col_gram") : t(lang, "per", { u: t(lang, "u_kilo") })}</th>` : ""}<th>${t(lang, "col_24h")}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderMarkets(c: Ctx) {
  const { lang, country, data } = c;
  const rows = ASSETS.map((a) => {
    const it = data.items[a.sym];
    const u = defaultUnit(a);
    const up = (it?.changePct ?? 0) >= 0;
    return `<tr><td><a class="as" href="${url(lang, country.code, a.slug)}"><i>${a.code}</i>${assetName(lang, a)}</a></td><td class="n">${fmt(lang, local(c, a, u))}</td><td class="n ${cls(it?.changePct ?? null)}">${pct(lang, it?.changePct)}</td><td>${spark(it?.spark ?? [], up)}</td></tr>`;
  }).join("");
  return `<table class="mk"><thead><tr><th></th><th>${country.cur}</th><th>${t(lang, "col_24h")}</th><th>${t(lang, "col_7d")}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderTicker(c: Ctx) {
  const { lang, data } = c;
  return ASSETS.slice(0, 9).map((a) => {
    const it = data.items[a.sym];
    return `<span>${assetName(lang, a)} <b class="n">${fmt(lang, it?.price)}</b> <span class="n ${cls(it?.changePct ?? null)}">${pct(lang, it?.changePct)}</span></span>`;
  }).join("");
}
