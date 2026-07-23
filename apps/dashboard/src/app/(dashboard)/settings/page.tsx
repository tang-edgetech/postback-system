"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/providers/toast-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { toTitleCase } from "@/lib/titlecase";
import { UploadIcon } from "@/components/icons";
import { permissions as PERMISSION_KEYS, ROLE_COLUMNS, formatPermissionKey } from "@/lib/permissions";
import { EntityMultiSelect } from "@/components/dashboard/entity-multi-select";
import { TabBar } from "@/components/dashboard/tab-bar";

type SettingsData = {
  site_title: string;
  site_url: string;
  region: string;
  language: string;
  available_regions: string[];
  discourage_indexing: boolean;
  login_path: string;
  logo_path: string;
  favicon_path: string;
  cloudflare_configured: boolean;
};

function getDashboardBaseUrl() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

type PermissionsMatrix = Record<string, Record<string, boolean>>;

type AuthTypeSetting = { enabled_globally: boolean; link_ids: number[] };
type AuthScope = "off" | "all" | "specific";
type AuthTypeState = { scope: AuthScope; link_ids: number[] };
const ADVANCED_AUTH_TYPES = [
  { key: "hmac", label: "HMAC-Signed Requests" },
  { key: "oauth2_client_credentials", label: "OAuth2 Client Credentials" },
] as const;

function toAuthTypeState(setting: AuthTypeSetting | undefined): AuthTypeState {
  if (!setting) return { scope: "off", link_ids: [] };
  if (setting.enabled_globally) return { scope: "all", link_ids: [] };
  if (setting.link_ids.length > 0) return { scope: "specific", link_ids: setting.link_ids };
  return { scope: "off", link_ids: [] };
}

function toAuthTypeSetting(state: AuthTypeState): AuthTypeSetting {
  return { enabled_globally: state.scope === "all", link_ids: state.scope === "specific" ? state.link_ids : [] };
}

function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
}

