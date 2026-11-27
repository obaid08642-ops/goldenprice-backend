export type Kind = "precious" | "industrial" | "energy" | "crypto";
export interface Asset { slug: string; sym: string; kind: Kind; code: string; purities?: number[]; karats?: number[] }
// Canonical units: precious = USD per troy ounce, industrial = USD per metric ton, energy = USD per barrel / MMBtu, crypto = USD per coin.
export const ASSETS: Asset[] = [
  { slug: "gold", sym: "GOLD", kind: "precious", code: "Au", karats: [24, 22, 21, 18, 14, 12, 10] },
  { slug: "silver", sym: "SILVER", kind: "precious", code: "Ag", purities: [999, 958, 925, 900, 800] },
  { slug: "platinum", sym: "PLATINUM", kind: "precious", code: "Pt" },
  { slug: "palladium", sym: "PALLADIUM", kind: "precious", code: "Pd" },
  { slug: "copper", sym: "COPPER", kind: "industrial", code: "Cu" },
  { slug: "aluminum", sym: "ALUMINUM", kind: "industrial", code: "Al" },
  { slug: "wti-oil", sym: "WTI", kind: "energy", code: "WTI" },
  { slug: "brent-oil", sym: "BRENT", kind: "energy", code: "BRT" },
  { slug: "natural-gas", sym: "NATGAS", kind: "energy", code: "NG" },
  { slug: "bitcoin", sym: "BTC", kind: "crypto", code: "₿" },
  { slug: "ethereum", sym: "ETH", kind: "crypto", code: "Ξ" },
];
export const assetBySlug = (s: string) => ASSETS.find((a) => a.slug === s)!;
export const TROY_OZ_G = 31.1035;
export const TOLA_G = 11.6638;
export const unitsFor = (a: Asset, tola?: boolean) =>
  a.kind === "precious" ? (tola ? ["gram", "ounce", "kilo", "tola"] : ["gram", "ounce", "kilo"])
  : a.kind === "industrial" ? ["ton", "kilo"] : a.kind === "energy" ? ["unit"] : ["coin"];
// price (USD) per canonical unit -> USD per requested unit
export function perUnit(a: Asset, usd: number, unit: string): number {
  switch (unit) {
    case "gram": return usd / TROY_OZ_G;
    case "kilo": return a.kind === "industrial" ? usd / 1000 : (usd / TROY_OZ_G) * 1000;
    case "tola": return (usd / TROY_OZ_G) * TOLA_G;
    default: return usd;
  }
}
