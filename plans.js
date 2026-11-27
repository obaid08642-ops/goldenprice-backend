// API plans. Prices are the proposal shown on the site; the real price is whatever you set in the payment provider (variant/product).
// freshness = how old a price can be at most (our feeds refresh every 1-15 minutes depending on the asset; no plan gets tick data).
export const PLANS = {
  free: { name: "Free", price: 0, daily: 200, perMin: 10, maxSymbols: 5, freshnessSec: 300, approval: "manual" },
  starter: { name: "Starter", price: 9, daily: 5000, perMin: 60, maxKinds: 1, freshnessSec: 60, approval: "payment" },
  pro: { name: "Pro", price: 29, daily: 50000, perMin: 300, maxKinds: 99, freshnessSec: 30, approval: "payment" },
  business: { name: "Business", price: 99, daily: 500000, perMin: 1000, maxKinds: 99, freshnessSec: 15, approval: "payment" },
};
export const KINDS = ["precious", "industrial", "energy", "agri", "crypto", "stock", "index", "forex"];
/** scopes: ["all"] | ["kind:crypto", ...] | ["sym:GOLD", ...]; returns null when valid or an error string */
export function validateScopes(plan, scopes, bySym) {
  const p = PLANS[plan];
  if (!p || !Array.isArray(scopes) || !scopes.length || scopes.length > 60) return "choose what you need";
  let kinds = 0, syms = 0;
  for (const s of scopes) {
    if (s === "all") { if (plan === "free" || plan === "starter") return "all assets needs the Pro or Business plan"; continue; }
    if (s.startsWith("kind:")) { if (!KINDS.includes(s.slice(5))) return `unknown category ${s}`; kinds++; continue; }
    if (s.startsWith("sym:")) { if (!bySym[s.slice(4)]) return `unknown asset ${s}`; syms++; continue; }
    return `bad scope ${s}`;
  }
  if (plan === "free" && (kinds > 1 || syms > p.maxSymbols || (kinds && syms))) return `Free: pick one category or up to ${p.maxSymbols} assets`;
  if (plan === "starter" && (kinds > p.maxKinds || syms > 25)) return "Starter: one category or up to 25 assets";
  return null;
}
export const inScope = (scopes, c) => scopes.includes("all") || scopes.includes(`kind:${c.kind}`) || scopes.includes(`sym:${c.sym}`);
