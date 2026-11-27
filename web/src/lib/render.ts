// Pure HTML renderers used at build time (first paint for SEO) and again in the browser (live updates).
import { ASSETS, CONSTRUCTION, KINDS, hasFx, perUnit, unitsFor, type Asset } from "../data/assets";
import { TOP_CURRENCIES, type Country } from "../data/countries";
import type { Lang } from "../data/languages";
import { iconHtml } from "./icons";
import type { Retail } from "../data/retail";
import { assetLabel, contentOf, t } from "../i18n/ui";
import { countryName, currencyName, fmt, pct } from "./format";
import { assetUrl } from "./paths";
import type { Data } from "./api";

export interface Ctx { lang: Lang; country: Country; asset: Asset; unit: string; data: Data; retail: Retail | null }
const UNIT_KEY: Record<string, string> = { gram: "u_gram", ounce: "u_ounce", kilo: "u_kilo", tola: "u_tola", ton: "u_ton", lb: "u_lb", share: "u_share", rate: "u_rate", mbf: "u_mbf", barrel: "u_barrel", mmbtu: "u_mmbtu", gallon: "u_gallon", bushel: "u_bushel", cwt: "u_cwt", coin: "u_coin", point: "u_point" };
export const assetName = (lang: Lang, a: Asset) => assetLabel(lang, a.slug, a.name);
export const unitLabel = (lang: Lang, unit: string) => t(lang, UNIT_KEY[unit] ?? "u_coin");
export const defaultUnit = (a: Asset) => a.units[0].key;
export const hasPrice = (data: Data, a: Asset) => data.items[a.sym]?.price != null;
const rateOf = (c: Ctx) => c.data.rates[c.country.cur] ?? 1;
/** price of asset `a` in the page currency per `unit` (indices stay in points) */
export function local(c: Ctx, a: Asset, unit: string): number | null {
  const u = c.data.items[a.sym]?.price;
  if (u == null) return null;
  if (!hasFx(a)) return u;
  // stocks are quoted in their listing currency: convert through the USD rates
  if (a.nativeCur) { const r = c.data.rates; return r[a.nativeCur] ? (u / r[a.nativeCur]) * rateOf(c) : null; }
  return perUnit(a, u, unit) * rateOf(c);
}
const cls = (v: number | null | undefined) => (v == null ? "" : v >= 0 ? "up" : "dn");
const arrow = (v: number | null | undefined) => (v == null ? "" : v >= 0 ? "▲ " : "▼ ");
const curLabel = (c: Ctx, a = c.asset) => (a.kind === "forex" ? "" : hasFx(a) ? c.country.cur : t(c.lang, "u_point"));

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
    ? `<div class="seg" role="group">${units.map((u) => `<button type="button" data-unit="${u}" class="${u === unit ? "on" : ""}">${unitLabel(lang, u)}</button>`).join("")}</div>` : "";
  const usd = it?.price;
  const ref = asset.nativeCur && usd ? `<span class="chip n">${asset.nativeCur} ${fmt(lang, usd)}</span>` : asset.kind === "precious" && usd ? `<span class="chip n">${t(lang, "u_ounce")} · $${fmt(lang, usd)}</span>` : usd && hasFx(asset) && country.cur !== "USD" ? `<span class="chip n">USD $${fmt(lang, usd)}</span>` : "";
  const per = hasFx(asset) && !asset.nativeCur ? ` · ${t(lang, "per", { u: unitLabel(lang, unit) })}` : "";
  return `<div class="hh"><div class="k">${assetName(lang, asset)}${per} · ${countryName(lang, country.code)}</div>${seg}</div>
<div class="p n" data-price>${fmt(lang, price)}<small>${curLabel(c)}</small></div>
<div class="chips"><span class="chip n ${cls(it?.changePct)}">${arrow(it?.changePct)}${pct(lang, it?.changePct)} ${t(lang, "today")}</span>${ref}<span class="chip k" data-updated></span></div>`;
}

