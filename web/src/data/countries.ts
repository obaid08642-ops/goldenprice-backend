import type { Lang } from "./languages";
// Wave 1: the largest, most search-heavy markets. `langs[0]` is the country's main language; English is always added.
// retail: ASSUMPTIONS for the "estimated local retail" card (extra % over the converted global price, typical making charge %).
// They are estimates, not quotes; edit here (or move to the DB/admin later). Leave `retail` out to hide the card.
export interface Country { code: string; cur: string; langs: Lang[]; retail?: { premium: number; making: number; karat: number }; tola?: boolean }
export const COUNTRIES: Country[] = [
  { code: "EG", cur: "EGP", langs: ["ar"], retail: { premium: 0.03, making: 0.03, karat: 21 } },
  { code: "SA", cur: "SAR", langs: ["ar"], retail: { premium: 0.02, making: 0.04, karat: 21 } },
  { code: "AE", cur: "AED", langs: ["ar"], retail: { premium: 0.05, making: 0.04, karat: 21 } },
  { code: "KW", cur: "KWD", langs: ["ar"] },
  { code: "QA", cur: "QAR", langs: ["ar"] },
  { code: "BH", cur: "BHD", langs: ["ar"] },
  { code: "OM", cur: "OMR", langs: ["ar"] },
  { code: "JO", cur: "JOD", langs: ["ar"] },
  { code: "IQ", cur: "IQD", langs: ["ar"] },
  { code: "MA", cur: "MAD", langs: ["ar", "fr"] },
  { code: "DZ", cur: "DZD", langs: ["ar", "fr"] },
  { code: "TN", cur: "TND", langs: ["ar", "fr"] },
  { code: "US", cur: "USD", langs: [] },
  { code: "GB", cur: "GBP", langs: [] },
  { code: "CA", cur: "CAD", langs: ["fr"] },
  { code: "AU", cur: "AUD", langs: [] },
  { code: "DE", cur: "EUR", langs: ["de"] },
  { code: "FR", cur: "EUR", langs: ["fr"] },
  { code: "ES", cur: "EUR", langs: ["es"] },
  { code: "IT", cur: "EUR", langs: [] },
  { code: "TR", cur: "TRY", langs: ["tr"] },
  { code: "RU", cur: "RUB", langs: ["ru"] },
  { code: "UA", cur: "UAH", langs: ["ru"] },
  { code: "CN", cur: "CNY", langs: ["zh"] },
  { code: "JP", cur: "JPY", langs: ["ja"] },
  { code: "IN", cur: "INR", langs: ["hi"], tola: true, retail: { premium: 0.09, making: 0.08, karat: 22 } },
  { code: "PK", cur: "PKR", langs: [], tola: true },
  { code: "ID", cur: "IDR", langs: ["id"] },
  { code: "MY", cur: "MYR", langs: [] },
  { code: "BR", cur: "BRL", langs: ["pt"] },
  { code: "MX", cur: "MXN", langs: ["es"] },
  { code: "AR", cur: "ARS", langs: ["es"] },
  { code: "NG", cur: "NGN", langs: [] },
  { code: "ZA", cur: "ZAR", langs: [] },
];
export const countryByCode = (c: string) => COUNTRIES.find((x) => x.code === c.toUpperCase());
export const langsFor = (c: Country): Lang[] => Array.from(new Set<Lang>([...c.langs, "en"]));
// Currencies shown in the "price in other currencies" table.
export const TOP_CURRENCIES = ["USD", "EUR", "GBP", "SAR", "AED", "EGP", "TRY", "INR", "CNY", "JPY", "RUB", "BRL"];
