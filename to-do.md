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

- [x] **Links > Single Link: "Forwarding" tab.** Built — `apps/dashboard/src/components/dashboard/link-forwarding-tab.tsx`, `services/api/internal/handler/forwarding.go`, `shared/forwarding/`, `migrations/0008_link_forwarding.up.sql`. One forwarding rule per link; "Send Now" (`POST /v1/links/{id}/forwarding/send-now`) is live end-to-end; the once-daily sweep runs in the new `services/worker` binary (plain in-process daily loop, not a cron library — simpler and needs no new Go dependency). Cap per run is selectable (10/25/50/100/150/200); leads (clicks) and actions (postbacks) share one oldest-first queue per link. POST+JSON batches every record from that run into one call; GET or POST+url-encoded send one call per record. SSRF guard (`forwarding.ValidateEndpoint`) blocks private/loopback/link-local targets, checked both on save and again right before every send. Delivery log lives in the same tab (`GET /v1/links/{id}/forwarding/deliveries`), backed by `link_forwarding_deliveries`.
  - Gated on the `links.forwarding` permission key (Admin on by default, Marketer off — editable in Settings → Permissions, same convention as everything else).
  - Auth types implemented: None / Bearer Token / Basic Auth / API Key (header) / API Key (query param), secret encrypted at rest via the existing `shared/crypto` AES-GCM helper, never returned in API responses (`has_secret` boolean only).
  - **Still not built:** the advanced HMAC-signed / OAuth2 client-credentials auth types — Settings → Authentication already has the global-toggle + per-link-allowlist infra for unlocking them (migration 0006), but the actual signing/token-fetch logic and the Forwarding config UI's advanced auth options are a separate follow-up (HMAC needs a signing convention; OAuth2 needs a token fetch/cache/refresh cycle).
  - Must still coordinate with the archival feature below once that's built: don't archive a click/postback that hasn't been forwarded yet on a link with forwarding enabled.

- [x] **Reports feature.** Built — `apps/dashboard/src/app/(dashboard)/reports/page.tsx`, `services/api/internal/handler/reports.go`, `migrations/0009_reports_permission.up.sql`. Marketing team still hasn't finalized the exact metrics they want — treat what's live as a v1 candidate set, not a locked spec.
  - Access gated on the `reports.view` permission key (Admin on by default, Marketer off). Marketer scoping reuses `user_entity_grants` (migration 0006) + `campaigns.created_by`/`tenants.created_by` — sees only campaigns it created or has been explicitly granted, resolved in `visibleCampaignIDs` in `reports.go`.
  - Filters: Merchant(s)/Campaign(s) (checkbox multi-select), Link IDs (comma-separated), Device/OS/Browser, link status, postback event name(s), geo country/region, date range. A custom From/To date pair overrides the preset entirely.
  - Date-range presets: 7d/2w/1m/3m for everyone with access; Super Admin/Admin additionally get `quarter` (current calendar quarter), `semiannual` (trailing 6mo), `annual` (trailing 12mo). Boundaries computed in the site's configured `region` offset (fixed-hour arithmetic — regions here are plain `GMT+N` with no DST, so no MySQL named-timezone dependency), not UTC.
  - **Note carried forward:** the advanced presets still read straight from raw `link_clicks`/`postback_events` — fine at current scale, but once the archival/partition-drop feature below ships, those longer ranges will need to move to the permanent rollup table instead.
  - Metrics live: total clicks/postbacks, conversion rate per postback event name, daily click/postback trend (line chart), Device/OS/Browser breakdown % (pie charts), top-10 links by clicks (bar chart). Fraud-rejected/expired-postback-rejected counts are still not trackable (blocked on fraud detection + postback-rejection logging, both still unbuilt).
  - Charts via `recharts` (new dependency) — pie/bar/line, on-screen only, same filters as the export.
  - Export: CSV of the underlying filtered raw click rows, same `Content-Disposition` pattern as `/v1/audit-logs/export`.
  - "Unique clicks" is still out of scope — see Future Updates below.

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
