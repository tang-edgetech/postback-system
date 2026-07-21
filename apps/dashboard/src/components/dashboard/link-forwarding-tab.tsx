"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/providers/toast-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { useListQuery } from "@/lib/use-list-query";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { RefreshIcon, XIcon } from "@/components/icons";
import { ListFooter, SortableTh } from "@/components/dashboard/list-controls";
import { toTitleCase } from "@/lib/titlecase";

type AuthType = "none" | "bearer" | "basic" | "api_key_header" | "api_key_query";

type ForwardingConfig = {
  link_id: number;
  enabled: boolean;
  endpoint_url: string;
  method: "get" | "post";
  body_format: "url_encoded" | "json";
  auth_type: AuthType;
  auth_username: string;
  auth_param_name: string;
  has_secret: boolean;
  custom_headers: Record<string, string>;
  cap_per_run: number;
  last_run_at: string | null;
  backlog: number;
};

type DeliveryRow = {
  id: number;
  record_type: "lead" | "action";
  record_id: number;
  status: "pending" | "sent" | "failed";
  http_status: number | null;
  attempts: number;
  last_error: string;
  sent_at: string | null;
  updated_at: string;
};

const METHOD_OPTIONS = [
  { value: "post", label: "POST" },
  { value: "get", label: "GET" },
];
const BODY_FORMAT_OPTIONS = [
  { value: "json", label: "JSON" },
  { value: "url_encoded", label: "URL Encoded" },
];
const AUTH_TYPE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
  { value: "api_key_header", label: "API Key (Header)" },
  { value: "api_key_query", label: "API Key (Query Param)" },
];
const CAP_OPTIONS = [10, 25, 50, 100, 150, 200].map((n) => ({ value: String(n), label: String(n) }));

