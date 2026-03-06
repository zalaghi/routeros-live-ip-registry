# RouterOS Live IP Registry (Docker)

این نسخه، همان ایده‌ی پروژه‌ی Cloudflare Worker را **برای اجرای مستقیم داخل Docker** پیاده‌سازی می‌کند.

هدف: MikroTik (RouterOS) به یک URL درخواست می‌زند و **آخرین IP عمومی‌اش** برای هر دستگاه ذخیره می‌شود تا یک روتر «گیرنده» بتواند IPها را بخواند و داخل Address-List فایروال نگه دارد.

- **File-backed** (هر دستگاه یک فایل: `devices/<name>.txt`)
- **بدون Cache** (هدرهای `Cache-Control: no-store` و… روی همه‌ی پاسخ‌ها)
- **Token-based auth** مثل نسخه‌ی Worker (توکن مشترک یا per-device)

---

## Endpoints

### 1) خواندن IP
`GET /device/<name>`

- خروجی: `text/plain` (مثلاً `203.0.113.10\n`)
- اگر هنوز set نشده باشد: `404 not set`

### 2) آپدیت IP با POST (مثل Worker)
`POST /device/<name>`

- Auth: `Authorization: Bearer <TOKEN>` (پیش‌فرض اجباری)
- Body می‌تواند یکی از این‌ها باشد:
  - `text/plain` → `1.2.3.4`
  - `application/x-www-form-urlencoded` → `ip=1.2.3.4`
  - اگر Body خالی باشد، سرویس **از IP سورس درخواست** استفاده می‌کند.

### 3) آپدیت IP فقط با GET (ساده‌ترین حالت برای RouterOS)
`GET /device/<name>/push`

- این مسیر IP را از **سورس درخواست** برمی‌دارد و ذخیره می‌کند.
- Token را می‌توانید یکی از این دو روش بدهید:
  - Header: `Authorization: Bearer <TOKEN>`
  - Query: `?token=<TOKEN>`

---

## اجرا با Docker Compose

1) توکن را عوض کنید (حتماً یک رشته‌ی طولانی و رندوم):

```yaml
# docker-compose.yml
environment:
  - POST_TOKEN=CHANGE_ME
```

2) اجرا:

```bash
docker compose up -d --build
```

3) تست:

```bash
curl -i http://localhost:8080/health
curl -i -H "Authorization: Bearer CHANGE_ME" http://localhost:8080/device/test/push
curl -i http://localhost:8080/device/test
```

---

## متغیرهای محیطی

- `POST_TOKEN` : توکن مشترک برای همه‌ی دستگاه‌ها
- `POST_TOKEN_<NAME>` : توکن اختصاصی برای یک دستگاه (مثلاً `POST_TOKEN_SENDER1`)
- `REQUIRE_TOKEN` : پیش‌فرض `1` (اگر `0` شود، نوشتن بدون توکن هم ممکن است)
- `TRUST_PROXY` : اگر پشت reverse proxy هستید و می‌خواهید `X-Forwarded-For` معتبر باشد → `1`
- `DEVICES_DIR` : مسیر ذخیره فایل‌ها (پیش‌فرض: `/data/devices`)
- `PORT` : پورت سرویس (پیش‌فرض: `8080`)

> نکته مهم: اگر سرویس پشت nginx/traefik/caddy است و می‌خواهید IP واقعی کلاینت ذخیره شود، `TRUST_PROXY=1` را ست کنید و مطمئن شوید reverse proxy درست `X-Forwarded-For` می‌گذارد.

---

## RouterOS Scripts

داخل همین ریپو دو مدل Sender گذاشته شده:

- `post_public_ip_via_get_source_ip.rsc`  ✅ پیشنهاد‌شده
  - بدون نیاز به ifconfig.me و… (فقط GET می‌زند و IP سورس ذخیره می‌شود)

- `post_public_ip_via_body_ip.rsc`
  - مشابه نسخه‌ی Worker: اول public IP را از اینترنت می‌گیرد و بعد POST می‌کند.

Receiver هم:
- `receive_public_ip.rsc`

---

## امنیت

اگر این سرویس روی اینترنت باز است:
- `REQUIRE_TOKEN=1` را نگه دارید.
- توکن طولانی و سخت انتخاب کنید.
- بهتر است پشت HTTPS (reverse proxy) اجرا کنید.


## Optional: icanhazip-style endpoint

- `GET /myip` returns the client IP as seen by the server (after reverse-proxy headers), as plain text.
