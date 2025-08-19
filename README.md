# RouterOs Live IP Registry

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
npx wrangler secret put POST_TOKEN_SENDER1
npx wrangler secret put POST_TOKEN_SENDER2
# Add more as devices grow, e.g. POST_TOKEN_<UPPERCASE_NAME>
```

### 4) Test from your PC (optional)
```bash
# pretend to be router "sender1_example"
curl -sS -X POST   -H "Authorization: Bearer <YOUR_TOKEN_OR_POST_TOKEN_SENDER1>"   -H "Content-Type: text/plain"   --data "198.51.100.21"   https://routeros-live-ip-registry.<you>.workers.dev/device/sender1_example

# read it back
curl -sS https://routeros-live-ip-registry.<you>.workers.dev/device/sender1_example
```

---

## RouterOS integration

### A) Sender routers (each router you want to allow later)
- Paste this script **unchanged** on each router.
- You only need to set **`WORKER_BASE_URL`** and the **Token**.

```rsc
#Script for RouterOS

:local URL "https://YOUR_SUBDOMAIN.workers.dev/device/YOUR_ROUTER_NAME"
:local TOKEN "YOUR_LONG_RANDOM_TOKEN"
:local ip ""

# Get timestamp for logging
:local timestamp ([/system clock get date] . " " . [/system clock get time])

# Try to get public IP with simple fetch command
:do {
    :local result [/tool fetch url="http://ifconfig.me/ip" output=user as-value]
    :set ip ($result->"data")
} on-error={
    :log debug ("[" . $timestamp . "] Failed to fetch IP from ifconfig.me")
}

# If first attempt failed, try backup service
:if ([:len $ip] = 0) do={
    :do {
        :local result [/tool fetch url="http://ipv4.icanhazip.com" output=user as-value]
        :set ip ($result->"data")
    } on-error={
        :log debug ("[" . $timestamp . "] Failed to fetch IP from icanhazip.com")
    }
}

# Clean the IP string - remove any whitespace or newlines
:if ([:len $ip] > 0) do={
    # Remove trailing whitespace and newlines
    :local newip ""
    :local chars [:len $ip]
    :for i from=0 to=($chars - 1) do={
        :local char [:pick $ip $i]
        :if ($char != "\r" && $char != "\n" && $char != " ") do={
            :set newip ($newip . $char)
        }
    }
    :set ip $newip
}

# Verify we have a valid IP
:if ([:len $ip] > 0) do={
    :do {
        :set ip [:tostr [:toip $ip]]
    } on-error={
        :set ip ""
    }
}

# Final check before sending
:if ([:len $ip] = 0) do={
    :log warning ("[" . $timestamp . "] post-live-ip: Failed to get valid public IP address")
    :return
}

# Send the update
:do {
    /tool fetch http-method=post url=$URL http-data=$ip http-header-field=("Authorization: Bearer " . $TOKEN) output=none
    :log info ("[" . $timestamp . "] Successfully updated public IP: " . $ip)
} on-error={
    :log warning ("[" . $timestamp . "] Failed to send update for public IP: " . $ip)
}

# schedule every 30 seconds
/system scheduler add name=post-live-ip interval=30s on-event="/system script run post-live-ip" disabled=no
```

> If you want **per-device tokens**, create `POST_TOKEN_<UPPERCASE_NAME>` on the Worker and use that as `TOKEN` for the matching router.

### B) Receiver router
- This script fetches all device IPs periodically and keeps a **single** address-list `senders-allow` up to date. Add new devices by adding their **sanitized** names to `devices`.

```rsc
# /system script add name=pull-senders-ip ...
:local BASE "https://YOUR_SUBDOMAIN.workers.dev"
:local DEVICES {"ِYOUR_ROUTER_NAME_1";""ِYOUR_ROUTER_NAME_2"}

:foreach d in=$DEVICES do={
    :local url ($BASE . "/device/" . $d)
    :local tmp ("dev_" . $d . ".tmp")
    :local ip ""

    # Fetch and process IP
    :do {
        /tool fetch url=$url dst-path=$tmp
        :if ([:len [/file find name=$tmp]] > 0) do={
            :local content [/file get $tmp contents]
            /file remove $tmp
            :if ([:len $content] > 0) do={
                :local clean [:pick $content 0 [:find $content "\n"]]
                :set ip [:tostr [:toip $clean]]
            }
        }
    } on-error={
        :log warning ("recv-ip: fetch failed for " . $d)
    }

    # Process if we got a valid IP
    :if ([:len $ip] > 0) do={
        :local deviceTag ("device:" . $d)
        :local currentEntry [/ip firewall address-list find where list="senders-allow" and comment=$deviceTag]
        
        :if ([:len $currentEntry] > 0) do={
            # Entry exists - check if IP changed
            :local currentIP [/ip firewall address-list get $currentEntry address]
            :if ($currentIP != $ip) do={
                # IP changed - update entry
                :do {
                    /ip firewall address-list set $currentEntry address=$ip timeout=2m
                    :log info ("recv-ip: updated " . $d . " from " . $currentIP . " to " . $ip)
                } on-error={
                    :log warning ("recv-ip: failed to update " . $d . " (" . $ip . ")")
                }
            } else={
                # Same IP - just reset timeout
                /ip firewall address-list set $currentEntry timeout=2m
                :log debug ("recv-ip: same IP for " . $d . " (" . $ip . "), reset timeout")
            }
        } else={
            # No entry exists - add new one
            :do {
                /ip firewall address-list add list="senders-allow" \
                    address=$ip \
                    timeout=2m \
                    comment=$deviceTag
                :log info ("recv-ip: added new " . $d . " (" . $ip . ")")
            } on-error={
                :log warning ("recv-ip: failed to add " . $d . " (" . $ip . ")")
            }
        }
    }
}

# schedule every 30 seconds
/system scheduler add name=pull-senders-ip interval=30s on-event="/system script run pull-senders-ip" disabled=no

# firewall rule example (place correctly in your ruleset)
/ip firewall filter add chain=input src-address-list=senders-allow action=accept comment="allow from live senders"
```
