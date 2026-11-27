// API clients: request + manual approval (free), payment-activated paid plans, scopes, rate limits, /v1 endpoints, admin endpoints.
// Nothing is activated without either an admin approval (free) or a verified payment webhook (paid).
import crypto from "node:crypto";
import { sql, dailyHistory } from "./db.js";
import { PLANS, KINDS, validateScopes, inScope } from "./plans.js";

const sha = (algo, secret, data) => crypto.createHmac(algo, secret).update(data).digest("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const sortKeys = (o) => (Array.isArray(o) ? o.map(sortKeys) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o);
const newKey = () => "gp_" + crypto.randomBytes(18).toString("hex");

export function mountClients({ app, okAdmin, limited, clientIp, EMAIL_RE, clean, getOverview, getRates, BY_SYM, CATALOG, sendMail }) {
  const env = process.env;
  const SITE = env.SITE_URL || "", API_PUBLIC = env.API_PUBLIC_URL || "";
  const need = (res) => (sql ? true : (res.status(503).json({ ok: false, error: "storage unavailable" }), false));

  // ---- request a free key (manual approval) ----
  app.post("/api/keys", async (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true });
    if (!need(res)) return;
    if (limited(clientIp(req), "keys", 5, 24 * 3600 * 1000)) return res.status(429).json({ ok: false, error: "too many requests" });
    const email = clean(b.email, 200);
    const scopes = (Array.isArray(b.scopes) ? b.scopes : []).map((s) => clean(s, 40));
    if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: "invalid email" });
    const bad = validateScopes("free", scopes, BY_SYM);
    if (bad) return res.status(400).json({ ok: false, error: bad });
    const token = crypto.randomBytes(16).toString("hex");
    try {
      const r = await sql`INSERT INTO api_clients (email, purpose, requested_plan, requested_scopes, scopes, status, status_token) VALUES (${email}, ${clean(b.purpose, 400)}, 'free', ${scopes}, ${scopes}, 'pending', ${token}) RETURNING id`;
      if (env.RESEND_API_KEY && env.ALERT_EMAIL) sendMail(env.ALERT_EMAIL, "New API key request", `${email}\n${clean(b.purpose, 400)}\nscopes: ${scopes.join(", ")}`).catch(() => {});
      res.json({ ok: true, id: r[0].id, statusToken: token });
    } catch { res.status(500).json({ ok: false, error: "failed" }); }
  });
  app.get("/api/keys/status", async (req, res) => {
    if (!need(res)) return;
    const id = Number(req.query.id), token = clean(req.query.token, 64);
    const r = id ? await sql`SELECT status, plan, scopes, api_key, expires_at, note FROM api_clients WHERE id = ${id} AND status_token = ${token}`.catch(() => []) : [];
    if (!r.length) return res.status(404).json({ ok: false, error: "not found" });
    const c = r[0];
    res.json({ ok: true, status: c.status, plan: c.plan, scopes: c.scopes, expiresAt: c.expires_at, note: c.status === "rejected" ? c.note : undefined, key: c.status === "approved" ? c.api_key : undefined });
  });

  // ---- admin ----
  const adm = (fn) => async (req, res) => { if (!okAdmin(req)) return res.status(401).json({ error: "unauthorized" }); if (!need(res)) return; try { await fn(req, res); } catch (e) { console.error("admin clients error", e.message || e); res.status(500).json({ error: "failed" }); } };
  app.get("/api/admin/clients", adm(async (req, res) => {
    const st = clean(req.query.status, 20);
    const rows = st && st !== "all" ? await sql`SELECT id, email, purpose, requested_plan, requested_scopes, status, plan, scopes, created_at, approved_at, expires_at, provider, note, (api_key IS NOT NULL) AS has_key FROM api_clients WHERE status = ${st} ORDER BY id DESC LIMIT 200`
      : await sql`SELECT id, email, purpose, requested_plan, requested_scopes, status, plan, scopes, created_at, approved_at, expires_at, provider, note, (api_key IS NOT NULL) AS has_key FROM api_clients ORDER BY id DESC LIMIT 200`;
    // overview for the admin: what is active, what is about to expire, expected monthly income (list prices of active paid plans)
    const act = await sql`SELECT plan, expires_at FROM api_clients WHERE status = 'approved' AND (expires_at IS NULL OR expires_at > now())`;
    const soon = Date.now() + 7 * 864e5;
    const summary = { activeFree: act.filter((a) => a.plan === "free").length, activePaid: act.filter((a) => a.plan !== "free").length,
      expiringSoon: act.filter((a) => a.plan !== "free" && a.expires_at && new Date(a.expires_at).getTime() < soon).length,
      expired: (await sql`SELECT count(*)::int AS n FROM api_clients WHERE status = 'expired' OR (status = 'approved' AND expires_at <= now())`)[0].n,
      pending: (await sql`SELECT count(*)::int AS n FROM api_clients WHERE status = 'pending'`)[0].n,
      monthlyListPriceUsd: act.reduce((t, a) => t + (PLANS[a.plan]?.price || 0), 0) };
    res.json({ clients: rows, plans: PLANS, summary });
  }));
  app.post("/api/admin/clients/:id/approve", adm(async (req, res) => {
    const id = Number(req.params.id), plan = PLANS[req.body?.plan] ? req.body.plan : "free";
    const scopes = (Array.isArray(req.body?.scopes) ? req.body.scopes : []).map((s) => clean(s, 40));
    const bad = validateScopes(plan, scopes, BY_SYM);
    if (bad) return res.status(400).json({ error: bad });
    const days = Number(req.body?.days) > 0 ? Number(req.body.days) : null;
    const r = await sql`UPDATE api_clients SET status = 'approved', plan = ${plan}, scopes = ${scopes}, approved_at = now(), expires_at = ${days ? sql`now() + (${days}::int * interval '1 day')` : null}, api_key = COALESCE(api_key, ${newKey()}) WHERE id = ${id} RETURNING email, api_key`;
    if (!r.length) return res.status(404).json({ error: "not found" });
    keyCache.clear();
    if (env.RESEND_API_KEY) sendMail(r[0].email, "Your API key is ready", `Your ${PLANS[plan].name} API key is ready. Open the developer page and check the status of your request, or use this key: ${r[0].api_key}\n`).catch(() => {});
    res.json({ ok: true, key: r[0].api_key });
  }));
  app.post("/api/admin/clients/:id/reject", adm(async (req, res) => { await sql`UPDATE api_clients SET status = 'rejected', note = ${clean(req.body?.note, 300)} WHERE id = ${Number(req.params.id)}`; keyCache.clear(); res.json({ ok: true }); }));
  app.post("/api/admin/clients/:id/disable", adm(async (req, res) => { await sql`UPDATE api_clients SET status = 'disabled', note = ${clean(req.body?.note, 300)} WHERE id = ${Number(req.params.id)}`; keyCache.clear(); res.json({ ok: true }); }));

  // ---- paid plans: checkout + verified webhooks ----
  async function activate(id, plan, until, provider, ref) {
    const r = await sql`UPDATE api_clients SET status = 'approved', plan = ${plan}, scopes = requested_scopes, approved_at = now(), expires_at = ${until}, provider = ${provider}, provider_ref = ${ref}, api_key = COALESCE(api_key, ${newKey()}) WHERE id = ${id} RETURNING email, api_key`;
    keyCache.clear();
    if (r.length && env.RESEND_API_KEY) sendMail(r[0].email, "Your API plan is active", `Thank you. Your ${PLANS[plan].name} plan is active. Open the developer page and check your request status to see your key.\n`).catch(() => {});
  }
  app.post("/api/billing/checkout", async (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true });
    if (!need(res)) return;
    if (limited(clientIp(req), "checkout", 10, 24 * 3600 * 1000)) return res.status(429).json({ ok: false, error: "too many requests" });
    const email = clean(b.email, 200), plan = clean(b.plan, 20), provider = b.provider === "crypto" ? "crypto" : "card";
    const scopes = (Array.isArray(b.scopes) ? b.scopes : []).map((s) => clean(s, 40));
    if (!EMAIL_RE.test(email) || !PLANS[plan] || plan === "free") return res.status(400).json({ ok: false, error: "invalid input" });
    const bad = validateScopes(plan, scopes, BY_SYM);
    if (bad) return res.status(400).json({ ok: false, error: bad });
    const lsReady = env.LS_API_KEY && env.LS_STORE_ID && env[`LS_VARIANT_${plan.toUpperCase()}`], npReady = env.NOWPAYMENTS_API_KEY && env.NOWPAYMENTS_IPN_SECRET;
    if ((provider === "card" && !lsReady) || (provider === "crypto" && !npReady)) return res.status(503).json({ ok: false, error: "payments are not open yet" });
    const token = crypto.randomBytes(16).toString("hex");
    try {
      const r = await sql`INSERT INTO api_clients (email, requested_plan, requested_scopes, status, status_token, provider) VALUES (${email}, ${plan}, ${scopes}, 'awaiting_payment', ${token}, ${provider}) RETURNING id`;
      const id = r[0].id;
      let url;
      if (provider === "card") {
        const j = await (await fetch("https://api.lemonsqueezy.com/v1/checkouts", { method: "POST", headers: { Authorization: `Bearer ${env.LS_API_KEY}`, "Content-Type": "application/vnd.api+json", Accept: "application/vnd.api+json" }, body: JSON.stringify({ data: { type: "checkouts", attributes: { checkout_data: { email, custom: { client_id: String(id) } }, product_options: { redirect_url: `${SITE}/en/developers/?client=${id}&token=${token}` } }, relationships: { store: { data: { type: "stores", id: String(env.LS_STORE_ID) } }, variant: { data: { type: "variants", id: String(env[`LS_VARIANT_${plan.toUpperCase()}`]) } } } } }) })).json();
        url = j?.data?.attributes?.url;
      } else {
        const j = await (await fetch("https://api.nowpayments.io/v1/invoice", { method: "POST", headers: { "x-api-key": env.NOWPAYMENTS_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ price_amount: PLANS[plan].price, price_currency: "usd", order_id: `${id}:${plan}`, order_description: `API ${PLANS[plan].name} (30 days)`, ipn_callback_url: `${API_PUBLIC}/api/billing/nowpayments`, success_url: `${SITE}/en/developers/?client=${id}&token=${token}`, cancel_url: `${SITE}/en/developers/` }) })).json();
        url = j?.invoice_url;
      }
      if (!url) throw new Error("no checkout url");
      res.json({ ok: true, url, id, statusToken: token });
    } catch (e) { console.error("checkout error", e.message || e); res.status(502).json({ ok: false, error: "could not start checkout" }); }
  });
  // Lemon Squeezy: HMAC-SHA256 of the raw body in X-Signature
  app.post("/api/billing/lemon", async (req, res) => {
    const secret = env.LS_WEBHOOK_SECRET;
    if (!secret || !req.rawBody || !safeEq(sha("sha256", secret, req.rawBody), req.headers["x-signature"] || "")) return res.status(401).end();
    if (!need(res)) return;
    try {
      const ev = req.body?.meta?.event_name, id = Number(req.body?.meta?.custom_data?.client_id), a = req.body?.data?.attributes || {};
      if (!id) return res.json({ ok: true });
      const row = (await sql`SELECT requested_plan FROM api_clients WHERE id = ${id}`)[0];
      if (!row) return res.json({ ok: true });
      if (["subscription_created", "subscription_updated", "subscription_resumed", "subscription_payment_success"].includes(ev) && ["active", "on_trial"].includes(a.status)) {
        const until = a.renews_at ? new Date(new Date(a.renews_at).getTime() + 3 * 864e5) : new Date(Date.now() + 33 * 864e5);
        await activate(id, row.requested_plan, until, "lemon", String(req.body?.data?.id || ""));
      } else if (ev === "subscription_expired") { await sql`UPDATE api_clients SET status = 'expired' WHERE id = ${id}`; keyCache.clear(); }
      else if (ev === "subscription_cancelled" && a.ends_at) { await sql`UPDATE api_clients SET expires_at = ${new Date(a.ends_at)} WHERE id = ${id}`; keyCache.clear(); }
      res.json({ ok: true });
    } catch (e) { console.error("lemon webhook", e.message || e); res.status(500).end(); }
  });
  // NOWPayments IPN: HMAC-SHA512 of the key-sorted JSON in x-nowpayments-sig
  app.post("/api/billing/nowpayments", async (req, res) => {
    const secret = env.NOWPAYMENTS_IPN_SECRET;
    if (!secret || !safeEq(sha("sha512", secret, JSON.stringify(sortKeys(req.body || {}))), req.headers["x-nowpayments-sig"] || "")) return res.status(401).end();
    if (!need(res)) return;
    try {
      const [id, plan] = String(req.body.order_id || "").split(":"), ref = String(req.body.payment_id || "");
      if (req.body.payment_status !== "finished" || !PLANS[plan] || !Number(id)) return res.json({ ok: true });
      const row = (await sql`SELECT provider_ref, expires_at FROM api_clients WHERE id = ${Number(id)}`)[0];
      if (!row || row.provider_ref === ref) return res.json({ ok: true }); // unknown client or payment already counted
      const base = row.expires_at && new Date(row.expires_at) > new Date() ? new Date(row.expires_at) : new Date();
      await activate(Number(id), plan, new Date(base.getTime() + 30 * 864e5), "crypto", ref);
      res.json({ ok: true });
    } catch (e) { console.error("nowpayments ipn", e.message || e); res.status(500).end(); }
  });

  // ---- /v1: key required, scopes and limits enforced ----
  const keyCache = new Map(), minute = new Map(), day = new Map();
  setInterval(() => { const d = new Date().toISOString().slice(0, 10); for (const k of day.keys()) if (!k.endsWith(d)) day.delete(k); for (const [k, v] of minute) if (!v.length || Date.now() - v[v.length - 1] > 120000) minute.delete(k); }, 3600 * 1000);
  async function requireKey(req, res, next) {
    const key = String(req.headers["x-api-key"] || req.query.key || "");
    if (!/^gp_[0-9a-f]{36}$/.test(key)) return res.status(401).json({ error: "missing or invalid x-api-key" });
    let c = keyCache.get(key);
    if (!c || Date.now() - c.t > 60000) {
      const r = sql ? await sql`SELECT id, plan, scopes, status, expires_at FROM api_clients WHERE api_key = ${key}`.catch(() => []) : [];
      c = { t: Date.now(), row: r[0] || null }; keyCache.set(key, c);
    }
    const row = c.row;
    if (!row || row.status !== "approved" || (row.expires_at && new Date(row.expires_at) < new Date())) return res.status(401).json({ error: "key not active (pending, expired or disabled)" });
    const p = PLANS[row.plan] || PLANS.free, now0 = Date.now();
    const m = (minute.get(key) || []).filter((t) => now0 - t < 60000);
    if (m.length >= p.perMin) { minute.set(key, m); return res.status(429).json({ error: `rate limit: ${p.perMin} requests per minute on the ${p.name} plan` }); }
    m.push(now0); minute.set(key, m);
    const dk = `${key}:${new Date().toISOString().slice(0, 10)}`, n = (day.get(dk) || 0) + 1; day.set(dk, n);
    if (n > p.daily) return res.status(429).json({ error: `daily limit of ${p.daily} requests reached on the ${p.name} plan` });
    res.set({ "X-Plan": p.name, "X-RateLimit-Limit-Day": String(p.daily), "X-RateLimit-Remaining-Day": String(p.daily - n), "Cache-Control": `private, max-age=${p.freshnessSec}` });
    req.apiClient = { ...row, p, used: n };
    next();
  }
  app.get("/v1/overview", requireKey, async (req, res) => {
    const body = await getOverview(), items = {};
    for (const [sym, v] of Object.entries(body.items)) if (BY_SYM[sym] && inScope(req.apiClient.scopes, BY_SYM[sym])) items[sym] = v;
    res.json({ updated: body.updated, plan: req.apiClient.plan, items });
  });
  app.get("/v1/chart/:sym", requireKey, async (req, res) => {
    const sym = String(req.params.sym).toUpperCase(), c = BY_SYM[sym];
    if (!c) return res.status(404).json({ error: "unknown symbol" });
    if (!inScope(req.apiClient.scopes, c)) return res.status(403).json({ error: "symbol not included in your key scope" });
    const days = Math.min(3650, Math.max(1, Number(req.query.days) || 365)), maxPts = Math.min(1500, Number(req.query.points) || 400);
    let rows = (await dailyHistory(sym, days)) || [];
    if (rows.length > maxPts) { const step = rows.length / maxPts; rows = rows.filter((_, i) => Math.floor(i % step) === 0 || i === rows.length - 1); }
    res.json({ symbol: sym, kind: c.kind, data: rows.map(({ date, value, open, high, low }) => ({ date, value, open, high, low })) });
  });
  app.get("/v1/rates", requireKey, (req, res) => { const r = getRates(); r.updated ? res.json(r) : res.status(503).json({ error: "rates not ready" }); });
  app.get("/v1/symbols", requireKey, (req, res) => res.json({ symbols: CATALOG.map((c) => ({ symbol: c.sym, name: c.name, kind: c.kind, inScope: inScope(req.apiClient.scopes, c) })) }));
  app.get("/v1/usage", requireKey, (req, res) => res.json({ plan: req.apiClient.plan, scopes: req.apiClient.scopes, usedToday: req.apiClient.used, dailyLimit: req.apiClient.p.daily, perMinute: req.apiClient.p.perMin, expiresAt: req.apiClient.expires_at }));
  app.get("/v1/plans", (req, res) => res.json({ plans: PLANS, categories: KINDS, providers: { card: !!(env.LS_API_KEY && env.LS_STORE_ID), crypto: !!(env.NOWPAYMENTS_API_KEY && env.NOWPAYMENTS_IPN_SECRET) } }));
}
