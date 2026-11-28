import raw from "./costs.json";
import manual from "./costs-manual.json";
// Published fuel / electricity / Big Mac figures per country (refreshed by scripts/fetch-costs.py). Only countries with a source row appear.
export interface Costs { fuel?: { cur: string; date: string; src: string; petrol95?: number; diesel?: number; lpg?: number }; electricity?: { cur: string; kwh: number; period: string; src: string }; bigmac?: { cur: string; local: number; usd: number; date: string } }
const extra = import.meta.glob("./costs-extra/*.json", { eager: true, import: "default" }) as Record<string, any>;
const m: any = { ...(manual as any) };
for (const [f, v] of Object.entries(extra)) m[f.match(/\/([A-Z]{2})\.json$/)![1]] = v; // one file per country: parallel work never conflicts
const d = raw as any;
export const costsFor = (cc: string): Costs | null => { // automated official feeds (EU, Eurostat) win; costs-manual.json holds hand-checked official figures for other countries
  const c: Costs = { fuel: d.fuel[cc] ?? m[cc]?.fuel, electricity: d.electricity[cc] ?? m[cc]?.electricity, bigmac: d.bigmac[cc] }; return c.fuel || c.electricity || c.bigmac ? c : null; };
export const hasCosts = (cc: string) => !!costsFor(cc);
