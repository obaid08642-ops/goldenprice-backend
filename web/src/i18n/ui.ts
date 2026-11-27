import type { Lang } from "../data/languages";
export interface Dict { ui: Record<string, string>; assets: Record<string, string>; kw: Record<string, string>; legal: Record<string, string[]> }
const dicts: Record<string, Dict> = {};
export const registerDict = (lang: string, d: Dict) => { dicts[lang] = d; };
export const hasDict = (lang: string) => !!dicts[lang];
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? ""));
export const t = (lang: Lang, k: string, v: Record<string, string | number> = {}) => fill(dicts[lang]?.ui[k] ?? dicts.en?.ui[k] ?? k, v);
export const assetLabel = (lang: Lang, slug: string) => dicts[lang]?.assets[slug] ?? dicts.en?.assets[slug] ?? slug;
export const kwOf = (lang: Lang, k: string) => dicts[lang]?.kw[k] ?? dicts.en?.kw[k] ?? k;
export const legalOf = (lang: Lang, page: string, site: string) => (dicts[lang]?.legal[page] ?? dicts.en?.legal[page] ?? []).map((p) => fill(p, { site }));
