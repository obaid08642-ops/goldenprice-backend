export function GET({ site }: { site?: URL }) {
  const base = (site?.toString() ?? "").replace(/\/$/, "");
  return new Response(`User-agent: *\nAllow: /\n\n# AI and search crawlers are welcome\nUser-agent: GPTBot\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\nUser-agent: Google-Extended\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain" } });
}
