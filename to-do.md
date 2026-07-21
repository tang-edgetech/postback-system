# To-Do

## Not yet built for production

- [ ] Write a production nginx (or Apache) reverse-proxy config for the real `babawha.com` domains — `deploy/apache/` currently only has the local dev vhost (`babawha-local.conf`, proxying `*.babawha.local` → `127.0.0.1:8081/8082/8083`). The plan called for nginx as the sole public listener (80/443) on the VPS; that hasn't been created yet.
- [ ] Set up systemd units (or equivalent) for `redirect`, `api`, and the dashboard (`npm run start`) with `Restart=always`, bound to localhost only.
- [ ] Wire up TLS (Let's Encrypt/certbot) per subdomain.
- [ ] Flip `SESSION_COOKIE_SECURE=true` and set a real `SETTINGS_ENCRYPTION_KEY` for production — both are dev placeholders in `.env.example` (`services/api/.env.example`) and nothing currently enforces that they get changed before a real deploy.
- [ ] Point `SESSION_COOKIE_DOMAIN`, `CORS_ALLOWED_ORIGIN`, `NEXT_PUBLIC_API_BASE_URL`, and `NEXT_PUBLIC_REDIRECT_BASE_URL` at the real `babawha.com` domains for the prod environment (these are already env-driven, just need real values set).
- [ ] `CORS_ALLOWED_ORIGIN` only supports a single origin string (`services/api/internal/middleware/cors.go`) — revisit if production ever needs to allow more than one origin (e.g. www + non-www, or staging + prod at once).
- [ ] Redirect click-logging is still a synchronous per-request insert, not the batched/Redis-Stream durability tier discussed for high volume — revisit before a real traffic push.
- [ ] Fraud detection (velocity limits, bot-UA list, datacenter-IP-range list) is not implemented — redirect hot path has no fraud checks yet.
- [ ] Load-test the redirect hot path (`hey`/`vegeta` against `/{slug}`) to confirm latency stays flat as MySQL write volume grows.
- [ ] Security spot-check before cutover: confirm the Cloudflare token/zone never appear in any API response payload, confirm Marketer role is blocked server-side (not just UI-hidden) from Users endpoints, confirm session cookie flags (`HttpOnly`/`Secure`/`SameSite`/`Domain`) via browser devtools.

## Features

- [ ] **Links > Single Link: new "Forwarding" tab.** One forwarding rule per link (v1) to forward that link's leads (clicks) and actions (postbacks) to a third-party endpoint (e.g. marketing tools). No real-time push — on-demand "Send Now" + a once-daily cron, sending only unsent records, capped per run (10/25/50/100/150/200, selectable per link).
  - Route: `/links/{id}/forwarding` — nested under the Link (not a standalone page outside it), same convention as Visits/Integration/History. Everything (config + delivery log) lives inside this one tab; no separate list/detail pair since it's a single rule per link. Revisit as a list+detail (`/links/{id}/forwarding/{forwardingId}`) only if multi-destination-per-link is ever actually needed.
  - Cron execution model: the daily job iterates every link with forwarding enabled (foreach), and for each link independently gathers its unsent backlog — clicks and postbacks share one merged queue per link, each record tagged `type: "lead" | "action"`, oldest-unsent-first — up to that link's configured cap. One link failing doesn't block the next.
  - Batching: POST+JSON sends up to N records as one JSON array in a single call. GET or POST+url-encoded can't serialize an array meaningfully, so the cap instead limits how many individual calls (one record each) the cron makes that run.
  - Fields: Endpoint URL · Method (GET/POST) · Body format (url-encoded or JSON) · Auth · custom headers (free-form key/value, merged with auth).
  - Auth — base set always available: None / Bearer Token / Basic Auth / API Key (header) / API Key (query param), secrets encrypted at rest (same AES-GCM pattern already used for the Cloudflare token/zone, `shared/crypto`; never returned in API responses). Advanced set — HMAC-signed requests, OAuth2 client-credentials — hidden by default; unlocked per Settings → Authentication (already built — Super Admin toggles each one on for all Links or a specific allowlist). (Note for whenever these get built: HMAC needs an explicit signing convention — which fields, algorithm, header name — and OAuth2 client-credentials needs a token fetch/cache/refresh cycle, not just a static secret; both are real sub-features, not just extra dropdown options.)
  - SSRF guard: block private/loopback/link-local target URLs by default.
  - Delivery log: a section within the same Forwarding tab showing sent/unsent/failed records, last-run status, and current backlog size — not a separate page.
  - Visibility: tab visible to Super Admin always; Admin gated by a new permission key (e.g. `links.forwarding.manage`), toggle-able by Super Admin in Settings → Permissions. Never shown to Marketer.
  - Needs a new `services/worker` binary (in-process scheduler, e.g. `robfig/cron` — not OS cron/systemd timers, so behavior matches on both Windows dev and the Linux VPS) to run the daily sweep; must not run inside `api` or `redirect`.
  - Needs a delivery-log table (per-record status: pending/sent/failed, http status, attempt count) backing the tab's log section and driving what counts as "unsent" for the next run.
  - Must coordinate with the archival feature below: don't archive a click/postback that hasn't been forwarded yet on a link with forwarding enabled.

- [ ] **Reports feature.** Marketing team (Admin + Marketer) hasn't finalized the exact metrics they want — treat the metrics list below as candidates to send them, not a locked spec.
  - Access: all roles can generate; Admin on by default; Marketer gated by a new permission key (e.g. `reports.view`), same editable-permission convention as everything else. Marketer sees only entities they created *or* have been explicitly granted (already built — Merchant/Campaign-level grants on the Edit User page).
  - Filters: Merchant(s) / Campaign(s) / Link(s), date range, Device/OS/Browser, postback event name, link status, geo country/region.
  - Date-range presets: 7 days, 2 weeks, 1 month, 3 months for all roles with report access; Super Admin and Admin additionally get quarter, semi-annual, and annual. **Note:** the semi-annual/annual ranges exceed the 3-month "hot" data window from the archival plan below — those longer ranges need to read from the permanent rollup table (aggregate charts) and/or a restore-from-archive path (raw-data drill-down), not raw `link_clicks` rows directly.
  - Date-range boundaries use the site's configured `region` setting (team is majority GMT+8) — not UTC.
  - Mode: manual only for v1 — filter, view, export on demand. No saved or scheduled reports.
  - Candidate metrics: raw click/postback counts per merchant/campaign/link; conversion rate (per postback event name — a blended rate across mixed event types is close to meaningless); time-series trend (daily/weekly); Device/OS/Browser breakdown %; top-N ranking by clicks or conversions. Fraud-rejected and expired-postback-rejected counts are *not* trackable yet — blocked on fraud detection (not implemented) and on the postback handler not currently logging its own rejections anywhere retrievable.
  - Charts: pie, bar, and line/graph, on-screen only — pie for composition (device/OS/browser share, event-name distribution), bar for comparisons (top links/campaigns/merchants), line for trend over the date range. Same filters as the tabular report.
  - Export: CSV only, underlying data (reuse the `/v1/audit-logs/export` pattern). No chart-image export.

- [ ] **DB archival / retention for `link_clicks` + `postback_events`.** Chosen approach: **MySQL/MariaDB native partitioning by month + partition-drop** (Option A), given an expected volume in the thousands-to-tens-of-thousands of clicks/day range. Keep a rolling hot window of recent months live; export the retiring month to a file, then drop its partition (near-instant regardless of row count, unlike a bulk `DELETE`).
  - Schema change required: `cid`/`tid` uniqueness constraints must include the partition key (month) — this is a real, permanent schema change, not just a config flip.
  - `link_clicks` and `postback_events` must partition on a coordinated boundary — a click in one month can get a postback the following month, so archiving needs an explicit rule for which month "owns" that pair rather than archiving by raw date alone.
  - Needs a partition-maintenance job that pre-creates future partitions ahead of time. **Safety net required regardless of traffic volume:** if that job ever lags, an `INSERT` on the redirect hot path for a date with no matching partition fails outright — mitigate with either a catch-all `MAXVALUE` partition so inserts never hard-fail, and/or alerting on the maintenance job itself.
  - Archive file format: leaning toward one SQLite file per retired month (still SQL-queryable for rare "what happened last November" lookups) rather than flat CSV, which would need a full reimport to query at all.
  - Complement with a permanent daily rollup/aggregate table (counts per link — clicks, postbacks by event name, device/OS/browser split) so Reports/charts can span beyond the hot window cheaply, without restoring archive files just to draw a trend line.
  - This is archival, not backup — still separately need ordinary off-server DB backups (nightly dump/binlog) of the live hot data, and the archive files themselves need their own backup/off-site copy too.
  - Must coordinate with the Forwarding feature above: don't drop a partition containing records that haven't been forwarded yet on a link with forwarding enabled.

## Future updates

- [ ] Reports: "unique clicks" (unique-visitor counting, distinct from raw click totals) is not currently trackable — no fingerprint/device-ID concept exists beyond the per-click CID. Deferred out of Reports v1; exact definition/format to be requested by the Marketing Team when they need it.
