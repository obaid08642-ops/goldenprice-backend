// Researched, sourced local-retail data per country (see ./retail/<CC>.json and scripts/check-retail.mjs).
export interface Rule { vatJewelryPct: number | null; vatBullionPct: number | null; importDutyPct: number | null; makingPct: { typical: number } | null; barPremiumPct: Record<string, number>; barBuybackDiscountPct: { typical: number } | null; usedGoldDiscountPct: { typical: number } | null }
export interface Retail { country: string; tier: number; verifiedAt: string; confidence: "low" | "medium" | "high"; defaultKarat?: number; gold: Rule; silver: Rule; notes: string; sources: { name?: string; url: string; what: string }[] }
const files = import.meta.glob("./retail/[A-Z][A-Z].json", { eager: true, import: "default" }) as Record<string, Retail>;
const byCc: Record<string, Retail> = {};
for (const [p, d] of Object.entries(files)) byCc[p.match(/retail\/(\w\w)\.json$/)![1]] = d;
export const retailFor = (cc: string): Retail | null => byCc[cc.toUpperCase()] ?? null;
