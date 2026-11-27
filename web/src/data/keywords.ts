// Real search phrases per language+country, harvested from Google autocomplete (scripts/harvest-keywords.mjs).
export type KwFile = Record<string, string[]>; // asset slug (or "_general") -> phrases, most popular first
const files = import.meta.glob("./keywords/*.json", { eager: true, import: "default" }) as Record<string, KwFile>;
export const keywordsFor = (lang: string, cc: string): KwFile | null => files[`./keywords/${lang}-${cc.toLowerCase()}.json`] ?? null;
