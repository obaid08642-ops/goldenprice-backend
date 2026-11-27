// Single source of truth for every price the platform can show (used by the API and by the website build).
// sym: storage symbol · slug: URL segment · kind: precious|industrial|energy|agri|crypto|index|stock|forex
// yahoo/factor: live + history source and the factor to reach the canonical unit (USD per oz / ton / barrel / bushel / lb / gallon / coin)
// live:false -> a dedicated live feed already writes this symbol (Yahoo is used for history only) · manual:true -> no exchange feed (scraped sources or admin entry)
// tail:true -> long-tail asset: one global page per language instead of a page per country
// nativeCur: stocks and forex quote in their own currency (converted for display) · index: points, no currency
const OZ = 31.1035, LB_KG = 0.45359237;
export const U = {
  precious: (tola = false) => [{ key: "gram", f: 1 / OZ }, { key: "ounce", f: 1 }, { key: "kilo", f: 1000 / OZ }, ...(tola ? [{ key: "tola", f: 11.6638 / OZ }] : [])],
  ton: () => [{ key: "ton", f: 1 }, { key: "kilo", f: 1 / 1000 }],
  lb: () => [{ key: "lb", f: 1 }, { key: "kilo", f: 1 / LB_KG }],
  one: (key) => [{ key, f: 1 }],
};
const a = (sym, slug, kind, code, name, units, extra = {}) => ({ sym, slug, kind, code, name, units, ...extra });
const crypto = (sym, slug, code, name, yahoo, tail = true, extra = {}) => a(sym, slug, "crypto", code, name, U.one("coin"), { yahoo, tail, ...extra });
const index = (sym, slug, code, name, yahoo) => a(sym, slug, "index", code, name, U.one("point"), { yahoo, index: true });
const stock = (sym, slug, code, name, yahoo, nativeCur) => a(sym, slug, "stock", code, name, U.one("share"), { yahoo, nativeCur, tail: true });
const fx = (sym, slug, code, name, yahoo) => a(sym, slug, "forex", code, name, U.one("rate"), { yahoo, tail: true, index: true });

