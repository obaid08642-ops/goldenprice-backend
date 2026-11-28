// Browser side: live prices, unit switch, chart, converter, calculators, search, geo suggestion.
// The page is already complete HTML without this script (first paint = build-time data).
import { ASSETS, perUnit, TROY_OZ_G } from "../data/assets";
import { COUNTRIES } from "../data/countries";
import { registerDict } from "../i18n/ui";
import { fmt } from "../lib/format";
import { renderBars, renderCurrencies, renderHero, renderMarkets, renderMarketsAll, renderRates, renderSide, renderStats, renderTicker, renderUsed, local, type Ctx } from "../lib/render";
import type { Data } from "../lib/api";

const page = document.getElementById("page");
if (page) {
  const boot = JSON.parse(page.dataset.boot || "{}");
  const country = COUNTRIES.find((x) => x.code === boot.cc)!;
  const asset = ASSETS.find((x) => x.slug === boot.slug)!;
  let unit: string = boot.unit;
  let days = 30;
  let data: Data | null = null;
  let updatedAt = 0;
  const $ = (id: string) => document.getElementById(id);
  const ctx = (): Ctx => ({ lang: boot.lang, country, asset, unit, data: data!, retail: boot.retail });
  const num = (id: string) => parseFloat(($(id) as HTMLInputElement)?.value || "0") || 0;

  async function loadDicts() {
    for (const l of new Set(["en", boot.lang])) {
      try { registerDict(l, await fetch(`/i18n-data/${l}.json`).then((r) => r.json())); } catch { /* keep server-rendered text */ }
    }
  }

  function paint() {
    if (!data) return;
    const c = ctx();
    $("ticker")!.innerHTML = renderTicker(c);
    if (boot.view === "asset") {
      $("hero")!.innerHTML = renderHero(c);
      if ($("side")) $("side")!.innerHTML = renderSide(c);
      if ($("stats")) $("stats")!.innerHTML = renderStats(c);
      if ($("currencies")) $("currencies")!.innerHTML = renderCurrencies(c);
      if ($("markets")) $("markets")!.innerHTML = renderMarkets(c);
      if ($("bars")) $("bars")!.innerHTML = renderBars(c);
      if ($("used")) $("used")!.innerHTML = renderUsed(c);
    }
    if ($("markets-all")) $("markets-all")!.innerHTML = renderMarketsAll(c);
    if ($("rates-table")) { $("rates-table")!.innerHTML = renderRates(c); convert(); }
    if ($("calc")) calc();
    if (boot.view === "compare") compare();
    const chip = page!.querySelector("[data-updated]");
    if (chip && updatedAt) chip.textContent = boot.ui.updated.replace("{t}", new Date(updatedAt).toLocaleTimeString(boot.lang, { hour: "2-digit", minute: "2-digit" }));
  }

  async function load() {
    try {
      const [o, r] = await Promise.all([fetch(`${boot.api}/api/overview`).then((x) => x.json()), fetch(`${boot.api}/api/rates`).then((x) => x.json())]);
      if (o?.items && r?.rates) { data = { items: o.items, rates: r.rates, live: true }; updatedAt = o.updated || Date.now(); paint(); drawChart(); }
    } catch { /* keep the server-rendered numbers */ }
  }

  // ---- converter (rates page) ----
  function convert() {
    const out = $("cv-out");
    if (!out || !data) return;
    const from = ($("cv-from") as HTMLSelectElement).value, to = ($("cv-to") as HTMLSelectElement).value, amt = num("cv-amount");
    const v = (amt / (data.rates[from] || 1)) * (data.rates[to] || 1);
    out.textContent = boot.ui.conv_result.replace("{amount}", fmt(boot.lang, amt)).replace("{from}", from).replace("{value}", fmt(boot.lang, v)).replace("{to}", to);
  }
  // ---- calculators ----
  function calc() {
    const box = $("calc");
    if (!box) return;
    const b = num("roi-b"), q = num("roi-q"), n = num("roi-n");
    if ($("roi-p")) { $("roi-p")!.textContent = fmt(boot.lang, (n - b) * q); $("roi-r")!.textContent = b ? `${fmt(boot.lang, ((n - b) / b) * 100)}%` : "—"; }
    if ($("un-out")) { $("un-out")!.textContent = fmt(boot.lang, (num("un-v") * parseFloat(($("un-f") as HTMLSelectElement).value)) / parseFloat(($("un-t") as HTMLSelectElement).value)); }
    if (!data) return;
    const rate = data.rates[country.cur] ?? 1;
    const gold = data.items.GOLD?.price, silver = data.items.SILVER?.price;
    if (gold != null) {
      const unitsG: Record<string, number> = { gram: 1, ounce: TROY_OZ_G, kilo: 1000, tola: 11.6638 };
      const grams = num("gc-w") * (unitsG[($("gc-u") as HTMLSelectElement).value] ?? 1);
      const k = parseFloat(($("gc-k") as HTMLSelectElement).value);
      $("gc-out")!.textContent = `${fmt(boot.lang, (gold / TROY_OZ_G) * rate * grams * (k / 24))} ${country.cur}`;
      $("zk-ng")!.textContent = `${fmt(boot.lang, (gold / TROY_OZ_G) * rate * 85)} ${country.cur}`;
    }
    if (silver != null) $("zk-ns")!.textContent = `${fmt(boot.lang, (silver / TROY_OZ_G) * rate * 595)} ${country.cur}`;
    if (gold != null && silver != null) {
      const gv = (gold / TROY_OZ_G) * rate * num("zk-g"), sv = (silver / TROY_OZ_G) * rate * num("zk-s");
      const nisabG = (gold / TROY_OZ_G) * rate * 85, nisabS = (silver / TROY_OZ_G) * rate * 595;
      const total = gv + sv;
      // nisab is the lower of the two thresholds (silver) when mixing; gold only uses the gold threshold
      const nisab = num("zk-g") > 0 && num("zk-s") === 0 ? nisabG : num("zk-s") > 0 && num("zk-g") === 0 ? nisabS : Math.min(nisabG, nisabS);
      $("zk-out")!.textContent = total >= nisab && total > 0 ? `${fmt(boot.lang, total * 0.025)} ${country.cur}` : boot.ui.zakat_below;
    }
  }

  // ---- chart ----
  let plain = false; // plain = ratio chart (no currency label)
  let series: { x: number; v: number }[] = [];
  async function drawChart() {
    const box = $("chart");
    if (!box || !data) return;
    if (boot.view === "compare") return compare();
    const rate = hasFxLocal() ? data.rates[country.cur] ?? 1 : 1;
    try {
      let rows: { x: number; v: number }[];
      if (days === 1) {
        const j = await fetch(`${boot.api}/api/ticks/${asset.sym}?hours=24`).then((x) => x.json());
        rows = (j.data || []).map((d: any) => ({ x: new Date(d.ts).getTime(), v: d.value }));
      } else {
        const j = await fetch(`${boot.api}/api/chart/${asset.sym}?days=${days}&points=300${hasFxLocal() ? "&cur=" + country.cur : ""}`).then((x) => x.json());
        rows = (j.data || []).map((d: any) => ({ x: new Date(d.date).getTime(), v: d.value, fx: d.fx }));
      }
      series = rows.map((r: any) => ({ x: r.x, v: hasFxLocal() ? perUnit(asset, r.v, unit) * (r.fx ?? rate) : r.v }));
    } catch { series = []; }
    render(box);
  }
  const hasFxLocal = () => asset.kind !== "index" && asset.kind !== "forex";
  function render(box: HTMLElement) {
    if (series.length < 2) { box.innerHTML = ""; return; }
    const W = 700, H = 240, P = 6;
    const xs = series.map((s) => s.x), vs = series.map((s) => s.v);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), mn = Math.min(...vs), mx = Math.max(...vs);
    const X = (x: number) => P + ((W - 2 * P) * (x - x0)) / (x1 - x0 || 1);
    const Y = (v: number) => H - 22 - ((H - 22 - P) * (v - mn)) / (mx - mn || 1);
    const d = series.map((s, i) => `${i ? "L" : "M"}${X(s.x).toFixed(1)} ${Y(s.v).toFixed(1)}`).join("");
    const lab = (x: number) => new Date(x).toLocaleDateString(boot.lang, days <= 1 ? { hour: "2-digit", minute: "2-digit" } : { month: "short", year: days > 90 ? "numeric" : undefined, day: days <= 90 ? "numeric" : undefined });
    const unitTxt = !plain && hasFxLocal() ? country.cur : "";
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"><defs><linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
<path d="${d} L${X(x1)} ${H - 22} L${X(x0)} ${H - 22}Z" fill="url(#gf)"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
<line id="cl" y1="0" y2="${H - 22}" stroke="currentColor" stroke-opacity=".4" style="display:none" vector-effect="non-scaling-stroke"/></svg>
<div class="tip" id="tip"></div>
<div class="k n" style="display:flex;justify-content:space-between;margin-top:2px"><span>${lab(x0)}</span><span>${fmt(boot.lang, mn)} – ${fmt(boot.lang, mx)} ${unitTxt}</span><span>${lab(x1)}</span></div>`;
    const svg = box.querySelector("svg")!, tip = $("tip")!, cl = box.querySelector("#cl") as SVGLineElement;
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const i = Math.round(fx * (series.length - 1)), s = series[i];
      cl.setAttribute("x1", String(X(s.x))); cl.setAttribute("x2", String(X(s.x))); cl.style.display = "";
      tip.style.display = "block"; tip.style.left = `${fx * r.width}px`;
      tip.textContent = `${new Date(s.x).toLocaleDateString(boot.lang)} · ${fmt(boot.lang, s.v)} ${unitTxt}`;
    });
    svg.addEventListener("pointerleave", () => { tip.style.display = "none"; cl.style.display = "none"; });
  }

  // ---- compare two assets: ratio over time ----
  async function compare() {
    const box = $("chart");
    if (!box || !data) return;
    const sa = boot.assets.find((x: any) => x.slug === ($("cmp-a") as HTMLSelectElement).value), sb = boot.assets.find((x: any) => x.slug === ($("cmp-b") as HTMLSelectElement).value);
    if (!sa || !sb) return;
    const pa = data.items[sa.sym]?.price, pb = data.items[sb.sym]?.price;
    $("cmp-now")!.textContent = pa && pb ? fmt(boot.lang, pa / pb) : "—";
    try {
      const [ja, jb] = await Promise.all([sa.sym, sb.sym].map((s) => fetch(`${boot.api}/api/chart/${s}?days=${days}&points=300`).then((x) => x.json())));
      const mb = new Map<string, number>((jb.data || []).map((d: any) => [d.date, d.value]));
      series = (ja.data || []).filter((d: any) => mb.has(d.date)).map((d: any) => ({ x: new Date(d.date).getTime(), v: d.value / mb.get(d.date)! }));
    } catch { series = []; }
    plain = true; render(box);
  }

  // ---- price alert ----
  $("alert-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement, msg = $("alert-msg")!;
    const fd = Object.fromEntries(new FormData(f)) as Record<string, string>;
    msg.className = "msg"; msg.textContent = "…";
    try {
      if (!data) throw new Error("no data");
      const c = ctx(), loc = local(c, asset, unit), usd = data.items[asset.sym]?.price;
      const factor = loc && usd ? loc / usd : 1; // display price per canonical price
      const r = await fetch(`${boot.api}/api/alerts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: fd.email, sym: asset.sym, dir: fd.dir, target: Number(fd.target) / factor, label: `${fd.target} ${hasFxLocal() ? country.cur : ""}`.trim(), lang: boot.lang, website: fd.website }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "failed");
      msg.className = "msg ok"; msg.textContent = (document.querySelector("[data-alert-ok]") as HTMLElement)?.dataset.alertOk || "OK"; f.reset();
    } catch { msg.className = "msg err"; msg.textContent = (document.querySelector("[data-alert-err]") as HTMLElement)?.dataset.alertErr || "Error"; }
  });

  // ---- controls ----
  page.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    if (b.dataset.unit) { unit = b.dataset.unit; paint(); drawChart(); }
    if (b.dataset.days) { days = +b.dataset.days; $("ranges")!.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); drawChart(); }
  });
  page.addEventListener("change", (e) => { if (((e.target as HTMLElement).id || "").startsWith("cmp-")) compare(); });
  page.addEventListener("input", (e) => {
    const id = (e.target as HTMLElement).id;
    if (id.startsWith("cv-")) convert();
    if (id.startsWith("gc-") || id.startsWith("zk-") || id.startsWith("roi-") || id.startsWith("un-")) calc();
    if (id.startsWith("cmp-")) compare();
  });
  $("search")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = ($("q") as HTMLInputElement).value.trim().toLowerCase();
    if (!q) return;
    const a = boot.assets.find((x: any) => q.includes(x.name.toLowerCase()) || q.includes(x.en.toLowerCase()) || x.name.toLowerCase().includes(q));
    const c = boot.countries.find((x: any) => q.includes(x.name.toLowerCase()) || q.includes(x.cur.toLowerCase()));
    const slug = a ? (a.slug === "gold" ? "" : a.slug + "/") : "markets/";
    const base = c ? `/${c.lang}/${c.code.toLowerCase()}/` : `/${boot.lang}/${boot.cc.toLowerCase()}/`;
    location.href = base + slug;
  });

  // ---- geo suggestion (never a forced redirect, so search engines and users keep the page they asked for) ----
  (async () => {
    try {
      if (localStorage.getItem("geo-dismissed") || localStorage.getItem("pref")) return;
      const txt = await fetch("/cdn-cgi/trace").then((r) => r.text());
      const loc = /loc=([A-Z]{2})/.exec(txt)?.[1];
      const target = boot.countries.find((x: any) => x.code === loc);
      if (!target || target.code === boot.cc) return;
      $("geo-text")!.textContent = boot.ui.geo_ask.replace("{country}", target.name).replace("{cur}", target.cur);
      $("geo-yes")!.textContent = boot.ui.geo_yes; $("geo-no")!.textContent = boot.ui.geo_no;
      $("geo")!.classList.add("show");
      $("geo-yes")!.onclick = () => { localStorage.setItem("pref", JSON.stringify({ path: target.href })); location.href = target.href; };
      $("geo-no")!.onclick = () => { localStorage.setItem("geo-dismissed", "1"); $("geo")!.classList.remove("show"); };
    } catch { /* not on Cloudflare (local dev): no suggestion */ }
  })();

  convert(); calc();
  loadDicts().then(load);
  setInterval(load, 60_000);
}
