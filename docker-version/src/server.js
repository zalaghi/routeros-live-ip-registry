import express from "express";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const DATA_DIR = process.env.DATA_DIR || "/data";
const DEVICES_DIR = process.env.DEVICES_DIR || path.join(DATA_DIR, "devices");

// When the container is behind a reverse proxy (nginx/traefik/Caddy), set TRUST_PROXY=1
// so Express uses X-Forwarded-For for req.ip.
const TRUST_PROXY = (process.env.TRUST_PROXY || "0").toLowerCase();

// Security defaults: require a token on updates.
// Set REQUIRE_TOKEN=0 to allow unauthenticated updates.
const REQUIRE_TOKEN = (process.env.REQUIRE_TOKEN || "1").toLowerCase();

function isTruthy(v) {
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function sanitizeName(name) {
  // Keep compatible with the original Worker: [A-Za-z0-9_-]
  const clean = (name || "").replace(/[^A-Za-z0-9_-]/g, "");
  // keep it reasonable
  return clean.slice(0, 64);
}

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

function normalizeIp(raw) {
  // Keep only digits and dots, then validate
  const ip = (raw || "").trim().replace(/[^\d.]/g, "");
  if (!ip) return "";
  return isIPv4(ip) ? ip : "";
}

function expectedTokenFor(name) {
  const key = `POST_TOKEN_${name.toUpperCase()}`;
  return process.env[key] || process.env.POST_TOKEN || "";
}

function unauthorized(res) {
  res.status(401).type("text/plain; charset=utf-8").send("unauthorized\n");
}

function noCacheHeaders(res) {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  });
}

async function atomicWriteText(filePath, contents) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`
  );
  await fs.writeFile(tmp, contents, { encoding: "utf8" });
  await fs.rename(tmp, filePath);
}

function clientIp(req) {
  // Express will populate req.ip using trust proxy rules.
  // It may return IPv6-mapped IPv4 like ::ffff:203.0.113.10
  const ip = (req.ip || "").trim();
  if (!ip) return "";
  const m = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return m[1];
  return ip;
}

const app = express();
// Avoid ETag generation; we want clients/proxies to never cache responses.
app.disable("etag");
if (isTruthy(TRUST_PROXY)) {
  app.set("trust proxy", true);
}

// Capture raw body for any content-type (RouterOS sometimes sends no content-type).
app.use(
  express.raw({
    type: "*/*",
    limit: "32kb",
  })
);

// Always disable caching.
app.use((req, res, next) => {
  noCacheHeaders(res);
  next();
});

app.get("/health", (req, res) => {
  res.status(200).type("text/plain; charset=utf-8").send("ok\n");
});

app.get("/myip", (req, res) => {
  const ip = normalizeIp(clientIp(req));
  if (!ip) return res.status(400).type("text/plain; charset=utf-8").send("bad ip\n");
  res.status(200).type("text/plain; charset=utf-8").send(ip + "\n");
});

// GET  /device/<name>        -> returns stored IP (text/plain)
// POST /device/<name>        -> stores IP (body ip=..., text/plain IP, or fall back to source IP)
// GET  /device/<name>/push   -> stores source IP (token via Authorization or ?token=)

app.get("/device/:name", async (req, res) => {
  const name = sanitizeName(req.params.name);
  if (!name) return res.status(404).type("text/plain; charset=utf-8").send("not found\n");

  const filePath = path.join(DEVICES_DIR, `${name}.txt`);
  try {
    const ip = await fs.readFile(filePath, { encoding: "utf8" });
    // ensure text/plain and trailing newline (RouterOS scripts commonly assume it)
    res.status(200).type("text/plain; charset=utf-8").send(ip.trim() + "\n");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return res.status(404).type("text/plain; charset=utf-8").send("not set\n");
    }
    console.error("read failed", { name, err });
    return res.status(500).type("text/plain; charset=utf-8").send("error\n");
  }
});

app.post("/device/:name", async (req, res) => {
  const name = sanitizeName(req.params.name);
  if (!name) return res.status(404).type("text/plain; charset=utf-8").send("not found\n");

  const expected = expectedTokenFor(name);
  const provided = (req.headers.authorization || "").trim();

  if (isTruthy(REQUIRE_TOKEN)) {
    if (!expected) {
      // Misconfiguration; do not accept writes without a configured token when REQUIRE_TOKEN=1
      return res
        .status(500)
        .type("text/plain; charset=utf-8")
        .send("server token not configured\n");
    }
    if (provided !== `Bearer ${expected}`) return unauthorized(res);
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";

  // Accept: text/plain "1.2.3.4" OR form encoded "ip=1.2.3.4".
  let ip = "";
  try {
    const params = new URLSearchParams(rawBody);
    ip = normalizeIp(params.get("ip") || "");
  } catch (_) {
    // ignore
  }
  if (!ip) ip = normalizeIp(rawBody);

  // If not provided, fall back to source IP.
  if (!ip) ip = normalizeIp(clientIp(req));

  if (!ip) {
    return res.status(400).type("text/plain; charset=utf-8").send("bad ip\n");
  }

  const filePath = path.join(DEVICES_DIR, `${name}.txt`);
  try {
    await atomicWriteText(filePath, ip + "\n");
    return res.status(200).type("text/plain; charset=utf-8").send("ok\n");
  } catch (err) {
    console.error("write failed", { name, err });
    return res.status(500).type("text/plain; charset=utf-8").send("error\n");
  }
});

app.get("/device/:name/push", async (req, res) => {
  const name = sanitizeName(req.params.name);
  if (!name) return res.status(404).type("text/plain; charset=utf-8").send("not found\n");

  const expected = expectedTokenFor(name);
  const providedHeader = (req.headers.authorization || "").trim();
  const providedQuery = (req.query.token || "").toString().trim();

  if (isTruthy(REQUIRE_TOKEN)) {
    if (!expected) {
      return res
        .status(500)
        .type("text/plain; charset=utf-8")
        .send("server token not configured\n");
    }
    const okHeader = providedHeader === `Bearer ${expected}`;
    const okQuery = providedQuery === expected;
    if (!okHeader && !okQuery) return unauthorized(res);
  }

  const ip = normalizeIp(clientIp(req));
  if (!ip) return res.status(400).type("text/plain; charset=utf-8").send("bad ip\n");

  const filePath = path.join(DEVICES_DIR, `${name}.txt`);
  try {
    await atomicWriteText(filePath, ip + "\n");
    return res.status(200).type("text/plain; charset=utf-8").send("ok\n");
  } catch (err) {
    console.error("write failed", { name, err });
    return res.status(500).type("text/plain; charset=utf-8").send("error\n");
  }
});

app.use((req, res) => {
  res.status(404).type("text/plain; charset=utf-8").send("not found\n");
});

app.listen(PORT, async () => {
  await fs.mkdir(DEVICES_DIR, { recursive: true });
  console.log(
    JSON.stringify(
      {
        msg: "routeros-live-ip-registry (docker) started",
        port: PORT,
        devicesDir: DEVICES_DIR,
        trustProxy: isTruthy(TRUST_PROXY),
        requireToken: isTruthy(REQUIRE_TOKEN),
      },
      null,
      2
    )
  );
});
