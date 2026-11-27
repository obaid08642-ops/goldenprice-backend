export type Kind = "precious" | "industrial" | "energy" | "agri" | "crypto" | "index";
export interface Unit { key: string; f: number } // price per unit = canonical USD price x f
export interface Asset { slug: string; sym: string; kind: Kind; code: string; units: Unit[]; karats?: number[]; purities?: number[] }
const OZ = 31.1035, LB_KG = 0.45359237;
const precious = (extra: Unit[] = []): Unit[] => [{ key: "gram", f: 1 / OZ }, { key: "ounce", f: 1 }, { key: "kilo", f: 1000 / OZ }, ...extra];
const ton = (): Unit[] => [{ key: "ton", f: 1 }, { key: "kilo", f: 1 / 1000 }];
const lb = (): Unit[] => [{ key: "lb", f: 1 }, { key: "kilo", f: 1 / LB_KG }];
const one = (key: string): Unit[] => [{ key, f: 1 }];
export const ASSETS: Asset[] = [
  { slug: "gold", sym: "GOLD", kind: "precious", code: "Au", units: precious([{ key: "tola", f: 11.6638 / OZ }]), karats: [24, 22, 21, 18, 14, 12, 10] },
  { slug: "silver", sym: "SILVER", kind: "precious", code: "Ag", units: precious([{ key: "tola", f: 11.6638 / OZ }]), purities: [999, 958, 925, 900, 800] },
  { slug: "platinum", sym: "PLATINUM", kind: "precious", code: "Pt", units: precious() },
  { slug: "palladium", sym: "PALLADIUM", kind: "precious", code: "Pd", units: precious() },
  { slug: "copper", sym: "COPPER", kind: "industrial", code: "Cu", units: ton() },
  { slug: "aluminum", sym: "ALUMINUM", kind: "industrial", code: "Al", units: ton() },
  { slug: "nickel", sym: "NICKEL", kind: "industrial", code: "Ni", units: ton() },
  { slug: "zinc", sym: "ZINC", kind: "industrial", code: "Zn", units: ton() },
  { slug: "lead", sym: "LEAD", kind: "industrial", code: "Pb", units: ton() },
  { slug: "tin", sym: "TIN", kind: "industrial", code: "Sn", units: ton() },
  { slug: "cobalt", sym: "COBALT", kind: "industrial", code: "Co", units: ton() },
  { slug: "lithium", sym: "LITHIUM", kind: "industrial", code: "Li", units: ton() },
  { slug: "uranium", sym: "URANIUM", kind: "industrial", code: "U", units: lb() },
  { slug: "iron-ore", sym: "IRON", kind: "industrial", code: "Fe", units: ton() },
  { slug: "steel", sym: "STEEL", kind: "industrial", code: "St", units: ton() },
  { slug: "wti-oil", sym: "WTI", kind: "energy", code: "WTI", units: one("barrel") },
  { slug: "brent-oil", sym: "BRENT", kind: "energy", code: "BRT", units: one("barrel") },
  { slug: "natural-gas", sym: "NATGAS", kind: "energy", code: "NG", units: one("mmbtu") },
  { slug: "gasoline", sym: "GASOLINE", kind: "energy", code: "RB", units: one("gallon") },
  { slug: "heating-oil", sym: "HEATOIL", kind: "energy", code: "HO", units: one("gallon") },
  { slug: "wheat", sym: "WHEAT", kind: "agri", code: "ZW", units: one("bushel") },
  { slug: "corn", sym: "CORN", kind: "agri", code: "ZC", units: one("bushel") },
  { slug: "soybeans", sym: "SOYBEANS", kind: "agri", code: "ZS", units: one("bushel") },
  { slug: "rice", sym: "RICE", kind: "agri", code: "ZR", units: one("cwt") },
  { slug: "sugar", sym: "SUGAR", kind: "agri", code: "SB", units: lb() },
  { slug: "coffee", sym: "COFFEE", kind: "agri", code: "KC", units: lb() },
  { slug: "cocoa", sym: "COCOA", kind: "agri", code: "CC", units: ton() },
  { slug: "cotton", sym: "COTTON", kind: "agri", code: "CT", units: lb() },
  ...([["bitcoin", "BTC", "₿"], ["ethereum", "ETH", "Ξ"], ["bnb", "BNB", "BNB"], ["xrp", "XRP", "XRP"], ["solana", "SOL", "SOL"], ["cardano", "ADA", "ADA"], ["dogecoin", "DOGE", "Ð"], ["tron", "TRX", "TRX"], ["polkadot", "DOT", "DOT"], ["chainlink", "LINK", "LINK"], ["litecoin", "LTC", "Ł"], ["avalanche", "AVAX", "AVAX"]] as const).map(([slug, sym, code]): Asset => ({ slug, sym, kind: "crypto", code, units: one("coin") })),
  ...([["sp500", "SP500", "SPX"], ["nasdaq", "NASDAQ", "IXIC"], ["dow-jones", "DOW", "DJI"], ["ftse-100", "FTSE100", "FTSE"], ["dax", "DAX", "DAX"], ["cac-40", "CAC40", "CAC"], ["nikkei-225", "NIKKEI225", "N225"], ["hang-seng", "HANGSENG", "HSI"], ["shanghai", "SHANGHAI", "SSE"], ["nifty-50", "NIFTY50", "NSEI"], ["sensex", "SENSEX", "BSE"], ["egx30", "EGX30", "EGX"], ["tasi", "TASI", "TASI"], ["bist-100", "BIST100", "BIST"], ["bovespa", "BOVESPA", "BVSP"], ["asx-200", "ASX200", "ASX"], ["tsx", "TSX", "TSX"], ["kospi", "KOSPI", "KS11"], ["euro-stoxx-50", "EUROSTOXX50", "SX5E"]] as const).map(([slug, sym, code]): Asset => ({ slug, sym, kind: "index", code, units: one("point") })),
];
export const assetBySlug = (s: string) => ASSETS.find((a) => a.slug === s)!;
export const KINDS: Kind[] = ["precious", "industrial", "energy", "agri", "crypto", "index"];
export const TROY_OZ_G = OZ;
export const unitsFor = (a: Asset, tola?: boolean) => a.units.filter((u) => u.key !== "tola" || tola).map((u) => u.key);
export const perUnit = (a: Asset, usd: number, unit: string) => usd * (a.units.find((u) => u.key === unit)?.f ?? 1);
export const hasFx = (a: Asset) => a.kind !== "index"; // indices are quoted in points, not converted
