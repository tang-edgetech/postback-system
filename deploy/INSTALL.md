# Production Installation Guide — Postback System

For the server/ops team deploying `main` to the live VPS. This covers the full stack:
three Go binaries, one Next.js app, MySQL, Redis, and the reverse proxy in front of all
of them.

## 1. Architecture — which domain goes where

| Public domain | Proxies to (localhost) | What it is | Source / binary |
|---|---|---|---|
| `babawha.com` | `127.0.0.1:8081` | Redirect front door — hot-path `/{slug}` 302 redirect + click logging | `services/redirect` → `bin/redirect` |
| `babapi.babawha.com` | `127.0.0.1:8082` | Dashboard REST API + public postback receiver (`/postback`, `/v1/postback`) | `services/api` → `bin/api` |
| `backdash.babawha.com` | `127.0.0.1:8083` | Admin dashboard (Next.js, `npm run start`) | `apps/dashboard` |
| *(none — no public port)* | — | Worker: runs the once-daily Links → Forwarding sweep. No HTTP surface at all, nothing points at it. | `services/worker` → `bin/worker` |

Apache/nginx is the **only** thing exposed on ports 80/443 — none of 8081/8082/8083 should
ever be reachable from outside the box. All three web-facing services bind to
`127.0.0.1` already (hardcoded in each `main.go`), so this is enforced at the app level
too, not just by firewall/proxy config.

There is no shared filesystem/directory between the three domains — each is its own
process, reading the same MySQL database and (for the API/worker) the same Redis
instance. The one exception is `services/api`'s `uploads/` directory (logo/favicon
files), which is served back out at `/uploads/...` by the API itself — nothing else
touches it.

## 2. Server prerequisites

- Linux VPS with root/sudo (the original plan assumed a dedicated box; adjust paths if
  this is a shared cPanel/WHM environment)
- **Go 1.26+** (matches `go.work`) — needed to *build* the three binaries; not required
  at runtime once built
- **Node.js 20 LTS+** (dev was built/tested on Node 22) — needed both to build and run
  the dashboard (`next start` is a real running process, not a static export)
- **MySQL 8.0+ or MariaDB 10.5+** — the schema uses `CHECK` constraints (migrations
  0001, 0008) that need a version new enough to enforce them
- **Redis** (real Redis on Linux — Memurai was only a Windows dev-environment stand-in)
  — used for dashboard sessions; the redirect service does **not** use Redis at all
  currently (no fraud/cache layer yet — see §8)
