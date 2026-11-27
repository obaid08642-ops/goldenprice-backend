// Build-time data for the first paint (SEO). The browser refreshes everything live after load.
export const API = (import.meta.env.PUBLIC_API_URL as string) || "https://goldenprice-backend.onrender.com";
export interface OverviewItem { price: number | null; changePct: number | null; spark: number[]; stale?: boolean; t?: number | null }
export interface Data { items: Record<string, OverviewItem>; rates: Record<string, number>; live: boolean }
const FALLBACK: Data = {
  live: false,
  rates: { USD: 1, EUR: 0.91, GBP: 0.79, SAR: 3.75, AED: 3.6725, EGP: 54.8, TRY: 34.1, INR: 83.4, CNY: 7.24, JPY: 151, RUB: 92, BRL: 5.4, KWD: 0.307, QAR: 3.64, BHD: 0.376, OMR: 0.385, JOD: 0.709, IQD: 1310, MAD: 9.9, DZD: 134, TND: 3.1, CAD: 1.38, AUD: 1.53, UAH: 41, PKR: 278, IDR: 15800, MYR: 4.5, MXN: 18.5, ARS: 1000, NGN: 1550, ZAR: 18.2 },
  items: Object.fromEntries(
    Object.entries({ GOLD: 3629, SILVER: 43.09, PLATINUM: 1328, PALLADIUM: 908, COPPER: 12488, ALUMINUM: 2819, WTI: 85.7, BRENT: 92.2, NATGAS: 3.6, BTC: 96250, ETH: 3400 }).map(([k, v]) => [k, { price: v, changePct: null, spark: [] }]),
  ),
};
async function j(path: string) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(API + path, { signal: AbortSignal.timeout(60000) });
      if (r.ok) return await r.json();
    } catch {}
  }
  return null;
}
let cached: Promise<Data> | null = null;
export function getData(): Promise<Data> {
  return (cached ??= (async () => {
    const [o, r] = await Promise.all([j("/api/overview"), j("/api/rates")]);
    if (!o?.items || !r?.rates) { console.warn("[web] backend unreachable at build, using fallback sample data"); return FALLBACK; }
    return { items: o.items, rates: r.rates, live: true };
  })());
}
