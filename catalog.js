// Asset catalog: every price the site can show. `yahoo` feeds live updates and the 5y history backfill.
// factor: multiply the Yahoo value to reach the canonical unit (USD per oz / ton / barrel / bushel / lb / gallon / coin; indices stay in points).
// live:false -> a dedicated live feed already writes this symbol (spot sources), Yahoo is used for history only.
// manual:true -> no free live source; the admin enters the price by hand.
export const CATALOG = [
  { sym: "GOLD", yahoo: "GC=F", live: false, min: 500, max: 20000 }, { sym: "SILVER", yahoo: "SI=F", live: false, min: 5, max: 400 },
  { sym: "PLATINUM", yahoo: "PL=F", min: 500, max: 3500 }, { sym: "PALLADIUM", yahoo: "PA=F", min: 500, max: 4000 },
  { sym: "COPPER", yahoo: "HG=F", factor: 2204.62, min: 5000, max: 20000 }, { sym: "ALUMINUM", yahoo: "ALI=F", min: 1500, max: 5000 },
  { sym: "NICKEL", manual: true, min: 8000, max: 40000 }, { sym: "ZINC", manual: true, min: 1500, max: 6000 }, { sym: "LEAD", manual: true, min: 1500, max: 4000 },
  { sym: "TIN", manual: true, min: 15000, max: 60000 }, { sym: "COBALT", manual: true, min: 15000, max: 80000 }, { sym: "LITHIUM", manual: true, min: 5000, max: 100000 },
  { sym: "URANIUM", manual: true, min: 30, max: 250 }, { sym: "IRON", manual: true, min: 50, max: 250 }, { sym: "STEEL", manual: true, min: 300, max: 1500 },
  { sym: "WTI", yahoo: "CL=F", min: 20, max: 250 }, { sym: "BRENT", yahoo: "BZ=F", min: 20, max: 250 }, { sym: "NATGAS", yahoo: "NG=F", min: 0.5, max: 30 },
  { sym: "GASOLINE", yahoo: "RB=F", min: 0.5, max: 8 }, { sym: "HEATOIL", yahoo: "HO=F", min: 0.5, max: 8 },
  { sym: "WHEAT", yahoo: "ZW=F", factor: 0.01, min: 2, max: 20 }, { sym: "CORN", yahoo: "ZC=F", factor: 0.01, min: 1.5, max: 12 }, { sym: "SOYBEANS", yahoo: "ZS=F", factor: 0.01, min: 5, max: 25 },
  { sym: "RICE", yahoo: "ZR=F", min: 5, max: 40 }, { sym: "SUGAR", yahoo: "SB=F", factor: 0.01, min: 0.05, max: 1 }, { sym: "COFFEE", yahoo: "KC=F", factor: 0.01, min: 0.4, max: 7 },
  { sym: "COCOA", yahoo: "CC=F", min: 1000, max: 20000 }, { sym: "COTTON", yahoo: "CT=F", factor: 0.01, min: 0.3, max: 2.5 },
  { sym: "BTC", yahoo: "BTC-USD", live: false }, { sym: "ETH", yahoo: "ETH-USD", live: false },
  { sym: "BNB", yahoo: "BNB-USD" }, { sym: "XRP", yahoo: "XRP-USD" }, { sym: "SOL", yahoo: "SOL-USD" }, { sym: "ADA", yahoo: "ADA-USD" }, { sym: "DOGE", yahoo: "DOGE-USD" },
  { sym: "TRX", yahoo: "TRX-USD" }, { sym: "DOT", yahoo: "DOT-USD" }, { sym: "LINK", yahoo: "LINK-USD" }, { sym: "LTC", yahoo: "LTC-USD" }, { sym: "AVAX", yahoo: "AVAX-USD" },
  { sym: "SP500", yahoo: "^GSPC", index: true }, { sym: "NASDAQ", yahoo: "^IXIC", index: true }, { sym: "DOW", yahoo: "^DJI", index: true }, { sym: "FTSE100", yahoo: "^FTSE", index: true },
  { sym: "DAX", yahoo: "^GDAXI", index: true }, { sym: "CAC40", yahoo: "^FCHI", index: true }, { sym: "NIKKEI225", yahoo: "^N225", index: true }, { sym: "HANGSENG", yahoo: "^HSI", index: true },
  { sym: "SHANGHAI", yahoo: "000001.SS", index: true }, { sym: "NIFTY50", yahoo: "^NSEI", index: true }, { sym: "SENSEX", yahoo: "^BSESN", index: true }, { sym: "EGX30", yahoo: "^CASE30", index: true },
  { sym: "TASI", yahoo: "^TASI.SR", index: true }, { sym: "BIST100", yahoo: "XU100.IS", index: true }, { sym: "BOVESPA", yahoo: "^BVSP", index: true }, { sym: "ASX200", yahoo: "^AXJO", index: true },
  { sym: "TSX", yahoo: "^GSPTSE", index: true }, { sym: "KOSPI", yahoo: "^KS11", index: true }, { sym: "EUROSTOXX50", yahoo: "^STOXX50E", index: true },
];
export const BY_SYM = Object.fromEntries(CATALOG.map((c) => [c.sym, c]));
