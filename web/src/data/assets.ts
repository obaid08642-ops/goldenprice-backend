// The asset list comes from the backend catalog (single source of truth, ../../../catalog.js).
import { CATALOG } from "../../../catalog.js";
export type Kind = "precious" | "industrial" | "energy" | "agri" | "crypto" | "stock" | "index" | "forex";
export interface Unit { key: string; f: number } // price per unit = canonical USD price x f
export interface Asset { slug: string; sym: string; kind: Kind; code: string; name: string; units: Unit[]; karats?: number[]; purities?: number[]; tail: boolean; nativeCur?: string }
export const ASSETS: Asset[] = (CATALOG as any[]).map((c) => ({ slug: c.slug, sym: c.sym, kind: c.kind, code: c.code, name: c.name, units: c.units, karats: c.karats, purities: c.purities, tail: !!c.tail, nativeCur: c.nativeCur }));
export const CORE = ASSETS.filter((a) => !a.tail);
export const TAIL = ASSETS.filter((a) => a.tail);
export const assetBySlug = (s: string) => ASSETS.find((a) => a.slug === s)!;
export const KINDS: Kind[] = ["precious", "industrial", "energy", "agri", "crypto", "stock", "index", "forex"];
export const CONSTRUCTION = ["iron-ore", "steel", "steel-hrc", "lumber", "aluminum", "copper"];
export const TROY_OZ_G = 31.1035;
export const unitsFor = (a: Asset, tola?: boolean) => a.units.filter((u) => u.key !== "tola" || tola).map((u) => u.key);
export const perUnit = (a: Asset, usd: number, unit: string) => usd * (a.units.find((u) => u.key === unit)?.f ?? 1);
/** true when the quote is converted into the visitor's currency (indices are points, currency pairs are rates) */
export const hasFx = (a: Asset) => a.kind !== "index" && a.kind !== "forex";