const gramsOf = (k: string) => parseFloat(k);
// Local retail data is shown only when it is at least medium confidence (several sources); low-confidence files stay as research notes.
const usable = (r: Retail | null): r is Retail => !!r && r.confidence !== "low";
export function renderBars(c: Ctx) {
  const { lang, country, asset, retail } = c;
  const rule = usable(retail) && (asset.sym === "GOLD" ? retail.gold : asset.sym === "SILVER" ? retail.silver : null);
  const g = local(c, asset, "gram");
  if (!rule || g == null) return "";
  const sizes = Object.entries(rule.barPremiumPct).sort((a, b) => gramsOf(a[0]) - gramsOf(b[0]));
  if (sizes.length < 3) return "";
  const bb = rule.barBuybackDiscountPct?.typical;
  const rows = sizes.map(([k, prem]) => {
    const gr = gramsOf(k);
    return `<tr><td>${gr === 31.1 ? "1 " + t(lang, "u_ounce") : k.replace("g", " " + t(lang, "u_gram"))}</td><td class="n">${fmt(lang, g * gr * (1 + prem / 100))}</td><td class="n">${bb != null ? fmt(lang, g * gr * (1 - bb / 100)) : "—"}</td><td class="n">+${fmt(lang, prem, 1)}%</td></tr>`;
  }).join("");
  return `<section class="card"><h2>${t(lang, "bars_title", { a: assetName(lang, asset), cur: country.cur })}</h2><div class="tbl"><table><thead><tr><th>${t(lang, "bar_size")}</th><th>${t(lang, "bar_buy")}</th><th>${t(lang, "bar_sell")}</th><th>${t(lang, "bar_prem")}</th></tr></thead><tbody>${rows}</tbody></table></div><div class="k small">${t(lang, "bars_note")} ${t(lang, "retail_basis", { n: retail!.sources.length, d: retail!.verifiedAt })}</div></section>`;
}

export function renderUsed(c: Ctx) {
  const { lang, country, asset, retail } = c;
  if (asset.sym !== "GOLD" || !usable(retail) || !retail.gold.usedGoldDiscountPct) return "";
  const g = local(c, asset, "gram");
  if (g == null) return "";
  const d = retail.gold.usedGoldDiscountPct.typical;
  const rows = [24, 22, 21, 18, 14].map((k) => `<tr><td>${k}K</td><td class="n">${fmt(lang, g * (k / 24))}</td><td class="n">${fmt(lang, g * (k / 24) * (1 - d / 100))}</td></tr>`).join("");
  return `<section class="card"><h2>${t(lang, "used_title", { a: assetName(lang, asset), cur: country.cur })}</h2><div class="tbl"><table><thead><tr><th>${t(lang, "karat")}</th><th>${t(lang, "price")}</th><th>${t(lang, "used_col")}</th></tr></thead><tbody>${rows}</tbody></table></div><div class="k small">${t(lang, "used_note")}</div></section>`;
}

export function renderSide(c: Ctx) {
  const { lang, country, asset, retail } = c;
  const name = assetName(lang, asset);
  let out = "";
  const rule = usable(retail) && (asset.sym === "GOLD" ? retail.gold : asset.sym === "SILVER" ? retail.silver : null);
  if (rule && rule.makingPct) {
    const g = local(c, asset, "gram");
    if (g != null) {
      const karat = asset.sym === "GOLD" ? retail!.defaultKarat ?? 21 : 0;
      const purity = asset.sym === "GOLD" ? karat / 24 : 0.925;
      const glob = g * purity, making = glob * (1 + rule.makingPct.typical / 100), est = making * (1 + (rule.vatJewelryPct ?? 0) / 100);
      out += `<div class="card"><div class="k">${t(lang, "global_vs_local")} · ${asset.sym === "GOLD" ? karat + "K" : "925"}</div>
<div class="kv"><div><span class="k">${t(lang, "global_price")}</span><b class="n">${fmt(lang, glob)}</b></div><div><span class="k">${t(lang, "local_estimate")}</span><b class="n">${fmt(lang, making)}</b></div></div>
<div class="est"><span class="k">${t(lang, "est_retail")}</span><div><b class="n">${fmt(lang, est)} ${country.cur}</b></div></div><div class="k small">${t(lang, "est_note")} ${t(lang, "retail_basis", { n: retail!.sources.length, d: retail!.verifiedAt })}</div></div>`;
    }
  }
  if (asset.karats || asset.purities) {
    const rows = (asset.karats ?? asset.purities!).map((k) => {
      const f = asset.karats ? k / 24 : k / 1000;
      return `<div class="row"><span>${asset.karats ? k + "K" : k}</span><span class="k n">${asset.karats ? ((k / 24) * 100).toFixed(1) + "%" : ""}</span><b class="n">${fmt(lang, (local(c, asset, "gram") ?? 0) * f)}</b></div>`;
    }).join("");
    out += `<div class="card"><div class="k">${asset.karats ? t(lang, "karat_title", { a: name }) : `${name} · ${t(lang, "purity")}`} · ${country.cur}/${t(lang, "u_gram")}</div>${rows}</div>`;
  } else if (hasFx(asset)) {
    const units = unitsFor(asset, country.tola);
    out += `<div class="card"><div class="k">${name} · ${country.cur}</div>${units.map((u) => `<div class="row"><span>${t(lang, "per", { u: unitLabel(lang, u) })}</span><b class="n">${fmt(lang, local(c, asset, u))}</b></div>`).join("")}</div>`;
  }
  return out;
}

