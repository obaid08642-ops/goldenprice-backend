import raw from "./costs.json";
// Published fuel / electricity / Big Mac figures per country (refreshed by scripts/fetch-costs.py). Only countries with a source row appear.
export interface Costs { fuel?: { cur: string; date: string; src: string; petrol95?: number; diesel?: number; lpg?: number }; electricity?: { cur: string; kwh: number; period: string; src: string }; bigmac?: { cur: string; local: number; usd: number; date: string } }
const d = raw as any;
export const costsFor = (cc: string): Costs | null => { const c: Costs = { fuel: d.fuel[cc], electricity: d.electricity[cc], bigmac: d.bigmac[cc] }; return c.fuel || c.electricity || c.bigmac ? c : null; };
export const hasCosts = (cc: string) => !!costsFor(cc);