const LANGUAGE_OPTIONS = [{ value: "EN", label: "English" }];
const TABS = ["General", "SEO", "Permissions", "Authentication", "Cloudflare"] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("General");
  const [data, setData] = useState<SettingsData | null>(null);
  const [saving, setSaving] = useState(false);

  const [general, setGeneral] = useState({ site_title: "", site_url: "", region: "GMT+8", language: "EN", login_path: "login" });
  const [discourageIndexing, setDiscourageIndexing] = useState(true);
  const [cfToken, setCfToken] = useState("");
  const [cfZone, setCfZone] = useState("");
  const [clearingCache, setClearingCache] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const [matrix, setMatrix] = useState<PermissionsMatrix | null>(null);
  const [savingPermissions, setSavingPermissions] = useState(false);

  const [authTypes, setAuthTypes] = useState<Record<string, AuthTypeState> | null>(null);
  const [savingAuth, setSavingAuth] = useState(false);

  async function loadSettings() {
    try {
      const result = await api.get<SettingsData>("/v1/settings");
      setData(result);
      setGeneral({ site_title: result.site_title, site_url: result.site_url, region: result.region, language: result.language, login_path: result.login_path });
      setDiscourageIndexing(result.discourage_indexing);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load settings.");
    }
  }

  useEffect(() => {
    if (user?.role !== "super_admin") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    (async () => {
      try {
        await loadSettings();
        const permRes = await api.get<{ matrix: PermissionsMatrix }>("/v1/settings/permissions");
        setMatrix(permRes.matrix);
        const authRes = await api.get<Record<string, AuthTypeSetting>>("/v1/settings/authentication");
        setAuthTypes(
          Object.fromEntries(ADVANCED_AUTH_TYPES.map(({ key }) => [key, toAuthTypeState(authRes[key])])),
        );
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  if (user?.role !== "super_admin") {
    return (
      <div id="page-settings" className="c-settings">
        <h1 className="c-settings__title text-[26px] leading-8 font-semibold text-foreground">Settings</h1>
        <p className="mt-2 text-foreground-muted">This section is only available to Super Admins.</p>
      </div>
    );
  }

  async function handleSaveGeneral(e: React.FormEvent) {
    e.preventDefault();
    const loginPathChanged = data && general.login_path !== data.login_path;
    const confirmed = await confirm(
      loginPathChanged
        ? {
            title: "Change The Login Page URL?",
            message: `The login page will move to ${getDashboardBaseUrl()}/${general.login_path} — the old URL will stop working immediately for everyone, including you. Make sure you've noted the new one before continuing.`,
            confirmLabel: "Change Login URL",
            tone: "danger",
          }
        : { title: "Update General Settings?", message: "These changes apply site-wide." },
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      await api.patch("/v1/settings/general", general);
      toast.success("Settings updated successfully.");
      await loadSettings();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadFile(kind: "logo" | "favicon", file: File) {
    const setUploading = kind === "logo" ? setUploadingLogo : setUploadingFavicon;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${getApiBaseUrl()}/v1/settings/${kind}`, { method: "POST", credentials: "include", body: form });
      const body = await res.json();
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error?.message ?? "Upload failed");
      }
      toast.success(`${toTitleCase(kind)} updated successfully.`);
      await loadSettings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveSeo(e: React.FormEvent) {
    e.preventDefault();
    const confirmed = await confirm({ title: "Update SEO Settings?" });
    if (!confirmed) return;
    setSaving(true);
    try {
      await api.patch("/v1/settings/seo", { discourage_indexing: discourageIndexing });
      toast.success("SEO settings updated successfully.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCloudflare(e: React.FormEvent) {
    e.preventDefault();
    const confirmed = await confirm({ title: "Update Cloudflare Credentials?", message: "The API token and zone ID will be encrypted at rest." });
    if (!confirmed) return;
    setSaving(true);
    try {
      await api.patch("/v1/settings/cloudflare", { api_token: cfToken, zone_id: cfZone });
      toast.success("Cloudflare credentials updated successfully.");
      setCfToken("");
      setCfZone("");
      setData((prev) => (prev ? { ...prev, cloudflare_configured: true } : prev));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function handleClearCache() {
    const confirmed = await confirm({ title: "Clear Cloudflare Cache?", message: "This purges the entire cache for the configured zone.", tone: "danger", confirmLabel: "Clear Cache" });
    if (!confirmed) return;
    setClearingCache(true);
    try {
      await api.post("/v1/settings/cloudflare/clear-cache");
      toast.success("Cache cleared successfully.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setClearingCache(false);
    }
  }

  function toggleMatrix(role: "admin" | "marketer", key: string) {
    setMatrix((prev) => {
      if (!prev) return prev;
      return { ...prev, [role]: { ...prev[role], [key]: !prev[role][key] } };
    });
  }

  async function handleSavePermissions() {
    if (!matrix) return;
    const confirmed = await confirm({ title: "Update Permissions?", message: "This changes what Admins and Marketers can do across the whole system." });
    if (!confirmed) return;
    setSavingPermissions(true);
    try {
      await api.patch("/v1/settings/permissions", { roles: { admin: matrix.admin, marketer: matrix.marketer } });
      toast.success("Permissions updated successfully.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSavingPermissions(false);
    }
  }

  function setAuthType(key: string, patch: Partial<AuthTypeState>) {
    setAuthTypes((prev) => (prev ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
  }

  async function handleSaveAuthentication() {
    if (!authTypes) return;
    const confirmed = await confirm({
      title: "Update Authentication Settings?",
      message: "This changes which advanced auth types are available in Links > Forwarding.",
    });
    if (!confirmed) return;
    setSavingAuth(true);
    try {
      const body = Object.fromEntries(Object.entries(authTypes).map(([key, state]) => [key, toAuthTypeSetting(state)]));
      await api.patch("/v1/settings/authentication", body);
      toast.success("Authentication settings updated successfully.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSavingAuth(false);
    }
  }

  return (
    <div id="page-settings" className="c-settings max-w-3xl">
      <h1 className="c-settings__title text-[26px] leading-8 font-semibold text-foreground">Settings</h1>

      <div className="c-settings__tabs mt-4">
        <TabBar id="settings-tabs" tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {loading ? (
        <p className="mt-4 text-foreground-muted">Loading…</p>
      ) : (
        <div className="mt-6">
          {tab === "General" && (
            <form id="settings-general-form" onSubmit={handleSaveGeneral} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              <Input id="settings-site-title" label="Site Title" required value={general.site_title} onChange={(e) => setGeneral({ ...general, site_title: e.target.value })} />
              <Input id="settings-site-url" label="Site URL" value={general.site_url} onChange={(e) => setGeneral({ ...general, site_url: e.target.value })} placeholder="Captured automatically unless set" />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="c-field flex flex-col gap-1">
                  <span className="c-field__label text-md font-medium text-foreground">Logo</span>
                  <div className="flex items-center gap-3">
                    {data?.logo_path ? (
                      <img src={`${getApiBaseUrl()}${data.logo_path}`} alt="Logo" className="h-10 w-auto rounded border border-border bg-white p-1" />
                    ) : (
                      <span className="text-md text-foreground-muted">No logo uploaded</span>
                    )}
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml,image/webp"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && uploadFile("logo", e.target.files[0])}
                    />
                    <IconButton
                      id="settings-logo-upload"
                      icon={<UploadIcon />}
                      label={uploadingLogo ? "Uploading" : "Upload New Logo"}
                      disabled={uploadingLogo}
                      onClick={() => logoInputRef.current?.click()}
                    />
                  </div>
                </div>
                <div className="c-field flex flex-col gap-1">
                  <span className="c-field__label text-md font-medium text-foreground">Favicon</span>
                  <div className="flex items-center gap-3">
                    {data?.favicon_path ? (
                      <img src={`${getApiBaseUrl()}${data.favicon_path}`} alt="Favicon" className="h-8 w-8 rounded border border-border bg-white p-1" />
                    ) : (
                      <span className="text-md text-foreground-muted">No favicon uploaded</span>
                    )}
                    <input
                      ref={faviconInputRef}
                      type="file"
                      accept="image/png,image/x-icon,image/svg+xml,image/webp"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && uploadFile("favicon", e.target.files[0])}
                    />
                    <IconButton
                      id="settings-favicon-upload"
                      icon={<UploadIcon />}
                      label={uploadingFavicon ? "Uploading" : "Upload New Favicon"}
                      disabled={uploadingFavicon}
                      onClick={() => faviconInputRef.current?.click()}
                    />
                  </div>
                </div>
              </div>

              <Select
                id="settings-region"
                label="Region"
                value={general.region}
                onChange={(e) => setGeneral({ ...general, region: e.target.value })}
                options={(data?.available_regions ?? ["GMT+8"]).map((r) => ({ value: r, label: r }))}
              />
              <Select id="settings-language" label="Language" value={general.language} onChange={(e) => setGeneral({ ...general, language: e.target.value })} options={LANGUAGE_OPTIONS} />

              <Input
                id="settings-login-path"
                label="Login Path"
                required
                pattern="[a-z0-9-]{3,64}"
                value={general.login_path}
                onChange={(e) => setGeneral({ ...general, login_path: e.target.value.toLowerCase() })}
              />
              <p className="-mt-2 text-md text-foreground-muted">
                The login page will be reachable at <code>{`${getDashboardBaseUrl()}/${general.login_path || "login"}`}</code>. The default{" "}
                <code>/login</code> stops working the moment this is changed to anything else — lowercase letters, numbers and hyphens only, and it
                can&apos;t collide with an existing page name (e.g. <code>dashboard</code>, <code>settings</code>).
              </p>

              <div>
                <Button id="settings-general-save" type="submit" variant="primary" disabled={saving}>
                  {saving ? "saving" : "save changes"}
                </Button>
              </div>
            </form>
          )}

          {tab === "SEO" && (
            <form id="settings-seo-form" onSubmit={handleSaveSeo} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              <p className="text-sm text-foreground-muted">
                This is an internal tool — there&apos;s no reason for search engines to index it. Leave this on to emit <code>noindex, nofollow</code> and a disallow-all
                <code> robots.txt</code>.
              </p>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  id="settings-discourage-indexing"
                  type="checkbox"
                  checked={discourageIndexing}
                  onChange={(e) => setDiscourageIndexing(e.target.checked)}
                  className="h-4 w-4"
                />
                Discourage Search Engines From Indexing This Site
              </label>
              <div>
                <Button id="settings-seo-save" type="submit" variant="primary" disabled={saving}>
                  {saving ? "saving" : "save changes"}
                </Button>
              </div>
            </form>
          )}

          {tab === "Permissions" && matrix && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-foreground-muted">Control what Admins and Marketers are allowed to do. Super Admin always has full access.</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="bg-surface-alt text-foreground-muted">
                    <tr>
                      <th className="px-4 py-3 font-medium">Permission</th>
                      {ROLE_COLUMNS.map((role) => (
                        <th key={role} className="px-4 py-3 text-center font-medium">
                          {toTitleCase(role.replace("_", " "))}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PERMISSION_KEYS.map((key) => (
                      <tr key={key} className="border-t border-border">
                        <td className="px-4 py-3 text-foreground">{formatPermissionKey(key)}</td>
                        <td className="px-4 py-3 text-center">
                          <input type="checkbox" checked readOnly disabled className="h-4 w-4 opacity-60" />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            id={`perm-admin-${key}`}
                            type="checkbox"
                            checked={matrix.admin?.[key] ?? false}
                            onChange={() => toggleMatrix("admin", key)}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            id={`perm-marketer-${key}`}
                            type="checkbox"
                            checked={matrix.marketer?.[key] ?? false}
                            onChange={() => toggleMatrix("marketer", key)}
                            className="h-4 w-4"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <Button id="settings-permissions-save" type="button" variant="primary" onClick={handleSavePermissions} disabled={savingPermissions}>
                  {savingPermissions ? "saving" : "save changes"}
                </Button>
              </div>
            </div>
          )}

          {tab === "Authentication" && authTypes && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-foreground-muted">
                Advanced auth types for Links &gt; Forwarding are hidden by default. Turn one on for every Link, or just a specific allowlist.
              </p>
              {ADVANCED_AUTH_TYPES.map(({ key, label }) => {
                const state = authTypes[key];
                return (
                  <div key={key} id={`auth-type-${key}`} className="rounded-lg border border-border bg-surface p-4">
                    <h3 className="text-[16px] leading-5 font-semibold text-foreground">{label}</h3>
                    <div className="mt-3 flex flex-wrap gap-4">
                      {(["off", "all", "specific"] as const).map((scope) => (
                        <label key={scope} className="flex items-center gap-2 text-sm text-foreground">
                          <input
                            type="radio"
                            name={`auth-type-${key}-scope`}
                            checked={state.scope === scope}
                            onChange={() => setAuthType(key, { scope })}
                            className="h-4 w-4"
                          />
                          {scope === "off" ? "Off" : scope === "all" ? "All Links" : "Specific Links"}
                        </label>
                      ))}
                    </div>
                    {state.scope === "specific" && (
                      <div className="mt-3">
                        <EntityMultiSelect
                          id={`auth-type-${key}-links`}
                          fetchPath="/v1/links"
                          labelKey="slug"
                          selected={state.link_ids}
                          onChange={(link_ids) => setAuthType(key, { link_ids })}
                          placeholder="Search links by slug…"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              <div>
                <Button id="settings-authentication-save" type="button" variant="primary" onClick={handleSaveAuthentication} disabled={savingAuth}>
                  {savingAuth ? "saving" : "save changes"}
                </Button>
              </div>
            </div>
          )}

          {tab === "Cloudflare" && (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-border bg-surface p-4">
                <span
                  className={`c-badge inline-flex rounded-full px-2 py-0.5 text-sm font-medium ${
                    data?.cloudflare_configured
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {data?.cloudflare_configured ? "Configured" : "Not Configured"}
                </span>
              </div>

              <form id="settings-cloudflare-form" onSubmit={handleSaveCloudflare} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
                <PasswordInput
                  id="settings-cf-token"
                  label="Cloudflare API Token"
                  value={cfToken}
                  onChange={(e) => setCfToken(e.target.value)}
                  placeholder={data?.cloudflare_configured ? "•••••••••••• (unchanged)" : ""}
                />
                <PasswordInput
                  id="settings-cf-zone"
                  label="Zone ID"
                  value={cfZone}
                  onChange={(e) => setCfZone(e.target.value)}
                  placeholder={data?.cloudflare_configured ? "•••••••••••• (unchanged)" : ""}
                />
                <div>
                  <Button id="settings-cloudflare-save" type="submit" variant="primary" disabled={saving || !cfToken || !cfZone}>
                    {saving ? "saving" : "save credentials"}
                  </Button>
                </div>
              </form>

              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-sm text-foreground-muted">Purge the entire Cloudflare cache for the configured zone.</p>
                <div className="mt-3">
                  <Button id="settings-clear-cache" variant="danger" onClick={handleClearCache} disabled={clearingCache || !data?.cloudflare_configured}>
                    {clearingCache ? "clearing" : "clear cache"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