- **Apache** with `mod_proxy`, `mod_proxy_http`, `mod_ssl`, `mod_rewrite` (or nginx if
  you'd rather not use Apache — see the note in §6)
- `certbot` (or your existing WHM/cPanel TLS flow) for certificates on all three hostnames
- `git`

## 3. Get the code

```bash
sudo mkdir -p /opt/postback-system
sudo chown $USER:$USER /opt/postback-system
git clone https://github.com/tang-edgetech/postback-system.git /opt/postback-system
cd /opt/postback-system
git checkout main
```

`main` and `dev-reports` are identical as of this deploy (dev-reports was merged into
main, not left as a separate line) — `main` is the one to deploy.

## 4. Database setup — yes, it's just the migrations

There's no migration *tool* (no golang-migrate/flyway) — the `.sql` files under
`migrations/` are hand-applied in order with the `mysql` CLI. That's it; there's no
separate "install script" beyond this and the Setup Wizard in §7.

```bash
mysql -u root -p -e "
  CREATE DATABASE postback_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'postback'@'localhost' IDENTIFIED BY 'REPLACE_WITH_A_REAL_PASSWORD';
  GRANT ALL PRIVILEGES ON postback_system.* TO 'postback'@'localhost';
  FLUSH PRIVILEGES;
"

cd /opt/postback-system/migrations
for f in 0001_init_schema.up.sql \
         0002_settings_seo_and_audit_status.up.sql \
         0003_audit_actor_fullname.up.sql \
         0004_campaign_tenant_2fa_permissions.up.sql \
         0005_click_device_columns.up.sql \
         0006_permission_overrides_entity_grants_auth_settings.up.sql \
         0007_marketer_links_permission_default.up.sql \
         0008_link_forwarding.up.sql \
         0009_reports_permission.up.sql; do
  echo "applying $f"
  mysql -u postback -p postback_system < "$f"
done
```

**Do not use `root` with no password in production** — that's a local-XAMPP-only
convention documented in `CLAUDE.md`, never intended to reach a real server. Use the
dedicated `postback` user above (or whatever name your ops convention prefers) and put
the real password only in the `.env` files in §6, never in shell history/scripts checked
into git.

No seed data is applied — the first real user account is created through the Setup
Wizard in §7, not by a script. (There's a leftover `services/api/cmd/seed` dev utility
in the repo history — ignore it, it predates the Setup Wizard and isn't part of this
flow.)

## 5. Build the binaries

Build must happen with the full repo checked out (needs `go.work` to resolve the
`shared` module) — but the *output* is a normal static Go binary with zero runtime
dependency on the source tree or `go.work`. Building directly on the target server
(matching its OS/arch, no cross-compile flags needed) is the simplest path:

```bash
cd /opt/postback-system
mkdir -p bin
go build -o bin/redirect ./services/redirect/cmd/redirect
go build -o bin/api      ./services/api/cmd/api
go build -o bin/worker   ./services/worker/cmd/worker
```

(Building from a Windows dev machine and copying the binaries over also works — cross-compile
with `GOOS=linux GOARCH=amd64 go build ...` — but there's no CGO dependency here, so
building natively on the server is one less thing to get wrong.)

Dashboard:

```bash
cd /opt/postback-system/apps/dashboard
npm ci
npm run build
```

## 6. Environment configuration

Each service reads its config from environment variables with dev-friendly defaults
baked in (see each `services/*/.env.example`) — **all of the following must be
overridden for production**, they are not safe as-is:

**`services/redirect/.env`**
```
REDIRECT_PORT=8081
DB_DSN=postback:REAL_PASSWORD@tcp(127.0.0.1:3306)/postback_system?parseTime=true&charset=utf8mb4
```

**`services/api/.env`**
```
API_PORT=8082
DB_DSN=postback:REAL_PASSWORD@tcp(127.0.0.1:3306)/postback_system?parseTime=true&charset=utf8mb4
REDIS_ADDR=127.0.0.1:6379
SESSION_COOKIE_DOMAIN=.babawha.com
SESSION_COOKIE_SECURE=true
CORS_ALLOWED_ORIGIN=https://backdash.babawha.com
SETTINGS_ENCRYPTION_KEY=<generate a real random secret — see note below>
UPLOAD_DIR=/opt/postback-system/services/api/uploads
```

`SETTINGS_ENCRYPTION_KEY` encrypts the Cloudflare API token/zone *and* any Links →
Forwarding auth secrets at rest (AES-GCM, `shared/crypto`). Generate one with
`openssl rand -base64 32` and treat it like any other production secret — **losing it
or changing it after the fact makes every already-encrypted value unrecoverable**
(Cloudflare integration breaks, every link's forwarding auth breaks) until re-entered.

`UPLOAD_DIR` is set to an **absolute path** here deliberately — the code's default is
the relative path `./uploads`, which only resolves correctly if the process's current
working directory is `services/api/` at the moment it starts. Under systemd this is
controlled by `WorkingDirectory=` (already set correctly in the unit file in §9), but
setting an absolute `UPLOAD_DIR` removes that footgun entirely regardless of how the
process ends up being started.

**`services/worker/.env`**
```
DB_DSN=postback:REAL_PASSWORD@tcp(127.0.0.1:3306)/postback_system?parseTime=true&charset=utf8mb4
SETTINGS_ENCRYPTION_KEY=<same value as services/api/.env — must match exactly>
```
(`FORWARDING_RUN_ON_START=true` is a dev-only convenience for testing without waiting
for local midnight — leave it unset/`false` in production.)

**`apps/dashboard/.env.local`**
```
NEXT_PUBLIC_API_BASE_URL=https://babapi.babawha.com
NEXT_PUBLIC_REDIRECT_BASE_URL=https://babawha.com
```
These two are baked into the client bundle **at build time** (`next build`), not read at
runtime — if either changes later, `npm run build` must be re-run before restarting the
dashboard, a plain process restart alone will not pick up a new value.

`CORS_ALLOWED_ORIGIN` only supports a single origin string today (a known limitation,
see `to-do.md`) — fine for one production dashboard origin, but revisit that middleware
if a staging environment or a www/non-www split is ever needed at the same time.

## 7. First run

1. Create `services/api/uploads/` if it doesn't already exist and make sure the service
   user can write to it: `mkdir -p /opt/postback-system/services/api/uploads`. (Note:
   two files already exist there from dev testing — a placeholder logo/favicon. Replace
   them via Settings → General once the dashboard is up, or delete them beforehand for a
   clean slate.)
2. Start `redirect`, `api`, and `worker` (see §9 for the systemd units) — `api` will
   auto-insert a default `settings` row on first boot (`INSERT IGNORE`), so there's
   nothing to manually seed.
3. Start the dashboard.
4. Bring up the reverse proxy + TLS (§10), then visit `https://backdash.babawha.com` —
   with zero rows in `users`, it redirects straight to `/setup`. Complete the Setup
   Wizard (site title/URL/region/language + the first Super Admin account + logo/favicon
   if you want them set immediately). This is the **only** account creation step — there
   is no other seeding.

## 8. Systemd units

Unit files are in `deploy/systemd/` — copy them in and enable:

```bash
sudo useradd --system --no-create-home postback   # if this user doesn't already exist
sudo chown -R postback:postback /opt/postback-system

sudo cp deploy/systemd/postback-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now postback-redirect postback-api postback-worker postback-dashboard
sudo systemctl status postback-redirect postback-api postback-worker postback-dashboard
```

Each unit sets `Restart=always` and reads its `.env` file from §6 via
`EnvironmentFile=`. Logs go to the journal — `journalctl -u postback-api -f` etc.

## 9. Reverse proxy + TLS

The local dev setup already proves Apache + `mod_proxy` works well for this exact
3-domain-to-3-ports pattern (`deploy/apache/babawha-local.conf`) — the production
version (`deploy/apache/babawha-production.conf.example`) is the same shapes, just with
real hostnames and TLS termination. Copy it, fill in your certificate paths, and include
it from your main Apache config (or WHM's Include Editor if this is a cPanel box).

If this server runs nginx instead of Apache, the equivalent is a `server {}` block per
hostname with `proxy_pass http://127.0.0.1:PORT;` plus the usual
`proxy_set_header Host $host;` / `X-Forwarded-For` headers — the original design intent
was actually nginx-as-sole-listener (see `to-do.md`), Apache is just what's proven
locally; either works, there's nothing in the app itself that assumes one or the other.

Get certificates for all three hostnames before enabling the `:443` vhosts, e.g.:
```bash
certbot certonly --apache -d babawha.com -d babapi.babawha.com -d backdash.babawha.com
```

## 10. Verification checklist

- [ ] `curl -I https://babawha.com/` → reaches the redirect service (404/placeholder is
      fine with no links yet; the point is it's not a connection error or a raw Apache
      default page)
- [ ] `curl https://babapi.babawha.com/health` → `{"ok":true,"data":{"service":"api",...}}`
- [ ] `https://backdash.babawha.com` loads the dashboard and either shows `/setup` (fresh
      DB) or `/login`
- [ ] Complete the Setup Wizard, log in, confirm the sidebar shows the full nav (Super
      Admin sees everything)
- [ ] Create a test Link, visit its short URL, confirm a row lands in `link_clicks`
- [ ] Fire a test postback (`GET`/`POST` to `/postback?cid=...&tid=...&event_name=test`)
      against a real click's `cid`/`tid`, confirm it shows up nested under that click on
      the Single Link page
- [ ] `journalctl -u postback-worker -n 20` shows it logged a scheduled next-sweep time
      on boot (confirms DB connectivity from that service specifically)
- [ ] Browser devtools → confirm the `pb_session` cookie has `Secure`, `HttpOnly`, and
      `Domain=.babawha.com` set

## 11. Known gaps to be aware of post-launch

These are documented in `to-do.md` and deliberately out of scope so far — not blockers
for going live, but the team should know they're not there yet:

- No fraud detection on the redirect hot path (velocity limits, bot-UA/datacenter-IP
  lists) — every click is logged as-is.
- Click logging is a synchronous per-request DB insert, not a batched/durable queue —
  fine at moderate volume, worth a load test (`hey`/`vegeta` against `/{slug}`) before a
  serious traffic push.
- No DB archival/retention yet — `link_clicks`/`postback_events` grow unbounded. Ordinary
  DB backups (mysqldump/binlog) are still your responsibility regardless — this app does
  not manage backups.
- `CORS_ALLOWED_ORIGIN` is a single origin — fine for one prod dashboard domain, revisit
  before adding a second (staging, www variant, etc.) at the same time.
