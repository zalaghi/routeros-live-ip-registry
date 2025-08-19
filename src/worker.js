// src/worker.js
// Cloudflare Worker + Durable Objects registry for RouterOS senders.
// Endpoints:
//   POST /device/<name>   (body = IP in plain text OR form-encoded `ip=<value>`)
//   GET  /device/<name>   (returns latest IP, text/plain; no-store)

function isIPv4(s) {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

export class IpObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/ip") return new Response("not found", { status: 404 });

    if (req.method === "POST") {
      const raw = (await req.text()) || "";
      // Accept both text/plain and application/x-www-form-urlencoded
      let ip = "";
      try {
        const params = new URLSearchParams(raw);
        ip = (params.get("ip") || "").trim();
      } catch (_) { /* ignore */ }
      if (!ip) ip = raw.trim();

      // Keep only digits and dots, then validate IPv4
      ip = ip.replace(/[^\d.]/g, "");
      if (!isIPv4(ip)) return new Response("bad ip", { status: 400 });

      await this.state.storage.put("ip", ip);
      return new Response("ok", {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache",
        },
      });
    }

    if (req.method === "GET") {
      const ip = await this.state.storage.get("ip");
      if (!ip) return new Response("not set", { status: 404 });
      return new Response(ip + "\n", {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache",
        },
      });
    }

    return new Response("method not allowed", { status: 405 });
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Route: /device/<name>
    const m = url.pathname.match(/^\/device\/([A-Za-z0-9_-]+)$/);
    if (!m) return new Response("not found", { status: 404 });
    const name = m[1];

    // Auth for POST: use per-device POST_TOKEN_<NAME>, else global POST_TOKEN
    if (req.method === "POST") {
      const provided = req.headers.get("authorization") || "";
      const expected =
        env[`POST_TOKEN_${name.toUpperCase()}`] || env.POST_TOKEN || "";
      if (provided !== `Bearer ${expected}`) {
        return new Response("unauthorized", { status: 401 });
      }
    } else if (req.method !== "GET") {
      return new Response("method not allowed", { status: 405 });
    }

    // Single Durable Object instance per device name
    const id = env.IPSTATE.idFromName(name);
    const stub = env.IPSTATE.get(id);

    // Forward to DO "/ip", preserving body and content-type
    let body;
    if (req.method === "POST") body = await req.text();
    const init = {
      method: req.method,
      body,
      headers: { "content-type": req.headers.get("content-type") || "text/plain" },
    };

    const r = await stub.fetch("https://do/ip", init);
    const resp = new Response(r.body, r);
    resp.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    resp.headers.set("Pragma", "no-cache");
    return resp;
  },
};
