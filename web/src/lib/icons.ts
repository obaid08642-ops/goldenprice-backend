// Icon resolution: a custom 3D illustration in /public/icons3d/<slug>.(webp|png) wins, then one per kind, then the built-in vector set in /public/icons-vec.
const found = Object.keys(import.meta.glob("../../public/icons3d/*.{png,webp}")).map((f) => f.split("/").pop()!);
const have = new Map(found.map((f) => [f.replace(/\.(png|webp)$/, ""), f]));
const VEC_BY_SLUG: Record<string, string> = { silver: "silver", platinum: "jewelry", palladium: "jewelry" };
const VEC_BY_KIND: Record<string, string> = { precious: "precious", industrial: "industrial", energy: "energy", agri: "agri", crypto: "crypto", index: "index", stock: "stock", forex: "forex", construction: "construction" };
export const iconFor = (a: { slug: string; kind: string }) => {
  const own = have.get(a.slug) ?? have.get(a.kind);
  return own ? `/icons3d/${own}` : `/icons-vec/${VEC_BY_SLUG[a.slug] ?? VEC_BY_KIND[a.kind] ?? "industrial"}.svg`;
};
export const iconHtml = (a: { slug: string; kind: string }) => `<i class="ic3" data-k="${a.kind}"><img src="${iconFor(a)}" alt="" width="28" height="28" loading="lazy" decoding="async"></i>`;
