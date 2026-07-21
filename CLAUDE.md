# Postback System — Project Notes

Link-tracking / attribution platform. Three surfaces: public redirect front door, REST API, admin dashboard. Go 1.26 workspace (`go.work`) + Next.js 16 dashboard. MySQL/MariaDB, Redis (Memurai on Windows) for sessions.

## Layout

```
services/redirect/   — babawha.local, hot-path 302 redirect + click logging (port 8081)
services/api/        — babapi.babawha.local, dashboard REST API (port 8082)
apps/dashboard/       — backdash.babawha.local, Next.js admin UI (port 8083)
shared/               — common Go module: db, redisclient, models, session, crypto, permissions, geoip, clientip, totp, idgen, uaparse, audit, httpresp, listquery
migrations/           — hand-applied .sql files (no migration tool wired up — apply with the mysql CLI directly)
```

All three domains are `127.0.0.1` in the hosts file locally, fronted by Apache vhosts (`deploy/apache/`). Dashboard runs in **production mode** (`npm run start`, not `next dev`) to avoid HMR noise.

## Dev environment

- MySQL: `root` / no password, db `postback_system`, DSN `root:@tcp(127.0.0.1:3306)/postback_system?parseTime=true&charset=utf8mb4`
- Redis: `127.0.0.1:6379`
- No hardcoded dev login anymore — the DB was reset and re-seeded through the real Setup Wizard (see below). Super Admin is whatever account/password was created during that run (`dev@babawha.com`, password not recorded here — don't reset it just to test something; verify via unauthenticated endpoints where possible instead).
- Real accounts now exist from that run: `dev@babawha.com` (Super Admin), `admin@babawha.com` (Admin), `marketer@babawha.com` (Marketer), plus real test campaigns/links. Treat this as live data, not disposable fixtures.

## RBAC matrix

Fixed roles: `super_admin`, `admin`, `marketer`. Super Admin always has every permission — it is never stored in `role_permissions`, `permissions.Allowed` short-circuits true for it.

Everything else is driven by the **Settings → Permissions** editor (`role_permissions` table, keys in `shared/permissions/permissions.go`), enforced server-side via `middleware.RequirePermission`. Seed defaults (migration 0004, links.status/links.delete for Marketer flipped off by migration 0007):
- Admin: full access to everything except other Admins/Super Admins (Users routes additionally hard-restrict Admin to Marketers **it created** — see `canActorMutateTarget` in `services/api/internal/handler/users.go`).
- Marketer: can create+edit Merchants/Campaigns/Links but not status-change/delete any of the three (Merchants, Campaigns, or Links — Links used to be on by default, matching pre-RBAC legacy behavior, but that's since been reversed).

Frontend gets its own effective permission map inline on `/v1/auth/login` and `/v1/auth/me` (`user.permissions`, a flat `{ "merchants.create": true, ... }` map) — this is how page components decide which buttons to render. Marketer/Admin `GET /v1/settings/permissions` (the full editable matrix) is Super-Admin-only.

Prefer reusing an existing permission key over inventing a new one when gating a new piece of UI — e.g. the Links page's History tab is gated on the pre-existing `audit_logs.view` key (`shared/permissions/permissions.go`) rather than a new `links.history` key, since it's semantically the same access (Super Admin/Admin by default, editable in Settings → Permissions).

## Data model notes

- **Campaign → Merchant is 1:1** (`campaigns.tenant_id`). A Link's Merchant is *derived* from its Campaign — `links` has no `tenant_id` of its own (dropped in migration 0004). Never add it back; join through `campaigns.tenant_id` instead.
- **CID** is unique per redirect click (`link_clicks.cid`), minted fresh on every `/{slug}` hit. **TID** is fixed per Link. Postbacks (`postback_events`) are always recorded against a specific `link_click_id` — the Visits table on the Single Link page nests postbacks under their originating click row, not as a separate flat list.
- Geo lookups (`shared/geoip`, backed by the free ip-api.com, no key) are skipped for private/loopback IPs — expect "Unknown"/"Local Network" everywhere during local dev; this resolves itself with real public IPs in production.
- **Device/OS/Browser** are parsed once at redirect time (`shared/uaparse.Parse`, called in `services/redirect/cmd/redirect/main.go`) and stored as real columns on `link_clicks` (migration `0005_click_device_columns`), not re-parsed from the raw `user_agent` on every API read. This is what makes them filterable/indexable on the Visits table (`services/api/internal/handler/links.go`'s `Clicks` handler, `inClause` helper). If you add another UA-derived field, follow the same write-time pattern rather than parsing at read time.
- The postback receiver is reachable at both `/v1/postback` and an unversioned `/postback` alias (`services/api/cmd/api/main.go`) — the alias is what's shown to merchants/dashboard users (Integration tab) so the URL stays short and stable even if `/v1` ever becomes `/v2`. Keep both routes wired to the same `postback.Handle`.

## 2FA model

Trusted-device TOTP, not classic always-prompt TOTP: a shared secret (`two_factor_secrets`) verifies the code once per browser, then that browser is remembered in `trusted_devices` (capped at 2 per user — remove one via Profile to add a new one). Login flow: password → if 2FA enrolled and no matching trusted-device cookie (`pb_device`), returns `{two_fa_required, pending_token}` instead of a session → `POST /v1/auth/verify-2fa` with the TOTP code completes login and (if under the device cap) trusts the browser.

## Setup Wizard & top-level routing

First run is gated purely on `SELECT COUNT(*) FROM users` (`services/api/internal/handler/setup.go`'s `needsSetup`) — no separate "setup done" flag to drift out of sync. `GET /v1/setup/status` (public) reports `{needs_setup, available_regions}`; `POST /v1/setup/complete` (public, re-checks `needsSetup` server-side before mutating) creates the `settings` row's site fields + the first user as Super Admin (`role_id=1`), then logs the caller straight in.

- `apps/dashboard/src/app/page.tsx` does not exist — root `/` is a plain Next.js 404, intentionally. Don't re-add a root page/redirect there.
- `GuestOnly` (wraps `/login`) redirects to `/setup` if `needsSetup`, else to `/dashboard` if already authenticated.
- `SetupOnly` (wraps `/setup`) redirects to `/login` once `needsSetup` is false.
- Both guards read from `SetupProvider` (`apps/dashboard/src/components/providers/setup-provider.tsx`), which fetches `/v1/setup/status` once on mount; the wizard calls its `markComplete()` after a successful submit so the guards flip without a hard refresh.
- Deleting a page file under `app/` can leave a stale `.next` type-validator cache (`Cannot find module '.../page.js'` on next build) — `rm -rf .next` before rebuilding if that happens.

## Media / branding

Logo/favicon are direct upload-and-replace (`/v1/settings/logo`, `/v1/settings/favicon`, files under `services/api`'s `UPLOAD_DIR`, served back at `/uploads/...`) — no browsable media library. `GET /v1/settings/public` (no auth) exposes just site_title/logo/favicon/discourage_indexing for the Login page and sidebar to brand themselves before/without a session.

## Known gaps / deliberately out of scope so far

- Fraud detection (velocity limits, bot-UA/datacenter-IP lists) not implemented — redirect hot path has no fraud checks yet.
- Redirect click-logging is a synchronous per-request insert, not the batched/Redis-Stream durability tier discussed for high volume — fine at current scale, revisit before a real traffic push.
- No "disable 2FA" self-service action once enrolled (can manage trusted devices, can't turn 2FA off from the UI).

## UI conventions learned the hard way

- `SortableTh` (`apps/dashboard/src/components/dashboard/list-controls.tsx`) always renders a caret-down icon on every sortable column header (muted when inactive, accent + flipped when active/ascending) — this is deliberate so users can tell a header is clickable before they've sorted by it. Keep new sortable columns consistent with this, don't go back to icon-only-when-active.
- Auto-titlecase on the shared `<Button>`/`<Label>`/`<Option>` primitives (`lib/titlecase.ts`) only fires when the element's children is a single string. `<Button>add {slug}</Button>` silently breaks this because JSX splits it into two sibling children (text node + expression), not one string — collapse to a single template literal (`{`add ${slug}`}`) whenever a Button/Label wraps an interpolated value.
- `MultiSelectFilter` (`list-controls.tsx`) is the reusable pattern for "filter by one or more of these values" (checkbox popover, comma-joined value, click-outside-to-close via a ref) — reuse it rather than building a bespoke dropdown for the next multi-value filter.
