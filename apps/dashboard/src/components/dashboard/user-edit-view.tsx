"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { useToast } from "@/components/providers/toast-provider";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { toTitleCase } from "@/lib/titlecase";
import { ArrowLeftIcon } from "@/components/icons";
import { permissions as PERMISSION_KEYS, formatPermissionKey } from "@/lib/permissions";
import { EntityMultiSelect } from "@/components/dashboard/entity-multi-select";

type Role = "super_admin" | "admin" | "marketer";
type UserDetail = {
  id: number;
  full_name: string;
  email: string;
  role: Role;
  status: "active" | "inactive";
  theme: string;
  created_by: number;
};

type LoginSessionRow = {
  id: number;
  ip: string;
  country: string;
  city: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
};

const ROLE_OPTIONS = [
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "marketer", label: "Marketer" },
];

type OverrideChoice = "default" | "allow" | "deny";

type PermissionOverridesResponse = {
  keys: string[];
  role_defaults: Record<string, boolean>;
  overrides: Record<string, boolean>;
};

type EntityGrantsResponse = {
  tenant_ids: number[];
  campaign_ids: number[];
};

export function UserEditView({ userId }: { userId: number }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user: actor } = useAuth();

  const [target, setTarget] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("marketer");
  const [sessions, setSessions] = useState<LoginSessionRow[]>([]);

  const [roleDefaults, setRoleDefaults] = useState<Record<string, boolean>>({});
  const [overrideChoices, setOverrideChoices] = useState<Record<string, OverrideChoice>>({});
  const [savingOverrides, setSavingOverrides] = useState(false);

  const [tenantIds, setTenantIds] = useState<number[]>([]);
  const [campaignIds, setCampaignIds] = useState<number[]>([]);
  const [savingGrants, setSavingGrants] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);

  const canMutate = Boolean(
    target &&
      actor &&
      (actor.role === "super_admin" || (actor.role === "admin" && target.role === "marketer" && target.created_by === actor.id)) &&
      target.id !== actor.id,
  );
  const availableRoleOptions = actor?.role === "admin" ? ROLE_OPTIONS.filter((o) => o.value !== "super_admin") : ROLE_OPTIONS;

  useEffect(() => {
    (async () => {
      try {
        const u = await api.get<UserDetail>(`/v1/users/${userId}`);
        setTarget(u);
        setFullName(u.full_name);
        setRole(u.role);
        if (actor?.role === "super_admin") {
          const res = await api.get<{ items: LoginSessionRow[] }>(`/v1/users/${userId}/sessions`);
          setSessions(res.items);
        }
        const canMutateFetched = Boolean(
          actor && (actor.role === "super_admin" || (actor.role === "admin" && u.role === "marketer" && u.created_by === actor.id)) && u.id !== actor.id,
        );
        if (canMutateFetched) {
          const perms = await api.get<PermissionOverridesResponse>(`/v1/users/${userId}/permission-overrides`);
          setRoleDefaults(perms.role_defaults);
          setOverrideChoices(
            Object.fromEntries(
              perms.keys.map((key) => [key, key in perms.overrides ? (perms.overrides[key] ? "allow" : "deny") : "default"]),
            ),
          );
          const grants = await api.get<EntityGrantsResponse>(`/v1/users/${userId}/entity-grants`);
          setTenantIds(grants.tenant_ids);
          setCampaignIds(grants.campaign_ids);
        }
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Could not load this user.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const confirmed = await confirm({ title: "Save Changes To This User?" });
    if (!confirmed) return;
    setSaving(true);
    try {
      await api.patch(`/v1/users/${userId}`, { full_name: fullName.trim(), role });
      toast.success("User updated successfully.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    const confirmed = await confirm({ title: "Reset This User's Password?", message: `${target?.full_name} will need to use the new password next time they log in.` });
    if (!confirmed) return;
    setResettingPassword(true);
    try {
      await api.patch(`/v1/users/${userId}/password`, { new_password: newPassword });
      toast.success("Password reset successfully.");
      setNewPassword("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setResettingPassword(false);
    }
  }

  async function handleSaveOverrides() {
    const confirmed = await confirm({ title: "Save Permission Overrides?", message: "This changes what this specific user can do, on top of their role's defaults." });
    if (!confirmed) return;
    setSavingOverrides(true);
    try {
      const overrides = Object.fromEntries(
        Object.entries(overrideChoices).map(([key, choice]) => [key, choice === "default" ? null : choice === "allow"]),
      );
      await api.patch(`/v1/users/${userId}/permission-overrides`, { overrides });
      toast.success("Permission overrides updated successfully.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSavingOverrides(false);
    }
  }

  async function handleSaveGrants() {
    const confirmed = await confirm({ title: "Save Access Grants?", message: "This changes which Merchants/Campaigns this user can see in Reports." });
    if (!confirmed) return;
    setSavingGrants(true);
    try {
      await api.patch(`/v1/users/${userId}/entity-grants`, { tenant_ids: tenantIds, campaign_ids: campaignIds });
      toast.success("Access grants updated successfully.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSavingGrants(false);
    }
  }

  if (loading || !target) {
    return <p className="text-foreground-muted">Loading…</p>;
  }

  return (
    <div id="page-user-edit" className="c-user-edit w-full">
      <IconButton id="user-edit-back" icon={<ArrowLeftIcon />} label="Back" onClick={() => router.push("/users")} />

      <div className="mt-4 flex items-center gap-3">
        <h1 className="text-[20px] leading-7 font-semibold text-foreground">{target.full_name}</h1>
        <span
          className={`c-badge inline-flex rounded-full px-2 py-0.5 text-sm font-medium ${
            target.status === "active"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
          }`}
        >
          {toTitleCase(target.status)}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-[20px] leading-7 font-semibold text-foreground">Basic Information</h2>
          <form id="user-edit-form" onSubmit={handleSave} className="mt-4 grid grid-cols-1 gap-4">
            <Input id="user-edit-fullname" label="Full Name" required disabled={!canMutate} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <Input id="user-edit-email" label="Email" value={target.email} disabled className="cursor-not-allowed" />
            <Select
              id="user-edit-role"
              label="Role"
              disabled={!canMutate}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              options={availableRoleOptions}
            />
            {canMutate && (
              <div>
                <Button id="user-edit-save" type="submit" variant="primary" disabled={saving}>
                  {saving ? "saving" : "save changes"}
                </Button>
              </div>
            )}
          </form>
        </div>

        {canMutate && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-[20px] leading-7 font-semibold text-foreground">Reset Password</h2>
            <p className="text-md text-foreground-muted">Directly set a new password for this user — no current password required.</p>
            <form id="user-edit-password-form" onSubmit={handleResetPassword} className="mt-4 grid grid-cols-1 gap-4">
              <PasswordInput id="user-edit-new-password" label="New Password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <div>
                <Button id="user-edit-reset-password" type="submit" variant="primary" disabled={resettingPassword || newPassword.length < 8}>
                  {resettingPassword ? "resetting" : "reset password"}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>

      {canMutate && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-[20px] leading-7 font-semibold text-foreground">Permission Overrides</h2>
          <p className="text-md text-foreground-muted">On top of {toTitleCase(target.role.replace("_", " "))}&apos;s role defaults from Settings &gt; Permissions — override any capability just for this user.</p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-surface-alt text-foreground-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Permission</th>
                  <th className="px-4 py-3 text-center font-medium">Default</th>
                  <th className="px-4 py-3 text-center font-medium">Allow</th>
                  <th className="px-4 py-3 text-center font-medium">Deny</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSION_KEYS.map((key) => (
                  <tr key={key} className="border-t border-border">
                    <td className="px-4 py-3 text-foreground">
                      {formatPermissionKey(key)} <span className="text-md text-foreground-muted">(role default: {roleDefaults[key] ? "Allow" : "Deny"})</span>
                    </td>
                    {(["default", "allow", "deny"] as const).map((choice) => (
                      <td key={choice} className="px-4 py-3 text-center">
                        <input
                          type="radio"
                          name={`override-${key}`}
                          checked={(overrideChoices[key] ?? "default") === choice}
                          onChange={() => setOverrideChoices((prev) => ({ ...prev, [key]: choice }))}
                          className="h-4 w-4"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <Button id="user-edit-save-overrides" type="button" variant="primary" onClick={handleSaveOverrides} disabled={savingOverrides}>
              {savingOverrides ? "saving" : "save changes"}
            </Button>
          </div>
        </div>
      )}

      {canMutate && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-[20px] leading-7 font-semibold text-foreground">Reports Access Grants</h2>
          <p className="text-md text-foreground-muted">In addition to entities this user created themselves, grant visibility into these Merchants/Campaigns for Reports.</p>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <span className="text-sm font-medium text-foreground">Merchants</span>
              <div className="mt-1">
                <EntityMultiSelect id="user-edit-grants-tenants" fetchPath="/v1/tenants" labelKey="name" selected={tenantIds} onChange={setTenantIds} placeholder="Search merchants…" />
              </div>
            </div>
            <div>
              <span className="text-sm font-medium text-foreground">Campaigns</span>
              <div className="mt-1">
                <EntityMultiSelect id="user-edit-grants-campaigns" fetchPath="/v1/campaigns" labelKey="name" selected={campaignIds} onChange={setCampaignIds} placeholder="Search campaigns…" />
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Button id="user-edit-save-grants" type="button" variant="primary" onClick={handleSaveGrants} disabled={savingGrants}>
              {savingGrants ? "saving" : "save changes"}
            </Button>
          </div>
        </div>
      )}

      {actor?.role === "super_admin" && (
        <div className="mt-6">
          <h2 className="text-[20px] leading-7 font-semibold text-foreground">Login History</h2>
          <p className="text-md text-foreground-muted">IP, device and location captured on every successful login — visible to Super Admin only.</p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-surface-alt text-foreground-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Timestamp</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Device / Browser</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-foreground-muted">
                      No login history yet.
                    </td>
                  </tr>
                )}
                {sessions.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-4 py-3 text-foreground-muted">{new Date(s.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-foreground">{s.ip || "—"}</td>
                    <td className="px-4 py-3 text-foreground">{[s.city, s.country].filter(Boolean).join(", ") || "Local Network"}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-md text-foreground-muted">{s.user_agent || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
