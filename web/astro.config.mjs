import { defineConfig } from "astro/config";
// SITE is the production domain (set it in Cloudflare Pages env vars once the domain is chosen).
export default defineConfig({
  site: process.env.SITE || "https://example.com",
  output: "static",
  trailingSlash: "always",
  build: { inlineStylesheets: "auto" },
  vite: { server: { fs: { allow: [".."] } } }, // the asset catalog lives one level up (../catalog.js)
});
