// Real search phrases per language+country, harvested from Google autocomplete (scripts/harvest-keywords.mjs).
export type KwFile = Record<string, string[]>; // asset slug (or "_general") -> phrases, most popular first
const files = import.meta.glob("./keywords/*.json", { eager: true, import: "default" }) as Record<string, KwFile>;
// Inflected languages (case endings change the asset name) would show ungrammatical seed echoes, so they are skipped until a native review.
const SKIP = new Set(["ru", "uk", "pl", "cs", "el"]);
export const keywordsFor = (lang: string, cc: string): KwFile | null => (SKIP.has(lang) ? null : files[`./keywords/${lang}-${cc.toLowerCase()}.json`] ?? null);
