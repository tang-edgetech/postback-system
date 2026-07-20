"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useListQuery } from "@/lib/use-list-query";
import { useAuth } from "@/components/providers/auth-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { toTitleCase } from "@/lib/titlecase";
import { EditIcon, TrashIcon, PowerIcon } from "@/components/icons";
import { ListFooter, SortableTh, SearchInput, BulkToolbar } from "@/components/dashboard/list-controls";

type Role = "super_admin" | "admin" | "marketer";
type UserRow = {
  id: number;
  full_name: string;
  email: string;
  role: Role;
  status: "active" | "inactive";
  created_by: number;
};

const ROLE_OPTIONS = [
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "marketer", label: "Marketer" },
];

const ROLE_FILTER_OPTIONS = [{ value: "", label: "All Roles" }, ...ROLE_OPTIONS];
const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export default function UsersPage() {
  const { user: actor } = useAuth();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const list = useListQuery<UserRow>("/v1/users");

  const [showCreate, setShowCreate] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("marketer");
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const availableRoleOptions = actor?.role === "admin" ? ROLE_OPTIONS.filter((o) => o.value !== "super_admin") : ROLE_OPTIONS;

  // Super Admin can mutate anyone; Admin only Marketers it personally created (see
  // canActorMutateTarget in services/api/internal/handler/users.go — this mirrors it
  // client-side purely to decide which buttons to show, the server enforces it either way).
  function canMutate(target: UserRow) {
    if (!actor) return false;
    if (actor.role === "super_admin") return true;
    if (actor.role === "admin") return target.role === "marketer" && target.created_by === actor.id;
    return false;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setSubmitting(true);
    try {
      await api.post("/v1/users", { full_name: fullName, email, password, role });
      toast.success("User created successfully.");
      setFullName("");
      setEmail("");
      setPassword("");
      setRole("marketer");
      setShowCreate(false);
      list.refetch();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleStatus(u: UserRow) {
    const nextStatus = u.status === "active" ? "inactive" : "active";
    const confirmed = await confirm({
      title: `${nextStatus === "inactive" ? "Deactivate" : "Activate"} This User?`,
      message: `${u.full_name} will be marked as ${nextStatus}.`,
      confirmLabel: nextStatus === "inactive" ? "Deactivate" : "Activate",
      tone: nextStatus === "inactive" ? "danger" : "default",
    });
    if (!confirmed) return;
    try {
      await api.patch(`/v1/users/${u.id}/status`, { status: nextStatus });
      toast.success("Status updated successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleDelete(u: UserRow) {
    const confirmed = await confirm({
      title: "Delete This User?",
      message: `${u.full_name} will be permanently deleted. This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await api.delete(`/v1/users/${u.id}`);
      toast.success("User deleted successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleBulkStatus(status: "active" | "inactive") {
    const ids = Array.from(list.selected);
    const confirmed = await confirm({
      title: `${status === "active" ? "Activate" : "Deactivate"} ${ids.length} User${ids.length > 1 ? "s" : ""}?`,
      confirmLabel: status === "active" ? "Activate" : "Deactivate",
      tone: status === "active" ? "default" : "danger",
    });
    if (!confirmed) return;
    try {
      await api.patch("/v1/users/bulk/status", { ids, status });
      toast.success("Status updated successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(list.selected);
    const confirmed = await confirm({
      title: `Delete ${ids.length} User${ids.length > 1 ? "s" : ""}?`,
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await api.post("/v1/users/bulk/delete", { ids });
      toast.success("Users deleted successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div id="page-users" className="c-users">
      <div className="flex items-center justify-between">
        <h1 className="c-users__title text-2xl font-semibold text-foreground">Users</h1>
        <Button id="users-add-toggle" variant="primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "cancel" : "add user"}
        </Button>
      </div>

      {showCreate && (
        <form
          id="users-create-form"
          onSubmit={handleCreate}
          className="c-users__create mt-4 grid max-w-2xl grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2"
        >
          <Input id="user-new-fullname" label="Full Name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <Input id="user-new-email" label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <PasswordInput id="user-new-password" label="Password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <Select id="user-new-role" label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} options={availableRoleOptions} />
          {createError && <p className="text-sm text-red-600 sm:col-span-2">{createError}</p>}
          <div className="sm:col-span-2">
            <Button id="user-create-submit" type="submit" variant="primary" disabled={submitting}>
              {submitting ? "creating" : "create user"}
            </Button>
          </div>
        </form>
      )}

      <div className="c-users__filters mt-6 flex flex-wrap items-end gap-3">
        <SearchInput id="users-search" value={list.search} onChange={list.setSearch} placeholder="Search by name or email…" />
        <Select
          id="users-role-filter"
          label="Role"
          className="w-40"
          value={list.filters.role ?? ""}
          onChange={(e) => list.setFilter("role", e.target.value)}
          options={ROLE_FILTER_OPTIONS}
        />
        <Select
          id="users-status-filter"
          label="Status"
          className="w-40"
          value={list.filters.status ?? ""}
          onChange={(e) => list.setFilter("status", e.target.value)}
          options={STATUS_FILTER_OPTIONS}
        />
      </div>

      <div className="mt-3">
        <BulkToolbar count={list.selected.size} onActivate={() => handleBulkStatus("active")} onDeactivate={() => handleBulkStatus("inactive")} onDelete={handleBulkDelete} />
      </div>

      <div className="c-users__table-wrap mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="c-users__table w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface-alt text-foreground-muted">
            <tr>
              <th className="w-10 px-4 py-3">
                <input id="users-select-all" type="checkbox" checked={list.items.length > 0 && list.selected.size === list.items.length} onChange={list.toggleSelectAll} />
              </th>
              <SortableTh column="full_name" label="Full Name" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
              <SortableTh column="email" label="Email" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
              <SortableTh column="role" label="Role" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
              <SortableTh column="status" label="Status" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-foreground-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!list.loading &&
              list.items.map((u) => (
                <tr key={u.id} id={`user-row-${u.id}`} className="border-t border-border">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={list.selected.has(u.id)} onChange={() => list.toggleSelect(u.id)} disabled={!canMutate(u) || u.id === actor?.id} />
                  </td>
                  <td className="px-4 py-3 text-foreground">{u.full_name}</td>
                  <td className="px-4 py-3 text-foreground-muted">{u.email}</td>
                  <td className="px-4 py-3 text-foreground">{toTitleCase(u.role)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`c-badge inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.status === "active"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {toTitleCase(u.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <IconButton id={`user-edit-${u.id}`} icon={<EditIcon />} label="Edit" onClick={() => router.push(`/users/${u.id}`)} />
                      {canMutate(u) && u.id !== actor?.id && (
                        <>
                          <IconButton
                            id={`user-status-${u.id}`}
                            icon={<PowerIcon />}
                            label={u.status === "active" ? "Deactivate" : "Activate"}
                            onClick={() => handleToggleStatus(u)}
                          />
                          <IconButton id={`user-delete-${u.id}`} icon={<TrashIcon />} label="Delete" variant="danger" onClick={() => handleDelete(u)} />
                        </>
                      )}
                      {u.id === actor?.id && <span className="self-center text-xs text-foreground-muted">(You)</span>}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <ListFooter page={list.page} perPage={list.perPage} total={list.total} onPageChange={list.setPage} onPerPageChange={list.setPerPage} />
      </div>
    </div>
  );
}
