// UI languages (each has a translated dictionary in i18n/lang/<code>.json). RTL: ar, fa, ur, he.
export const LANGS = [
  { code: "en", native: "English", dir: "ltr", bcp: "en" }, { code: "ar", native: "العربية", dir: "rtl", bcp: "ar" },
  { code: "es", native: "Español", dir: "ltr", bcp: "es" }, { code: "fr", native: "Français", dir: "ltr", bcp: "fr" },
  { code: "de", native: "Deutsch", dir: "ltr", bcp: "de" }, { code: "pt", native: "Português", dir: "ltr", bcp: "pt" },
  { code: "ru", native: "Русский", dir: "ltr", bcp: "ru" }, { code: "tr", native: "Türkçe", dir: "ltr", bcp: "tr" },
  { code: "id", native: "Bahasa Indonesia", dir: "ltr", bcp: "id" }, { code: "hi", native: "हिन्दी", dir: "ltr", bcp: "hi" },
  { code: "zh", native: "简体中文", dir: "ltr", bcp: "zh-CN" }, { code: "zh-tw", native: "繁體中文", dir: "ltr", bcp: "zh-TW" },
  { code: "ja", native: "日本語", dir: "ltr", bcp: "ja" }, { code: "ko", native: "한국어", dir: "ltr", bcp: "ko" },
  { code: "vi", native: "Tiếng Việt", dir: "ltr", bcp: "vi" }, { code: "th", native: "ไทย", dir: "ltr", bcp: "th" },
  { code: "it", native: "Italiano", dir: "ltr", bcp: "it" }, { code: "nl", native: "Nederlands", dir: "ltr", bcp: "nl" },
  { code: "pl", native: "Polski", dir: "ltr", bcp: "pl" }, { code: "ro", native: "Română", dir: "ltr", bcp: "ro" },
  { code: "el", native: "Ελληνικά", dir: "ltr", bcp: "el" }, { code: "cs", native: "Čeština", dir: "ltr", bcp: "cs" },
  { code: "hu", native: "Magyar", dir: "ltr", bcp: "hu" }, { code: "sv", native: "Svenska", dir: "ltr", bcp: "sv" },
  { code: "uk", native: "Українська", dir: "ltr", bcp: "uk" }, { code: "bn", native: "বাংলা", dir: "ltr", bcp: "bn" },
  { code: "ur", native: "اردو", dir: "rtl", bcp: "ur" }, { code: "fa", native: "فارسی", dir: "rtl", bcp: "fa" },
  { code: "ms", native: "Bahasa Melayu", dir: "ltr", bcp: "ms" }, { code: "sw", native: "Kiswahili", dir: "ltr", bcp: "sw" },
  { code: "he", native: "עברית", dir: "rtl", bcp: "he" },
  { code: "sr", native: "Srpski", dir: "ltr", bcp: "sr-Latn" },
  { code: "bg", native: "Български", dir: "ltr", bcp: "bg" },
  { code: "hr", native: "Hrvatski", dir: "ltr", bcp: "hr" },
  { code: "sk", native: "Slovenčina", dir: "ltr", bcp: "sk" },
  { code: "da", native: "Dansk", dir: "ltr", bcp: "da" },
  { code: "no", native: "Norsk", dir: "ltr", bcp: "nb" },
  { code: "fi", native: "Suomi", dir: "ltr", bcp: "fi" },
  { code: "az", native: "Azərbaycanca", dir: "ltr", bcp: "az" },
  { code: "ka", native: "ქართული", dir: "ltr", bcp: "ka" },
  { code: "hy", native: "Հայերեն", dir: "ltr", bcp: "hy" },
  { code: "uz", native: "Oʻzbekcha", dir: "ltr", bcp: "uz" },
  { code: "ne", native: "नेपाली", dir: "ltr", bcp: "ne" },
  { code: "si", native: "සිංහල", dir: "ltr", bcp: "si" },
  { code: "fil", native: "Filipino", dir: "ltr", bcp: "fil" },
] as const;
export type Lang = (typeof LANGS)[number]["code"];
export const LANG_CODES = LANGS.map((l) => l.code) as Lang[];
export const dirOf = (l: Lang) => LANGS.find((x) => x.code === l)!.dir;
export const bcpOf = (l: Lang) => LANGS.find((x) => x.code === l)!.bcp;
