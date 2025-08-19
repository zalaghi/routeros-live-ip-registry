# routeros-live-ip-registry


Cloudflare Worker + Durable Objects that acts as a tiny registry for **live public IPs** pushed by MikroTik routers, and pulled by a receiver router to allow those IPs in firewall rules.


- **No DDNS**. **No open ports**. **No CDN cache**.
- Each router posts its own IP to `/device/<router-name>` (the name comes from RouterOS identity, sanitized).
- A receiver fetches these IPs and maintains a single address-list.


## Why Durable Objects?
They give you a single, consistent value per device across Cloudflare's edge, so the receiver always reads the latest IP.


---


## Quick start


### 0) Requirements
- A Cloudflare account with a **workers.dev** subdomain.
- Node.js LTS.


> Tip: You **do not** need GitHub integration or global `wrangler` install. We'll use `npx`.


### 1) Login
```bash
npx wrangler login