const STATUS_BADGE: Record<DeliveryRow["status"], string> = {
  sent: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  pending: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

export function LinkForwardingTab({ linkId }: { linkId: number }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [config, setConfig] = useState<ForwardingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [endpointUrl, setEndpointUrl] = useState("");
  const [method, setMethod] = useState<"get" | "post">("post");
  const [bodyFormat, setBodyFormat] = useState<"url_encoded" | "json">("json");
  const [authType, setAuthType] = useState<AuthType>("none");
  const [authUsername, setAuthUsername] = useState("");
  const [authSecret, setAuthSecret] = useState("");
  const [authParamName, setAuthParamName] = useState("");
  const [capPerRun, setCapPerRun] = useState("50");
  const [headerRows, setHeaderRows] = useState<{ key: string; value: string }[]>([]);

  const deliveries = useListQuery<DeliveryRow>(`/v1/links/${linkId}/forwarding/deliveries`);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<ForwardingConfig>(`/v1/links/${linkId}/forwarding`);
      setConfig(res);
      setEnabled(res.enabled);
      setEndpointUrl(res.endpoint_url);
      setMethod(res.method);
      setBodyFormat(res.body_format);
      setAuthType(res.auth_type);
      setAuthUsername(res.auth_username);
      setAuthParamName(res.auth_param_name);
      setCapPerRun(String(res.cap_per_run));
      setHeaderRows(Object.entries(res.custom_headers ?? {}).map(([key, value]) => ({ key, value })));
      setAuthSecret("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load forwarding configuration.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const confirmed = await confirm({ title: "Save Forwarding Configuration?" });
    if (!confirmed) return;
    setSaving(true);
    try {
      const customHeaders: Record<string, string> = {};
      headerRows.forEach(({ key, value }) => {
        if (key.trim()) customHeaders[key.trim()] = value;
      });
      const res = await api.patch<ForwardingConfig>(`/v1/links/${linkId}/forwarding`, {
        enabled,
        endpoint_url: endpointUrl.trim(),
        method,
        body_format: bodyFormat,
        auth_type: authType,
        auth_username: authUsername.trim(),
        auth_secret: authSecret,
        auth_param_name: authParamName.trim(),
        custom_headers: customHeaders,
        cap_per_run: Number(capPerRun),
      });
      setConfig(res);
      setAuthSecret("");
      toast.success("Forwarding configuration saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save forwarding configuration.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSendNow() {
    const confirmed = await confirm({
      title: "Send Now?",
      message: "This immediately sends the current backlog (up to the configured cap) to the destination endpoint.",
    });
    if (!confirmed) return;
    setSending(true);
    try {
      const res = await api.post<{ sent: number; failed: number; backlog: number }>(`/v1/links/${linkId}/forwarding/send-now`);
      toast.success(`Sent ${res.sent}, failed ${res.failed}. Backlog remaining: ${res.backlog}.`);
      await load();
      deliveries.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send now.");
    } finally {
      setSending(false);
    }
  }

  function addHeaderRow() {
    setHeaderRows((prev) => [...prev, { key: "", value: "" }]);
  }
  function updateHeaderRow(i: number, field: "key" | "value", value: string) {
    setHeaderRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  }
  function removeHeaderRow(i: number) {
    setHeaderRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  if (loading || !config) {
    return <p className="text-foreground-muted">Loading…</p>;
  }

  const needsUsername = authType === "basic";
  const needsSecret = authType !== "none";
  const needsParamName = authType === "api_key_header" || authType === "api_key_query";

  return (
    <div className="mt-6 flex flex-col gap-6">
      <form id="single-link-forwarding-form" onSubmit={handleSave} className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] leading-7 font-semibold text-foreground">Forwarding Configuration</h2>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input id="single-link-forwarding-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
            Enabled
          </label>
        </div>

        <p className="mt-2 text-md text-foreground-muted">
          Forwards this link&apos;s unsent leads (clicks) and actions (postbacks) to a third-party endpoint. No real-time push — use Send Now below, or wait for the
          once-daily run.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            id="single-link-forwarding-endpoint"
            label="Endpoint URL"
            type="url"
            required
            value={endpointUrl}
            onChange={(e) => setEndpointUrl(e.target.value)}
            placeholder="https://example.com/webhook"
          />
          <Select id="single-link-forwarding-method" label="Method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)} options={METHOD_OPTIONS} />
          <Select
            id="single-link-forwarding-body-format"
            label="Body Format"
            disabled={method === "get"}
            value={bodyFormat}
            onChange={(e) => setBodyFormat(e.target.value as typeof bodyFormat)}
            options={BODY_FORMAT_OPTIONS}
          />
          <Select id="single-link-forwarding-cap" label="Cap Per Run" value={capPerRun} onChange={(e) => setCapPerRun(e.target.value)} options={CAP_OPTIONS} />
          <Select
            id="single-link-forwarding-auth-type"
            label="Authentication"
            value={authType}
            onChange={(e) => setAuthType(e.target.value as AuthType)}
            options={AUTH_TYPE_OPTIONS}
          />
          {needsUsername && <Input id="single-link-forwarding-auth-username" label="Username" value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} />}
          {needsParamName && (
            <Input
              id="single-link-forwarding-auth-param-name"
              label={authType === "api_key_header" ? "Header Name" : "Query Param Name"}
              value={authParamName}
              onChange={(e) => setAuthParamName(e.target.value)}
            />
          )}
          {needsSecret && (
            <Input
              id="single-link-forwarding-auth-secret"
              label={authType === "basic" ? "Password" : "Secret"}
              type="password"
              value={authSecret}
              onChange={(e) => setAuthSecret(e.target.value)}
              placeholder={config.has_secret ? "Leave blank to keep the existing secret" : ""}
            />
          )}
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <p className="text-md font-medium text-foreground-muted">Custom Headers</p>
            <Button id="single-link-forwarding-add-header" type="button" variant="secondary" onClick={addHeaderRow}>
              add header
            </Button>
          </div>
          {headerRows.length === 0 && <p className="mt-1 text-md text-foreground-muted">No custom headers.</p>}
          {headerRows.map((row, i) => (
            <div key={i} className="mt-2 flex items-center gap-2">
              <input
                value={row.key}
                onChange={(e) => updateHeaderRow(i, "key", e.target.value)}
                placeholder="Header Name"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <input
                value={row.value}
                onChange={(e) => updateHeaderRow(i, "value", e.target.value)}
                placeholder="Value"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <IconButton id={`single-link-forwarding-remove-header-${i}`} icon={<XIcon />} label="Remove Header" onClick={() => removeHeaderRow(i)} />
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <Button id="single-link-forwarding-save" type="submit" variant="primary" disabled={saving}>
            {saving ? "saving" : "save changes"}
          </Button>
          <Button id="single-link-forwarding-send-now" type="button" variant="secondary" disabled={sending} onClick={handleSendNow}>
            {sending ? "sending" : "send now"}
          </Button>
        </div>
      </form>

      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[20px] leading-7 font-semibold text-foreground">Delivery Log</h2>
            <p className="text-md text-foreground-muted">
              Current backlog: {config.backlog} unsent record{config.backlog === 1 ? "" : "s"}. Last run:{" "}
              {config.last_run_at ? new Date(config.last_run_at).toLocaleString() : "Never"}.
            </p>
          </div>
          <IconButton id="single-link-forwarding-refresh" icon={<RefreshIcon />} label="Refresh" onClick={() => deliveries.refetch()} />
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="bg-surface-alt text-foreground-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Record Id</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">HTTP Status</th>
                <th className="px-4 py-3 font-medium">Attempts</th>
                <SortableTh column="updated_at" label="Updated At" sort={deliveries.sort} dir={deliveries.dir} onSort={deliveries.toggleSort} />
              </tr>
            </thead>
            <tbody>
              {deliveries.loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-foreground-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!deliveries.loading && deliveries.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-foreground-muted">
                    No delivery attempts yet.
                  </td>
                </tr>
              )}
              {deliveries.items.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-4 py-[14px] text-foreground">{toTitleCase(d.record_type)}</td>
                  <td className="px-4 py-[14px] font-mono text-md text-foreground">{d.record_id}</td>
                  <td className="px-4 py-[14px]">
                    <span className={`c-badge inline-flex rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_BADGE[d.status]}`}>{toTitleCase(d.status)}</span>
                  </td>
                  <td className="px-4 py-[14px] text-foreground-muted">{d.http_status ?? "—"}</td>
                  <td className="px-4 py-[14px] text-foreground-muted">{d.attempts}</td>
                  <td className="whitespace-nowrap px-4 py-[14px] text-foreground-muted">{new Date(d.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <ListFooter page={deliveries.page} perPage={deliveries.perPage} total={deliveries.total} onPageChange={deliveries.setPage} onPerPageChange={deliveries.setPerPage} />
        </div>
      </div>
    </div>
  );
}