export function renderCurrencies(c: Ctx) {
  const { lang, asset, data } = c;
  if (!hasFx(asset)) return "";
  const it = data.items[asset.sym];
  const usd = it?.price;
  const second = asset.kind === "precious" ? "gram" : null;
  const rows = TOP_CURRENCIES.slice(0, 12).map((cur) => {
    const r = data.rates[cur] ?? 1;
    const a = usd != null ? usd * r : null;
    const b = usd != null && second ? perUnit(asset, usd, second) * r : null;
    return `<tr><td>${currencyName(lang, cur)} <span class="k">${cur}</span></td><td class="n">${fmt(lang, a)}</td>${second ? `<td class="n">${fmt(lang, b)}</td>` : ""}<td class="n ${cls(it?.changePct)}">${pct(lang, it?.changePct)}</td></tr>`;
  }).join("");
  const h1 = asset.kind === "precious" ? t(lang, "col_ounce") : t(lang, "price");
  return `<table><thead><tr><th></th><th>${h1}</th>${second ? `<th>${t(lang, "col_gram")}</th>` : ""}<th>${t(lang, "col_24h")}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function marketRows(c: Ctx, list: Asset[]) {
  const { lang, country, data } = c;
  return list.map((a) => {
    const it = data.items[a.sym];
    const up = (it?.changePct ?? 0) >= 0;
    return `<tr><td><a class="as" href="${assetUrl(lang, country.code, a)}">${iconHtml(a)}${assetName(lang, a)}</a></td><td class="n">${fmt(lang, local(c, a, defaultUnit(a)))}</td><td class="n ${cls(it?.changePct)}">${pct(lang, it?.changePct)}</td><td>${spark(it?.spark ?? [], up)}</td></tr>`;
  }).join("");
}
/** compact table of the most important assets (sidebar on asset pages) */
export function renderMarkets(c: Ctx) {
  const { lang, country, data } = c;
  const list = ASSETS.filter((a) => !a.tail && hasPrice(data, a)).slice(0, 12);
  return `<table class="mk"><thead><tr><th></th><th>${country.cur}</th><th>${t(lang, "col_24h")}</th><th>${t(lang, "col_7d")}</th></tr></thead><tbody>${marketRows(c, list)}</tbody></table>`;
}
/** full markets page: one table per category */
export function renderMarketsAll(c: Ctx, tailOnly = false) {
  const { lang, country, data } = c;
  const groups: [string, Asset[]][] = [...KINDS.map((k): [string, Asset[]] => [k, ASSETS.filter((a) => a.kind === k && a.tail === tailOnly && hasPrice(data, a))]), ...(tailOnly ? [] : [["construction", ASSETS.filter((a) => CONSTRUCTION.includes(a.slug) && hasPrice(data, a))] as [string, Asset[]]])];
  return groups.map(([k, list]) => {
    if (!list.length) return "";
    return `<section class="card"><h2>${t(lang, "cat_" + k)}</h2><div class="tbl"><table class="mk"><thead><tr><th></th><th>${list[0].kind === "forex" ? t(lang, "u_rate") : hasFx(list[0]) ? country.cur : t(lang, "u_point")}</th><th>${t(lang, "col_24h")}</th><th>${t(lang, "col_7d")}</th></tr></thead><tbody>${marketRows(c, list)}</tbody></table></div></section>`;
  }).join("");
}

export function renderTicker(c: Ctx) {
  const { lang, data } = c;
  const keys = ["GOLD", "SILVER", "PLATINUM", "COPPER", "BRENT", "BTC", "ETH", "SP500"];
  return ASSETS.filter((a) => keys.includes(a.sym) && hasPrice(data, a)).map((a) => {
    const it = data.items[a.sym];
    return `<span>${assetName(lang, a)} <b class="n">${fmt(lang, it?.price)}</b> <span class="n ${cls(it?.changePct)}">${pct(lang, it?.changePct)}</span></span>`;
  }).join("");
}

/** exchange rates against the page currency: "1 X = Y local" */
export function renderRates(c: Ctx) {
  const { lang, country, data } = c;
  const local1 = data.rates[country.cur] ?? 1;
  const rows = TOP_CURRENCIES.filter((x) => x !== country.cur && data.rates[x]).map((cur) => `<tr><td>${currencyName(lang, cur)} <span class="k">${cur}</span></td><td class="n">1 ${cur} = ${fmt(lang, local1 / data.rates[cur])} ${country.cur}</td><td class="n">1 ${country.cur} = ${fmt(lang, data.rates[cur] / local1)} ${cur}</td></tr>`).join("");
  return `<table><thead><tr><th></th><th>${cur(country)}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}
