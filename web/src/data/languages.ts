// UI languages. Add a code here + a file entry in i18n/ui.ts to launch a new language.
export const LANGS = [
  { code: "en", native: "English", dir: "ltr" },
  { code: "ar", native: "العربية", dir: "rtl" },
  { code: "es", native: "Español", dir: "ltr" },
  { code: "fr", native: "Français", dir: "ltr" },
  { code: "de", native: "Deutsch", dir: "ltr" },
  { code: "pt", native: "Português", dir: "ltr" },
  { code: "ru", native: "Русский", dir: "ltr" },
  { code: "tr", native: "Türkçe", dir: "ltr" },
  { code: "id", native: "Bahasa Indonesia", dir: "ltr" },
  { code: "hi", native: "हिन्दी", dir: "ltr" },
  { code: "zh", native: "中文", dir: "ltr" },
  { code: "ja", native: "日本語", dir: "ltr" },
] as const;
export type Lang = (typeof LANGS)[number]["code"];
export const LANG_CODES = LANGS.map((l) => l.code) as Lang[];
export const dirOf = (l: Lang) => LANGS.find((x) => x.code === l)!.dir;
