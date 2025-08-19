// One Durable Object class per device instance: stores a single IPv4 string
export class IpObject {
constructor(state, env) { this.state = state; }


async fetch(req) {
const url = new URL(req.url);
if (url.pathname !== "/ip") return new Response("not found", { status: 404 });


if (req.method === "POST") {
const ip = (await req.text()).trim();
if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return new Response("bad ip", { status: 400 });
await this.state.storage.put("ip", ip);
return new Response("ok");
}


if (req.method === "GET") {
const ip = await this.state.storage.get("ip");
if (!ip) return new Response("not set", { status: 404 });
return new Response(ip + "\n", {
headers: {
"Content-Type": "text/plain",
"Cache-Control": "no-store, no-cache, must-revalidate",
"Pragma": "no-cache"
}
});
}


return new Response("method not allowed", { status: 405 });
}
}


export default {
async fetch(req, env) {
const url = new URL(req.url);


// Routes: /device/<name>
const m = url.pathname.match(/^\/device\/([A-Za-z0-9_-]+)$/);
if (!m) return new Response("not found", { status: 404 });
const name = m[1];


// Auth: POSTs require a token. Prefer per-device secret POST_TOKEN_<NAME>, else POST_TOKEN.
if (req.method === "POST") {
const auth = req.headers.get("authorization") || "";
const desired = env[`POST_TOKEN_${name.toUpperCase()}`] || env.POST_TOKEN;
if (!desired || auth !== `Bearer ${desired}`) return new Response("unauthorized", { status: 401 });
} else if (req.method !== "GET") {
return new Response("method not allowed", { status: 405 });
}


// Single DO instance per device name (consistent id)
const id = env.IPSTATE.idFromName(name);
const stub = env.IPSTATE.get(id);


// Proxy to DO /ip endpoint
const init = { method: req.method };
if (req.method === "POST") init.body = await req.text();
const doResp = await stub.fetch("https://do/ip", init);


// Force no caching anywhere
const resp = new Response(doResp.body, doResp);
resp.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
resp.headers.set("Pragma", "no-cache");
return resp;
}
};