export const CATALOG = [
  // precious
  a("GOLD", "gold", "precious", "Au", "Gold", U.precious(true), { yahoo: "GC=F", live: false, min: 500, max: 20000, karats: [24, 22, 21, 18, 14, 12, 10] }),
  a("SILVER", "silver", "precious", "Ag", "Silver", U.precious(true), { yahoo: "SI=F", live: false, min: 5, max: 400, purities: [999, 958, 925, 900, 800] }),
  a("PLATINUM", "platinum", "precious", "Pt", "Platinum", U.precious(), { yahoo: "PL=F", min: 500, max: 3500 }),
  a("PALLADIUM", "palladium", "precious", "Pd", "Palladium", U.precious(), { yahoo: "PA=F", min: 500, max: 4000 }),
  // industrial
  a("COPPER", "copper", "industrial", "Cu", "Copper", U.ton(), { yahoo: "HG=F", factor: 2204.62, min: 5000, max: 20000 }),
  a("ALUMINUM", "aluminum", "industrial", "Al", "Aluminum", U.ton(), { yahoo: "ALI=F", min: 1500, max: 5000 }),
  a("NICKEL", "nickel", "industrial", "Ni", "Nickel", U.ton(), { manual: true, min: 8000, max: 40000 }),
  a("ZINC", "zinc", "industrial", "Zn", "Zinc", U.ton(), { manual: true, min: 1500, max: 6000 }),
  a("LEAD", "lead", "industrial", "Pb", "Lead", U.ton(), { manual: true, min: 1500, max: 4000 }),
  a("TIN", "tin", "industrial", "Sn", "Tin", U.ton(), { manual: true, min: 15000, max: 60000 }),
  a("COBALT", "cobalt", "industrial", "Co", "Cobalt", U.ton(), { manual: true, min: 15000, max: 80000 }),
  a("LITHIUM", "lithium", "industrial", "Li", "Lithium carbonate", U.ton(), { manual: true, min: 5000, max: 100000 }),
  a("URANIUM", "uranium", "industrial", "U", "Uranium", U.lb(), { manual: true, min: 30, max: 250 }),
  a("IRON", "iron-ore", "industrial", "Fe", "Iron ore", U.ton(), { manual: true, min: 50, max: 250 }),
  a("STEEL", "steel", "industrial", "St", "Steel rebar (China)", U.ton(), { manual: true, min: 300, max: 1500 }),
  a("STEELHRC", "steel-hrc", "industrial", "HRC", "Hot-rolled steel coil (US)", U.ton(), { yahoo: "HRC=F", min: 300, max: 3000, tail: true }),
  a("LUMBER", "lumber", "industrial", "LBR", "Lumber", U.one("mbf"), { yahoo: "LBR=F", min: 200, max: 2000, tail: true }),
  // energy
  a("WTI", "wti-oil", "energy", "WTI", "WTI crude oil", U.one("barrel"), { yahoo: "CL=F", min: 20, max: 250 }),
  a("BRENT", "brent-oil", "energy", "BRT", "Brent crude oil", U.one("barrel"), { yahoo: "BZ=F", min: 20, max: 250 }),
  a("NATGAS", "natural-gas", "energy", "NG", "Natural gas", U.one("mmbtu"), { yahoo: "NG=F", min: 0.5, max: 30 }),
  a("GASOLINE", "gasoline", "energy", "RB", "Gasoline", U.one("gallon"), { yahoo: "RB=F", min: 0.5, max: 8 }),
  a("HEATOIL", "heating-oil", "energy", "HO", "Heating oil", U.one("gallon"), { yahoo: "HO=F", min: 0.5, max: 8 }),
  // agriculture
  a("WHEAT", "wheat", "agri", "ZW", "Wheat", U.one("bushel"), { yahoo: "ZW=F", factor: 0.01, min: 2, max: 20 }),
  a("CORN", "corn", "agri", "ZC", "Corn", U.one("bushel"), { yahoo: "ZC=F", factor: 0.01, min: 1.5, max: 12 }),
  a("SOYBEANS", "soybeans", "agri", "ZS", "Soybeans", U.one("bushel"), { yahoo: "ZS=F", factor: 0.01, min: 5, max: 25 }),
  a("RICE", "rice", "agri", "ZR", "Rice", U.one("cwt"), { yahoo: "ZR=F", min: 5, max: 40 }),
  a("SUGAR", "sugar", "agri", "SB", "Sugar", U.lb(), { yahoo: "SB=F", factor: 0.01, min: 0.05, max: 1 }),
  a("COFFEE", "coffee", "agri", "KC", "Coffee", U.lb(), { yahoo: "KC=F", factor: 0.01, min: 0.4, max: 7 }),
  a("COCOA", "cocoa", "agri", "CC", "Cocoa", U.ton(), { yahoo: "CC=F", min: 1000, max: 20000 }),
  a("COTTON", "cotton", "agri", "CT", "Cotton", U.lb(), { yahoo: "CT=F", factor: 0.01, min: 0.3, max: 2.5 }),
  a("OATS", "oats", "agri", "ZO", "Oats", U.one("bushel"), { yahoo: "ZO=F", factor: 0.01, min: 1, max: 8, tail: true }),
  a("OJ", "orange-juice", "agri", "OJ", "Orange juice", U.lb(), { yahoo: "OJ=F", factor: 0.01, min: 0.5, max: 6, tail: true }),
  a("CATTLE", "live-cattle", "agri", "LE", "Live cattle", U.lb(), { yahoo: "LE=F", factor: 0.01, min: 0.5, max: 4, tail: true }),
  a("FEEDER", "feeder-cattle", "agri", "GF", "Feeder cattle", U.lb(), { yahoo: "GF=F", factor: 0.01, min: 0.5, max: 5, tail: true }),
  a("HOGS", "lean-hogs", "agri", "HE", "Lean hogs", U.lb(), { yahoo: "HE=F", factor: 0.01, min: 0.3, max: 2.5, tail: true }),
  a("MILK", "milk", "agri", "DC", "Milk (Class III)", U.one("cwt"), { yahoo: "DC=F", min: 8, max: 40, tail: true }),
  // crypto (top 12 get a page in every country, the rest one page per language)
  crypto("BTC", "bitcoin", "₿", "Bitcoin", "BTC-USD", false, { live: false }), crypto("ETH", "ethereum", "Ξ", "Ethereum", "ETH-USD", false, { live: false }),
  crypto("BNB", "bnb", "BNB", "BNB", "BNB-USD", false), crypto("XRP", "xrp", "XRP", "XRP", "XRP-USD", false), crypto("SOL", "solana", "SOL", "Solana", "SOL-USD", false),
  crypto("ADA", "cardano", "ADA", "Cardano", "ADA-USD", false), crypto("DOGE", "dogecoin", "Ð", "Dogecoin", "DOGE-USD", false), crypto("TRX", "tron", "TRX", "TRON", "TRX-USD", false),
  crypto("DOT", "polkadot", "DOT", "Polkadot", "DOT-USD", false), crypto("LINK", "chainlink", "LINK", "Chainlink", "LINK-USD", false), crypto("LTC", "litecoin", "Ł", "Litecoin", "LTC-USD", false),
  crypto("AVAX", "avalanche", "AVAX", "Avalanche", "AVAX-USD", false),
  crypto("SHIB", "shiba-inu", "SHIB", "Shiba Inu", "SHIB-USD"), crypto("TON", "toncoin", "TON", "Toncoin", "TON11419-USD"), crypto("BCH", "bitcoin-cash", "BCH", "Bitcoin Cash", "BCH-USD"),
  crypto("XLM", "stellar", "XLM", "Stellar", "XLM-USD"), crypto("ATOM", "cosmos", "ATOM", "Cosmos", "ATOM-USD"), crypto("ETC", "ethereum-classic", "ETC", "Ethereum Classic", "ETC-USD"),
  crypto("XMR", "monero", "XMR", "Monero", "XMR-USD"), crypto("NEAR", "near-protocol", "NEAR", "NEAR Protocol", "NEAR-USD"), crypto("UNI", "uniswap", "UNI", "Uniswap", "UNI7083-USD"),
  crypto("ICP", "internet-computer", "ICP", "Internet Computer", "ICP-USD"), crypto("APT", "aptos", "APT", "Aptos", "APT21794-USD"), crypto("FIL", "filecoin", "FIL", "Filecoin", "FIL-USD"),
  crypto("HBAR", "hedera", "HBAR", "Hedera", "HBAR-USD"), crypto("VET", "vechain", "VET", "VeChain", "VET-USD"), crypto("ALGO", "algorand", "ALGO", "Algorand", "ALGO-USD"),
  crypto("AAVE", "aave", "AAVE", "Aave", "AAVE-USD"), crypto("ARB", "arbitrum", "ARB", "Arbitrum", "ARB11841-USD"), crypto("OP", "optimism", "OP", "Optimism", "OP-USD"),
  crypto("INJ", "injective", "INJ", "Injective", "INJ-USD"), crypto("SUI", "sui", "SUI", "Sui", "SUI20947-USD"), crypto("PEPE", "pepe", "PEPE", "Pepe", "PEPE24478-USD"),
  crypto("CRO", "cronos", "CRO", "Cronos", "CRO-USD"), crypto("RUNE", "thorchain", "RUNE", "THORChain", "RUNE-USD"), crypto("SAND", "the-sandbox", "SAND", "The Sandbox", "SAND-USD"),
  crypto("MANA", "decentraland", "MANA", "Decentraland", "MANA-USD"), crypto("GRT", "the-graph", "GRT", "The Graph", "GRT6719-USD"), crypto("EGLD", "multiversx", "EGLD", "MultiversX", "EGLD-USD"),
  // stock indices
  index("SP500", "sp500", "SPX", "S&P 500", "^GSPC"), index("NASDAQ", "nasdaq", "IXIC", "Nasdaq Composite", "^IXIC"), index("DOW", "dow-jones", "DJI", "Dow Jones", "^DJI"),
  index("FTSE100", "ftse-100", "FTSE", "FTSE 100", "^FTSE"), index("DAX", "dax", "DAX", "DAX", "^GDAXI"), index("CAC40", "cac-40", "CAC", "CAC 40", "^FCHI"),
  index("NIKKEI225", "nikkei-225", "N225", "Nikkei 225", "^N225"), index("HANGSENG", "hang-seng", "HSI", "Hang Seng", "^HSI"), index("SHANGHAI", "shanghai", "SSE", "Shanghai Composite", "000001.SS"),
  index("NIFTY50", "nifty-50", "NSEI", "Nifty 50", "^NSEI"), index("SENSEX", "sensex", "BSE", "Sensex", "^BSESN"), index("EGX30", "egx30", "EGX", "EGX 30", "^CASE30"),
  index("TASI", "tasi", "TASI", "Tadawul All Share (TASI)", "^TASI.SR"), index("BIST100", "bist-100", "BIST", "BIST 100", "XU100.IS"), index("BOVESPA", "bovespa", "BVSP", "Bovespa", "^BVSP"),
  index("ASX200", "asx-200", "ASX", "ASX 200", "^AXJO"), index("TSX", "tsx", "TSX", "S&P/TSX Composite", "^GSPTSE"), index("KOSPI", "kospi", "KS11", "KOSPI", "^KS11"),
  index("EUROSTOXX50", "euro-stoxx-50", "SX5E", "Euro Stoxx 50", "^STOXX50E"),
  // global stocks (price in the listing currency)
  stock("AAPL", "apple", "AAPL", "Apple", "AAPL", "USD"), stock("MSFT", "microsoft", "MSFT", "Microsoft", "MSFT", "USD"), stock("NVDA", "nvidia", "NVDA", "NVIDIA", "NVDA", "USD"),
  stock("GOOGL", "alphabet", "GOOGL", "Alphabet (Google)", "GOOGL", "USD"), stock("AMZN", "amazon", "AMZN", "Amazon", "AMZN", "USD"), stock("META", "meta", "META", "Meta Platforms", "META", "USD"),
  stock("TSLA", "tesla", "TSLA", "Tesla", "TSLA", "USD"), stock("BRKB", "berkshire-hathaway", "BRK.B", "Berkshire Hathaway", "BRK-B", "USD"), stock("JPM", "jpmorgan", "JPM", "JPMorgan Chase", "JPM", "USD"),
  stock("VISA", "visa", "V", "Visa", "V", "USD"), stock("XOM", "exxonmobil", "XOM", "ExxonMobil", "XOM", "USD"), stock("ARAMCO", "saudi-aramco", "2222", "Saudi Aramco", "2222.SR", "SAR"),
  stock("RAJHI", "al-rajhi-bank", "1120", "Al Rajhi Bank", "1120.SR", "SAR"), stock("CIB", "cib-egypt", "COMI", "Commercial International Bank (CIB Egypt)", "COMI.CA", "EGP"),
  stock("GARAN", "garanti-bbva", "GARAN", "Garanti BBVA", "GARAN.IS", "TRY"), stock("TOYOTA", "toyota", "7203", "Toyota", "7203.T", "JPY"), stock("SAMSUNG", "samsung-electronics", "005930", "Samsung Electronics", "005930.KS", "KRW"),
  stock("TENCENT", "tencent", "0700", "Tencent", "0700.HK", "HKD"), stock("BABA", "alibaba", "BABA", "Alibaba", "BABA", "USD"), stock("TSMC", "tsmc", "TSM", "TSMC", "TSM", "USD"),
  stock("RELIANCE", "reliance-industries", "RELIANCE", "Reliance Industries", "RELIANCE.NS", "INR"), stock("ASML", "asml", "ASML", "ASML", "ASML", "USD"), stock("SAP", "sap", "SAP", "SAP", "SAP", "USD"),
  stock("NESTLE", "nestle", "NESN", "Nestlé", "NESN.SW", "CHF"), stock("LVMH", "lvmh", "MC", "LVMH", "MC.PA", "EUR"), stock("NVO", "novo-nordisk", "NVO", "Novo Nordisk", "NVO", "USD"),
  stock("PBR", "petrobras", "PBR", "Petrobras", "PBR", "USD"), stock("VALE", "vale", "VALE", "Vale", "VALE", "USD"),
  // currency pairs
  fx("EURUSD", "eur-usd", "EUR/USD", "EUR/USD", "EURUSD=X"), fx("GBPUSD", "gbp-usd", "GBP/USD", "GBP/USD", "GBPUSD=X"), fx("USDJPY", "usd-jpy", "USD/JPY", "USD/JPY", "USDJPY=X"),
  fx("USDCHF", "usd-chf", "USD/CHF", "USD/CHF", "USDCHF=X"), fx("AUDUSD", "aud-usd", "AUD/USD", "AUD/USD", "AUDUSD=X"), fx("USDCAD", "usd-cad", "USD/CAD", "USD/CAD", "USDCAD=X"),
  fx("NZDUSD", "nzd-usd", "NZD/USD", "NZD/USD", "NZDUSD=X"), fx("USDCNY", "usd-cny", "USD/CNY", "USD/CNY", "USDCNY=X"), fx("USDINR", "usd-inr", "USD/INR", "USD/INR", "USDINR=X"),
  fx("USDTRY", "usd-try", "USD/TRY", "USD/TRY", "USDTRY=X"), fx("USDEGP", "usd-egp", "USD/EGP", "USD/EGP", "USDEGP=X"), fx("USDSAR", "usd-sar", "USD/SAR", "USD/SAR", "USDSAR=X"),
  fx("EURGBP", "eur-gbp", "EUR/GBP", "EUR/GBP", "EURGBP=X"), fx("EURJPY", "eur-jpy", "EUR/JPY", "EUR/JPY", "EURJPY=X"), fx("DXY", "dollar-index", "DXY", "US Dollar Index", "DX-Y.NYB"),
];
export const BY_SYM = Object.fromEntries(CATALOG.map((c) => [c.sym, c]));
export const BY_SLUG = Object.fromEntries(CATALOG.map((c) => [c.slug, c]));
