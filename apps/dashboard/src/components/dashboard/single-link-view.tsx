"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useListQuery } from "@/lib/use-list-query";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/providers/toast-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { CopyButton } from "@/components/ui/copy-button";
import { toTitleCase } from "@/lib/titlecase";
import { ArrowLeftIcon, LinksIcon, EditIcon, ChevronRightIcon, RefreshIcon } from "@/components/icons";
import { ListFooter, SortableTh, SearchInput, MultiSelectFilter } from "@/components/dashboard/list-controls";

const DEVICE_OPTIONS = ["Desktop", "Mobile", "Tablet", "Bot"];
const OS_OPTIONS = ["Windows", "macOS", "Android", "iOS", "Linux", "Unknown"];
const BROWSER_OPTIONS = ["Chrome", "Firefox", "Safari", "Edge", "Opera", "HTTP Client", "Unknown"];

type LinkDetail = {
  id: number;
  type: string;
  slug: string;
  tid: string;
  destination_url: string;
  param_mode: "cid_tid_only" | "pass_all";
  tenant_id: number;
  tenant_name: string;
  campaign_id: number;
  campaign_name: string;
  remarks: string;
  status: "active" | "inactive";
  expires_at: string | null;
  created_at: string;
};

type CampaignOption = { id: number; name: string; tenant_id: number; tenant_name: string };

type PostbackRow = {
  event_name: string;
  extra_fields: Record<string, unknown> | null;
  received_via: string;
  received_at: string;
};

type ClickRow = {
  id: number;
  cid: string;
  ip: string;
  country: string;
  city: string;
  device: string;
  os: string;
  browser: string;
  params: Record<string, unknown> | null;
  clicked_at: string;
  postbacks: PostbackRow[] | null;
};

type AuditLogRow = {
  id: number;
  actor_full_name: string;
  actor_email: string;
  action: string;
  status_code: number;
  changes: Record<string, unknown> | null;
  created_at: string;
};

const PARAM_MODE_OPTIONS = [
  { value: "cid_tid_only", label: "CID and TID Only" },
  { value: "pass_all", label: "Pass All Parameters" },
];

const TABS = ["Overview", "Integration", "History"] as const;
type Tab = (typeof TABS)[number];

function toDatetimeLocal(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getRedirectBaseUrl() {
  return process.env.NEXT_PUBLIC_REDIRECT_BASE_URL ?? "";
}

function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
}

