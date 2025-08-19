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
```

### 2) Deploy
From this repo directory:
```bash
npx wrangler deploy
```
This applies the Durable Object migration and prints your URL, e.g.
```
https://routeros-live-ip-registry.<you>.workers.dev
```

### 3) Secrets (tokens)
Set a **global** POST token used by all devices **or** per-device tokens.

- Single shared token for all devices:
```bash
npx wrangler secret put POST_TOKEN
# paste a long random string
```

- Optional per-device tokens (override the global one):
```bash
npx wrangler secret put POST_TOKEN_B810
npx wrangler secret put POST_TOKEN_UNIT16
# Add more as devices grow, e.g. POST_TOKEN_<UPPERCASE_NAME>
```

### 4) Test from your PC (optional)
```bash
# pretend to be router "b810"
curl -sS -X POST   -H "Authorization: Bearer <YOUR_TOKEN_OR_POST_TOKEN_B810>"   -H "Content-Type: text/plain"   --data "198.51.100.21"   https://routeros-live-ip-registry.<you>.workers.dev/device/b810

# read it back
curl -sS https://routeros-live-ip-registry.<you>.workers.dev/device/b810
```

---

## RouterOS integration

### A) Sender routers (each router you want to allow later)
- Paste this script **unchanged** on each router.
- It automatically discovers the router name (from `/system identity`), sanitizes it, and posts to `/device/<name>`.
- You only need to set **`WORKER_BASE_URL`** and the **Token**.

```rsc
# /system script add name=post-live-ip ...
/system script add name=post-live-ip policy=read,write,test source={
    # === CONFIG ===
    :local WORKER_BASE_URL "https://routeros-live-ip-registry.<you>.workers.dev";
    :local TOKEN "YOUR_LONG_RANDOM_TOKEN";  # or a per-device token on the worker

    # === DISCOVER PUBLIC IPv4 ===
    :local urls {"https://api.ipify.org";"https://ipv4.icanhazip.com";"https://ifconfig.me/ip"};
    :local ip "";
    :foreach u in=$urls do={
        :do {
            :local r [/tool fetch url=$u as-value output=user];
            :local d ($r->"data");
            :set d [:pick $d 0 [:find ($d . "\n") "\n"]];
            :set d [:pick $d 0 [:find ($d . "\r") "\r"]];
            :if ($d ~ "^[0-9]{1,3}(\.[0-9]{1,3}){3}$") do={ :set ip $d; :break }
        } on-error={}
    }
    :if ($ip = "") do={ :log warning "post-live-ip: no public IP"; :return };

    # === GET ROUTER NAME & SANITIZE TO [a-z0-9_-] ===
    :local rawName [/system identity get name];
    :local lower [:tolower $rawName];
    :local allowed "abcdefghijklmnopqrstuvwxyz0123456789-_";
    :local name "";
    :for i from=0 to=([:len $lower] - 1) do={
        :local ch [:pick $lower $i ($i+1)];
        :if ($ch = " ") do={ :set ch "-" };
        :if ([:find $allowed $ch] != nil) do={ :set name ($name . $ch) };
    }
    :if ($name = "") do={ :set name "router" };

    # === POST TO WORKER ===
    :local url ($WORKER_BASE_URL . "/device/" . $name);
    /tool fetch url=$url http-method=post http-data=$ip         http-header-field=("Authorization: Bearer " . $TOKEN)         http-header-field="Content-Type: text/plain"         output=none check-certificate=yes http-max-redirect-count=0;

    :log info ("post-live-ip: [" . $name . "] -> " . $ip);
}

# schedule every 30 seconds
/system scheduler add name=post-live-ip interval=30s on-event="/system script run post-live-ip" disabled=no
```

> If you want **per-device tokens**, create `POST_TOKEN_<UPPERCASE_NAME>` on the Worker and use that as `TOKEN` for the matching router.

### B) Receiver router (unit51)
- This script fetches all device IPs periodically and keeps a **single** address-list `senders-allow` up to date. Add new devices by adding their **sanitized** names to `devices`.

```rsc
# /system script add name=pull-senders-ip ...
/system script add name=pull-senders-ip policy=read,write,test source={
    :local WORKER_BASE_URL "https://routeros-live-ip-registry.<you>.workers.dev";
    :local devices {"b810";"unit16"};   # add more names later (must match sanitized router names)
    :local tmp "";

    :foreach d in=$devices do={
        :local url ($WORKER_BASE_URL . "/device/" . $d);
        :set tmp ("dev_" . $d . ".tmp");

        /tool fetch url=$url dst-path=$tmp keep-result=yes             http-header-field="Cache-Control: no-cache"             check-certificate=yes http-max-redirect-count=0;

        :local data [/file get $tmp contents]; /file remove $tmp;
        :local n [:find $data "\n"]; :if ($n != -1) do={ :set data [:pick $data 0 $n]; };
        :local c [:find $data "\r"]; :if ($c != -1) do={ :set data [:pick $data 0 $c]; };

        :if (!($data ~ "^[0-9]{1,3}(\.[0-9]{1,3}){3}$")) do={
            :log warning ("pull-senders-ip: invalid/empty IP for " . $d);
        } else={
            :local ip $data;
            :local tag ("device:" . $d);

            :if ([:len [/ip firewall address-list find list="senders-allow" address=$ip comment=$tag]] = 0) do={
                /ip firewall address-list add list="senders-allow" address=$ip timeout=2m comment=$tag;
            };
            /ip firewall address-list remove [find list="senders-allow" comment=$tag !address=$ip];
            :log info ("pull-senders-ip: " . $d . " -> " . $ip);
        }
    }
}

# schedule every 30 seconds
/system scheduler add name=pull-senders-ip interval=30s on-event="/system script run pull-senders-ip" disabled=no

# firewall rule example (place correctly in your ruleset)
/ip firewall filter add chain=input src-address-list=senders-allow action=accept comment="allow from live senders"
```
