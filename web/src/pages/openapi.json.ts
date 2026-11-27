import { CATALOG } from "../../../catalog.js";
const api = (import.meta.env.PUBLIC_API_URL as string) || "https://goldenprice-backend.onrender.com";
// OpenAPI 3 description of the public /v1 API (keeps docs, SDK generators and search engines in sync with the code).
export function GET() {
  const key = [{ ApiKey: [] }];
  const spec = {
    openapi: "3.0.3",
    info: { title: "Price API: gold, metals, energy, crops, crypto, stocks, indices, currencies", version: "1.0.0", description: "Live and historical prices. Free and paid plans; request a key on the developer page." },
    servers: [{ url: api }],
    components: { securitySchemes: { ApiKey: { type: "apiKey", in: "header", name: "x-api-key" } } },
    security: key,
    paths: {
      "/v1/overview": { get: { summary: "Latest prices, daily change, performance and ranges for every asset in your scope", responses: { "200": { description: "OK" }, "401": { description: "Missing or inactive key" }, "429": { description: "Rate limit" } } } },
      "/v1/chart/{symbol}": { get: { summary: "Daily history for one symbol", parameters: [{ name: "symbol", in: "path", required: true, schema: { type: "string", enum: (CATALOG as any[]).map((c) => c.sym) } }, { name: "days", in: "query", schema: { type: "integer", default: 365, maximum: 3650 } }, { name: "points", in: "query", schema: { type: "integer", default: 400, maximum: 1500 } }], responses: { "200": { description: "OK" }, "403": { description: "Symbol not in your key scope" } } } },
      "/v1/rates": { get: { summary: "Currency rates against USD (166 currencies)", responses: { "200": { description: "OK" } } } },
      "/v1/symbols": { get: { summary: "All symbols and whether your key covers them", responses: { "200": { description: "OK" } } } },
      "/v1/usage": { get: { summary: "Your plan, scope and usage today", responses: { "200": { description: "OK" } } } },
      "/v1/plans": { get: { summary: "Plans and limits (no key needed)", security: [], responses: { "200": { description: "OK" } } } },
    },
  };
  return new Response(JSON.stringify(spec, null, 1), { headers: { "Content-Type": "application/json" } });
}