function formatParams(params: Record<string, unknown> | null) {
  if (!params || Object.keys(params).length === 0) return "—";
  return Object.entries(params)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : String(v)}`)
    .join(", ");
}

// The redirect service skips geo lookup for private/loopback IPs (dev/localhost) since
// ip-api.com can't resolve them — show that as "Local Network" rather than "Unknown"
// so it doesn't read as a bug during local testing.
function isPrivateIP(ip: string) {
  return ip === "" || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172.16.") || ip.startsWith("172.17.");
}

export function SingleLinkView({ linkId }: { linkId: number }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const canEdit = user?.permissions["links.edit"] ?? false;
  const canViewHistory = user?.permissions["audit_logs.view"] ?? false;
  const visibleTabs = TABS.filter((t) => t !== "History" || canViewHistory);

  const [link, setLink] = useState<LinkDetail | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("Overview");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expandedCid, setExpandedCid] = useState<string | null>(null);

  const [destinationUrl, setDestinationUrl] = useState("");
  const [paramMode, setParamMode] = useState<"cid_tid_only" | "pass_all">("cid_tid_only");
  const [campaignId, setCampaignId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [remarks, setRemarks] = useState("");

  const clicks = useListQuery<ClickRow>(`/v1/links/${linkId}/clicks`);
  const history = useListQuery<AuditLogRow>("/v1/audit-logs", { entity_type: "link", entity_id: String(linkId) });

  const selectedMerchantName = useMemo(() => campaigns.find((c) => String(c.id) === campaignId)?.tenant_name ?? "", [campaigns, campaignId]);

  async function loadLink() {
    const [linkRes, campaignRes] = await Promise.all([
      api.get<LinkDetail>(`/v1/links/${linkId}`),
      api.get<{ items: CampaignOption[] }>("/v1/campaigns?per_page=200&status=active"),
    ]);
    setLink(linkRes);
    setCampaigns(campaignRes.items);
    setDestinationUrl(linkRes.destination_url);
    setParamMode(linkRes.param_mode);
    setCampaignId(String(linkRes.campaign_id));
    setExpiresAt(toDatetimeLocal(linkRes.expires_at));
    setRemarks(linkRes.remarks);
  }

  useEffect(() => {
    (async () => {
      try {
        await loadLink();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Could not load this link.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const confirmed = await confirm({ title: "Save Changes To This Link?" });
    if (!confirmed) return;
    setSaving(true);
    try {
      await api.patch(`/v1/links/${linkId}`, {
        destination_url: destinationUrl.trim(),
        param_mode: paramMode,
        campaign_id: Number(campaignId),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        remarks: remarks.trim(),
      });
      await loadLink();
      toast.success("Link updated successfully.");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancelEdit() {
    if (!link) return;
    setDestinationUrl(link.destination_url);
    setParamMode(link.param_mode);
    setCampaignId(String(link.campaign_id));
    setExpiresAt(toDatetimeLocal(link.expires_at));
    setRemarks(link.remarks);
    setEditing(false);
  }

  if (loading || !link) {
    return <p className="text-foreground-muted">Loading…</p>;
  }

  const shortUrl = `${getRedirectBaseUrl()}/${link.slug}`;
  const apiBase = getApiBaseUrl();

  return (
    <div id="page-link-single" className="c-single-link">
      <IconButton id="single-link-back" icon={<ArrowLeftIcon />} label="Back" onClick={() => router.push("/links")} />

      <div className="mt-4 flex items-center gap-3">
        <LinksIcon className="text-foreground-muted" />
        <span className="text-lg font-semibold text-foreground">{toTitleCase(link.type)}</span>
        <span
          className={`c-badge inline-flex rounded-full px-2 py-0.5 text-sm font-medium ${
            link.status === "active"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
          }`}
        >
          {toTitleCase(link.status)}
        </span>
      </div>

      <div className="mt-4 flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
        <div>
          <p className="text-md text-foreground-muted">Short Link</p>
          <p className="text-foreground">{shortUrl}</p>
        </div>
        <CopyButton id="single-link-copy" value={shortUrl} />
      </div>

      <div id="single-link-tabs" className="mt-6 flex gap-1 border-b border-border">
        {visibleTabs.map((t) => (
          <button
            key={t}
            id={`single-link-tab-${t.toLowerCase()}`}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium ${tab === t ? "border-b-2 border-accent text-accent" : "text-foreground-muted hover:text-foreground"}`}
          >
            {toTitleCase(t)}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="mt-6 flex flex-col gap-6">
          <div id="single-link-basic-info" className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[20px] leading-7 font-semibold text-foreground">Basic Information</h2>
              {canEdit && !editing && <IconButton id="single-link-edit-toggle" icon={<EditIcon />} label="Edit" onClick={() => setEditing(true)} />}
            </div>

            <form id="single-link-form" onSubmit={handleSave} className="mt-4 flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  id="single-link-destination-url"
                  label="Destination URL"
                  type="url"
                  required
                  disabled={!editing}
                  value={destinationUrl}
                  onChange={(e) => setDestinationUrl(e.target.value)}
                />
                <Select
                  id="single-link-param-mode"
                  label="Original Parameter"
                  disabled={!editing}
                  value={paramMode}
                  onChange={(e) => setParamMode(e.target.value as typeof paramMode)}
                  options={PARAM_MODE_OPTIONS}
                />
                <Select
                  id="single-link-campaign"
                  label="Campaign"
                  required
                  disabled={!editing}
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  options={campaigns.map((c) => ({ value: String(c.id), label: c.name }))}
                />
                <Input id="single-link-merchant" label="Merchant" value={selectedMerchantName} disabled className="cursor-not-allowed" />
                <div className="c-field flex flex-col gap-1">
                  <label htmlFor="single-link-expires-at" className="c-field__label text-md font-medium text-foreground">
                    Expires At (Optional)
                  </label>
                  <input
                    id="single-link-expires-at"
                    type="datetime-local"
                    disabled={!editing}
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <div className="c-field flex flex-col gap-1 md:col-span-2">
                  <label htmlFor="single-link-remarks" className="c-field__label text-md font-medium text-foreground">
                    Remarks (Optional)
                  </label>
                  <textarea
                    id="single-link-remarks"
                    rows={3}
                    disabled={!editing}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </div>
              {editing && (
                <div className="flex gap-2">
                  <Button id="single-link-save" type="submit" variant="primary" disabled={saving}>
                    {saving ? "saving" : "save changes"}
                  </Button>
                  <Button id="single-link-cancel" type="button" variant="ghost" onClick={handleCancelEdit} disabled={saving}>
                    cancel
                  </Button>
                </div>
              )}
            </form>
          </div>

          <div id="single-link-visits" className="c-single-link__visits w-full">
            <div className="flex items-center justify-between">
              <h2 className="text-[20px] leading-7 font-semibold text-foreground">Visits</h2>
              <IconButton id="single-link-visits-refresh" icon={<RefreshIcon />} label="Refresh" onClick={() => clicks.refetch()} />
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <SearchInput id="single-link-visits-search" value={clicks.search} onChange={clicks.setSearch} placeholder="Search event name or extra fields…" />
              <div className="c-field flex flex-col gap-1">
                <label className="c-field__label text-md font-medium text-foreground-muted">Created From</label>
                <input
                  id="single-link-visits-date-from"
                  type="date"
                  value={clicks.filters.date_from ?? ""}
                  onChange={(e) => clicks.setFilter("date_from", e.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
              <div className="c-field flex flex-col gap-1">
                <label className="c-field__label text-md font-medium text-foreground-muted">Created To</label>
                <input
                  id="single-link-visits-date-to"
                  type="date"
                  value={clicks.filters.date_to ?? ""}
                  onChange={(e) => clicks.setFilter("date_to", e.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
              <div className="c-field flex flex-col gap-1">
                <label className="c-field__label text-md font-medium text-foreground-muted">Postback Received From</label>
                <input
                  id="single-link-visits-postback-from"
                  type="date"
                  value={clicks.filters.postback_from ?? ""}
                  onChange={(e) => clicks.setFilter("postback_from", e.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
              <div className="c-field flex flex-col gap-1">
                <label className="c-field__label text-md font-medium text-foreground-muted">Postback Received To</label>
                <input
                  id="single-link-visits-postback-to"
                  type="date"
                  value={clicks.filters.postback_to ?? ""}
                  onChange={(e) => clicks.setFilter("postback_to", e.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
              <MultiSelectFilter
                id="single-link-visits-device-filter"
                label="Device"
                options={DEVICE_OPTIONS}
                value={clicks.filters.device ?? ""}
                onChange={(v) => clicks.setFilter("device", v)}
              />
              <MultiSelectFilter id="single-link-visits-os-filter" label="OS" options={OS_OPTIONS} value={clicks.filters.os ?? ""} onChange={(v) => clicks.setFilter("os", v)} />
              <MultiSelectFilter
                id="single-link-visits-browser-filter"
                label="Browser"
                options={BROWSER_OPTIONS}
                value={clicks.filters.browser ?? ""}
                onChange={(v) => clicks.setFilter("browser", v)}
              />
            </div>

            <div className="mt-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="bg-surface-alt text-foreground-muted">
                  <tr>
                    <th className="w-8 px-2 py-3" />
                    <SortableTh column="clicked_at" label="Timestamp" sort={clicks.sort} dir={clicks.dir} onSort={clicks.toggleSort} />
                    <th className="px-4 py-3 font-medium">CID</th>
                    <th className="px-4 py-3 font-medium">IP</th>
                    <th className="px-4 py-3 font-medium">Country</th>
                    <th className="px-4 py-3 font-medium">City</th>
                    <th className="px-4 py-3 font-medium">Device</th>
                    <th className="px-4 py-3 font-medium">OS</th>
                    <th className="px-4 py-3 font-medium">Browser</th>
                    <th className="px-4 py-3 font-medium">Other Parameters</th>
                  </tr>
                </thead>
                <tbody>
                  {clicks.loading && (
                    <tr>
                      <td colSpan={10} className="px-4 py-6 text-center text-foreground-muted">
                        Loading…
                      </td>
                    </tr>
                  )}
                  {!clicks.loading && clicks.items.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-6 text-center text-foreground-muted">
                        No visits recorded yet.
                      </td>
                    </tr>
                  )}
                  {clicks.items.map((c) => {
                    const local = isPrivateIP(c.ip);
                    const hasPostbacks = (c.postbacks?.length ?? 0) > 0;
                    const expanded = expandedCid === c.cid;
                    return (
                      <Fragment key={c.cid}>
                        <tr className="border-t border-border">
                          <td className="px-2 py-[14px]">
                            {hasPostbacks && (
                              <IconButton
                                id={`single-link-visit-expand-${c.cid}`}
                                icon={<ChevronRightIcon className={expanded ? "rotate-90 transition-transform" : "transition-transform"} />}
                                label={expanded ? "Collapse" : `${c.postbacks?.length} Postback${(c.postbacks?.length ?? 0) > 1 ? "s" : ""}`}
                                onClick={() => setExpandedCid(expanded ? null : c.cid)}
                              />
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-[14px] text-foreground-muted">{new Date(c.clicked_at).toLocaleString()}</td>
                          <td className="px-4 py-[14px] font-mono text-md text-foreground">{c.cid}</td>
                          <td className="px-4 py-[14px] text-foreground">{c.ip || "—"}</td>
                          <td className="px-4 py-[14px] text-foreground">{local ? "Local Network" : c.country || "Unknown"}</td>
                          <td className="px-4 py-[14px] text-foreground">{local ? "—" : c.city || "Unknown"}</td>
                          <td className="px-4 py-[14px] text-foreground">{c.device}</td>
                          <td className="px-4 py-[14px] text-foreground">{c.os}</td>
                          <td className="px-4 py-[14px] text-foreground">{c.browser}</td>
                          <td className="max-w-xs truncate px-4 py-[14px] text-md text-foreground-muted">{formatParams(c.params)}</td>
                        </tr>
                        {expanded && hasPostbacks && (
                          <tr className="border-t border-border bg-surface-alt">
                            <td />
                            <td colSpan={9} className="px-4 py-[14px]">
                              <p className="text-md font-medium text-foreground-muted">Postbacks Received For CID {c.cid}</p>
                              <table className="mt-2 w-full text-left text-md">
                                <thead className="text-foreground-muted">
                                  <tr>
                                    <th className="py-1 pr-4 font-medium">Event</th>
                                    <th className="py-1 pr-4 font-medium">Via</th>
                                    <th className="py-1 pr-4 font-medium">Extra Fields</th>
                                    <th className="py-1 pr-4 font-medium">Received At</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {c.postbacks?.map((p, i) => (
                                    <tr key={i} className="border-t border-border">
                                      <td className="py-1 pr-4 text-foreground">{p.event_name}</td>
                                      <td className="py-1 pr-4 text-foreground-muted">{p.received_via.toUpperCase()}</td>
                                      <td className="py-1 pr-4 text-foreground-muted">{formatParams(p.extra_fields)}</td>
                                      <td className="py-1 pr-4 text-foreground-muted">{new Date(p.received_at).toLocaleString()}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <ListFooter page={clicks.page} perPage={clicks.perPage} total={clicks.total} onPageChange={clicks.setPage} onPerPageChange={clicks.setPerPage} />
            </div>
          </div>
        </div>
      )}

      {tab === "Integration" && (
        <div className="mt-6 flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm text-foreground-muted">
            When a visitor is redirected through this link, a unique <code>cid</code> is generated per click. Your destination site should call the postback URL below
            whenever a trackable event happens (e.g. a purchase), passing back that click&apos;s <code>cid</code>.
          </p>
          <div>
            <p className="mb-1 text-md font-medium text-foreground-muted">GET Request</p>
            <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-md text-emerald-300">
              <code>{`GET ${apiBase}/postback?cid={cid}&tid={tid}&event_name={event_name}`}</code>
            </pre>
          </div>
          <div>
            <p className="mb-1 text-md font-medium text-foreground-muted">POST Request</p>
            <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-md text-emerald-300">
              <code>{`POST ${apiBase}/postback\nContent-Type: application/x-www-form-urlencoded\n\ncid={cid}&tid={tid}&event_name={event_name}`}</code>
            </pre>
          </div>
          <p className="text-md text-foreground-muted">
            <code>{"{cid}"}</code> and <code>{"{tid}"}</code> are placeholders — use the actual values captured on your side from this link&apos;s redirect and this
            page&apos;s Visits table. Any extra fields sent besides cid/tid/event_name are stored and shown against the matching visit above.
          </p>
        </div>
      )}

      {tab === "History" && (
        <div className="mt-6">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-surface-alt text-foreground-muted">
                <tr>
                  <SortableTh column="created_at" label="Timestamp" sort={history.sort} dir={history.dir} onSort={history.toggleSort} />
                  <th className="px-4 py-3 font-medium">Performed By</th>
                  <th className="px-4 py-3 font-medium">Data Changed</th>
                  <SortableTh column="action" label="Action" sort={history.sort} dir={history.dir} onSort={history.toggleSort} />
                  <th className="px-4 py-3 font-medium">Status Code</th>
                </tr>
              </thead>
              <tbody>
                {history.loading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-foreground-muted">
                      Loading…
                    </td>
                  </tr>
                )}
                {!history.loading && history.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-foreground-muted">
                      No actions recorded yet.
                    </td>
                  </tr>
                )}
                {history.items.map((h) => (
                  <tr key={h.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-4 py-3 text-foreground-muted">{new Date(h.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-foreground">
                      {h.actor_full_name || "System"}
                      {h.actor_email && <span className="ml-1 text-md text-foreground-muted">({h.actor_email})</span>}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-md text-foreground-muted">{formatParams(h.changes)}</td>
                    <td className="px-4 py-3 text-foreground">{toTitleCase(h.action.replace(/\./g, " "))}</td>
                    <td className="px-4 py-3 text-foreground">{h.status_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <ListFooter page={history.page} perPage={history.perPage} total={history.total} onPageChange={history.setPage} onPerPageChange={history.setPerPage} />
          </div>
        </div>
      )}
    </div>
  );
}