const cur = (c: Country) => c.cur;

const rangeBar = (v: number, lo: number, hi: number) => `<div class="rbar"><i style="inset-inline-start:${Math.max(0, Math.min(100, ((v - lo) / (hi - lo || 1)) * 100)).toFixed(1)}%"></i></div>`;
/** performance over periods + 52-week range + highest/lowest in our data */
export function renderStats(c: Ctx) {
  const { lang, country, asset, data } = c;
  const it = data.items[asset.sym];
  if (!it?.perf && it?.hi52 == null) return "";
  const conv = (x: number | null | undefined) => (x == null ? null : hasFx(asset) ? (asset.nativeCur ? (data.rates[asset.nativeCur] ? (x / data.rates[asset.nativeCur]) * (data.rates[country.cur] ?? 1) : null) : perUnit(asset, x, c.unit) * (data.rates[country.cur] ?? 1)) : x);
  const p = it.perf;
  const rows = p ? ([["p_7d", p.d7], ["p_30d", p.d30], ["p_90d", p.d90], ["p_ytd", p.ytd], ["p_1y", p.y1], ["p_5y", p.y5]] as const).filter(([, v]) => v != null).map(([k, v]) => `<div class="row"><span>${t(lang, k)}</span><b class="n ${cls(v)}">${pct(lang, v)}</b></div>`).join("") : "";
  const price = local(c, asset, c.unit), lo = conv(it.lo52), hi = conv(it.hi52);
  const range = price != null && lo != null && hi != null ? `<div class="k" style="margin-top:12px">${t(lang, "range52")}</div>${rangeBar(price, lo, hi)}<div class="row"><span class="n">${fmt(lang, lo)}</span><span class="n">${fmt(lang, hi)}</span></div>` : "";
  const ext = it.ath != null && it.atl != null && conv(it.ath) != null ? `<div class="row"><span>${t(lang, "ath")}${it.athDay ? ` · ${it.athDay}` : ""}</span><b class="n">${fmt(lang, conv(it.ath))}</b></div><div class="row"><span>${t(lang, "atl")}${it.atlDay ? ` · ${it.atlDay}` : ""}</span><b class="n">${fmt(lang, conv(it.atl))}</b></div>` : "";
  const since = it.since ? `<div class="k small">${t(lang, "since", { d: it.since })} ${t(lang, "history_note")}</div>` : "";
  return `<h2>${t(lang, "perf_title")}</h2>${rows}${range}${ext}${since}`;
}

const TEMPLATE: Record<string, string> = { stock: "about_stock", forex: "about_forex", crypto: "about_crypto", index: "about_index" };
/** about / what moves the price / uses: real text for the core assets, kind templates for the long tail */
export function renderContent(c: Ctx) {
  const { lang, asset } = c;
  const name = assetName(lang, asset);
  const ct = contentOf(lang, asset.slug);
  const about = ct?.about ?? t(lang, TEMPLATE[asset.kind] ?? "about_commodity", { a: name, c: asset.nativeCur ?? "USD" });
  const list = (items?: string[]) => (items?.length ? `<ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>` : "");
  return `<h2>${t(lang, "about_title", { a: name })}</h2><p>${about}</p>${ct?.drivers ? `<h3>${t(lang, "drivers_title")}</h3>${list(ct.drivers)}` : ""}${ct?.uses ? `<h3>${t(lang, "uses_title")}</h3>${list(ct.uses)}` : ""}`;
}
