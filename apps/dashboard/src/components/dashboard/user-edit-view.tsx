"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { useToast } from "@/components/providers/toast-provider";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { toTitleCase } from "@/lib/titlecase";
import { ArrowLeftIcon } from "@/components/icons";

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

  if (loading || !target) {
    return <p className="text-foreground-muted">Loading…</p>;
  }

  return (
    <div id="page-user-edit" className="c-user-edit max-w-2xl">
      <IconButton id="user-edit-back" icon={<ArrowLeftIcon />} label="Back" onClick={() => router.push("/users")} />

      <div className="mt-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-foreground">{target.full_name}</h1>
        <span
          className={`c-badge inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
            target.status === "active"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
          }`}
        >
          {toTitleCase(target.status)}
        </span>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-foreground">Basic Information</h2>
        <form id="user-edit-form" onSubmit={handleSave} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
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
            <div className="md:col-span-2">
              <Button id="user-edit-save" type="submit" variant="primary" disabled={saving}>
                {saving ? "saving" : "save changes"}
              </Button>
            </div>
          )}
        </form>
      </div>

      {actor?.role === "super_admin" && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-foreground">Login History</h2>
          <p className="text-xs text-foreground-muted">IP, device and location captured on every successful login — visible to Super Admin only.</p>
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
                    <td className="max-w-xs truncate px-4 py-3 text-xs text-foreground-muted">{s.user_agent || "—"}</td>
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
