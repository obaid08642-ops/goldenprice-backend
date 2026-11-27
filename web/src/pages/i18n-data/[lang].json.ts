// Per-language dictionary served as a small static JSON for the browser script.
import { LANG_CODES } from "../../data/languages";
const files = import.meta.glob("../../i18n/lang/*.json", { eager: true, import: "default" }) as Record<string, unknown>;
export function getStaticPaths() { return LANG_CODES.map((lang) => ({ params: { lang } })); }
export function GET({ params }: { params: { lang: string } }) {
  const d = Object.entries(files).find(([p]) => p.endsWith(`/${params.lang}.json`))?.[1];
  return new Response(JSON.stringify(d ?? {}), { headers: { "Content-Type": "application/json" } });
}
