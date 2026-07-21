"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useListQuery } from "@/lib/use-list-query";
import { useAuth } from "@/components/providers/auth-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toTitleCase } from "@/lib/titlecase";
import { EditIcon, TrashIcon, CheckIcon, XIcon, PowerIcon } from "@/components/icons";
import { ListFooter, SortableTh, SearchInput, BulkToolbar } from "@/components/dashboard/list-controls";

type CampaignRow = {
  id: number;
  name: string;
  status: "active" | "inactive";
  tenant_id: number;
  tenant_name: string;
};

type MerchantOption = { id: number; name: string };

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

// Campaigns are tenant-scoped (one Merchant per Campaign, see migration 0004) so this
// can't reuse the generic SimpleEntityManager — every create/edit needs a Merchant pick.
export function CampaignManager() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();

  const canCreate = user?.permissions["campaigns.create"] ?? false;
  const canEdit = user?.permissions["campaigns.edit"] ?? false;
  const canStatus = user?.permissions["campaigns.status"] ?? false;
  const canDelete = user?.permissions["campaigns.delete"] ?? false;
  const canBulk = canStatus || canDelete;

  const list = useListQuery<CampaignRow>("/v1/campaigns");
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);

  const [newName, setNewName] = useState("");
  const [newTenantId, setNewTenantId] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingTenantId, setEditingTenantId] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ items: MerchantOption[] }>("/v1/tenants?per_page=200&status=active");
        setMerchants(res.items);
      } catch {
        // Merchant dropdown is a convenience — degrade silently if it fails to load.
      }
    })();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newTenantId) return;
    try {
      await api.post("/v1/campaigns", { name: newName.trim(), tenant_id: Number(newTenantId) });
      toast.success("Campaign created successfully.");
      setNewName("");
      setNewTenantId("");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  function startEdit(item: CampaignRow) {
    setEditingId(item.id);
    setEditingName(item.name);
    setEditingTenantId(String(item.tenant_id));
  }

  async function saveEdit() {
    if (editingId === null || !editingName.trim() || !editingTenantId) return;
    try {
      await api.patch(`/v1/campaigns/${editingId}`, { name: editingName.trim(), tenant_id: Number(editingTenantId) });
      toast.success("Campaign updated successfully.");
      setEditingId(null);
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleToggleStatus(item: CampaignRow) {
    const nextStatus = item.status === "active" ? "inactive" : "active";
    const confirmed = await confirm({
      title: `${nextStatus === "inactive" ? "Deactivate" : "Activate"} This Campaign?`,
      message: `"${item.name}" will be marked as ${nextStatus}.`,
      confirmLabel: nextStatus === "inactive" ? "Deactivate" : "Activate",
      tone: nextStatus === "inactive" ? "danger" : "default",
    });
    if (!confirmed) return;
    try {
      await api.patch(`/v1/campaigns/${item.id}/status`, { status: nextStatus });
      toast.success("Status updated successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleDelete(item: CampaignRow) {
    const confirmed = await confirm({
      title: "Delete This Campaign?",
      message: `"${item.name}" will be permanently deleted. This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await api.delete(`/v1/campaigns/${item.id}`);
      toast.success("Campaign deleted successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleBulkStatus(status: "active" | "inactive") {
    const ids = Array.from(list.selected);
    const confirmed = await confirm({
      title: `${status === "active" ? "Activate" : "Deactivate"} ${ids.length} Campaign${ids.length > 1 ? "s" : ""}?`,
      confirmLabel: status === "active" ? "Activate" : "Deactivate",
      tone: status === "active" ? "default" : "danger",
    });
    if (!confirmed) return;
    try {
      await api.patch("/v1/campaigns/bulk/status", { ids, status });
      toast.success("Status updated successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(list.selected);
    const confirmed = await confirm({ title: `Delete ${ids.length} Campaign${ids.length > 1 ? "s" : ""}?`, message: "This cannot be undone.", confirmLabel: "Delete", tone: "danger" });
    if (!confirmed) return;
    try {
      await api.post("/v1/campaigns/bulk/delete", { ids });
      toast.success("Campaigns deleted successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  const merchantOptions = merchants.map((m) => ({ value: String(m.id), label: m.name }));

  return (
    <div id="page-campaigns" className="c-entity-manager">
      <h1 className="c-entity-manager__title text-[26px] leading-8 font-semibold text-foreground">Campaigns</h1>

      {canCreate && (
        <form onSubmit={handleCreate} className="c-entity-manager__create mt-4 flex flex-wrap items-end gap-3">
          <div className="w-full max-w-xs">
            <Input id="campaign-new-name" label="Campaign Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div className="w-full max-w-xs">
            <Select
              id="campaign-new-tenant"
              label="Merchant"
              value={newTenantId}
              onChange={(e) => setNewTenantId(e.target.value)}
              options={[{ value: "", label: "Select a Merchant" }, ...merchantOptions]}
            />
          </div>
          <Button id="campaign-add-btn" type="submit" variant="primary">
            add campaign
          </Button>
        </form>
      )}

      <div className="c-entity-manager__filters mt-6 flex flex-wrap items-end gap-3">
        <SearchInput id="campaigns-search" value={list.search} onChange={list.setSearch} placeholder="Search campaigns…" />
        <Select
          id="campaigns-status-filter"
          label="Status"
          className="w-40"
          value={list.filters.status ?? ""}
          onChange={(e) => list.setFilter("status", e.target.value)}
          options={STATUS_OPTIONS}
        />
        <Select
          id="campaigns-tenant-filter"
          label="Merchant"
          className="w-44"
          value={list.filters.tenant_id ?? ""}
          onChange={(e) => list.setFilter("tenant_id", e.target.value)}
          options={[{ value: "", label: "All Merchants" }, ...merchantOptions]}
        />
      </div>

      {canBulk && (
        <div className="mt-3">
          <BulkToolbar
            count={list.selected.size}
            onActivate={canStatus ? () => handleBulkStatus("active") : undefined}
            onDeactivate={canStatus ? () => handleBulkStatus("inactive") : undefined}
            onDelete={canDelete ? handleBulkDelete : undefined}
          />
        </div>
      )}

      <div className="c-entity-manager__table-wrap mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="c-entity-manager__table w-full min-w-[640px] text-left text-sm">
          <thead className="bg-surface-alt text-foreground-muted">
            <tr>
              {canBulk && (
                <th className="w-10 px-4 py-3">
                  <input
                    id="campaigns-select-all"
                    type="checkbox"
                    checked={list.items.length > 0 && list.selected.size === list.items.length}
                    onChange={list.toggleSelectAll}
                  />
                </th>
              )}
              <SortableTh column="name" label="Name" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
              <th className="px-4 py-3 font-medium">Merchant</th>
              <SortableTh column="status" label="Status" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
              {(canEdit || canStatus || canDelete) && <th className="px-4 py-3 font-medium text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {list.loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-foreground-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!list.loading && list.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-foreground-muted">
                  No campaigns found.
                </td>
              </tr>
            )}
            {list.items.map((item) => (
              <tr key={item.id} id={`campaign-row-${item.id}`} className="border-t border-border">
                {canBulk && (
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={list.selected.has(item.id)} onChange={() => list.toggleSelect(item.id)} />
                  </td>
                )}
                <td className="px-4 py-3 text-foreground">
                  {editingId === item.id ? (
                    <input
                      id={`campaign-edit-input-${item.id}`}
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                    />
                  ) : (
                    item.name
                  )}
                </td>
                <td className="px-4 py-3 text-foreground">
                  {editingId === item.id ? (
                    <select
                      id={`campaign-edit-tenant-${item.id}`}
                      value={editingTenantId}
                      onChange={(e) => setEditingTenantId(e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                    >
                      {merchantOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    item.tenant_name
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`c-badge inline-flex rounded-full px-2 py-0.5 text-sm font-medium ${
                      item.status === "active"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {toTitleCase(item.status)}
                  </span>
                </td>
                {(canEdit || canStatus || canDelete) && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      {editingId === item.id ? (
                        <>
                          <IconButton id={`campaign-save-${item.id}`} icon={<CheckIcon />} label="Save" onClick={saveEdit} />
                          <IconButton id={`campaign-cancel-${item.id}`} icon={<XIcon />} label="Cancel" onClick={() => setEditingId(null)} />
                        </>
                      ) : (
                        <>
                          {canEdit && <IconButton id={`campaign-edit-${item.id}`} icon={<EditIcon />} label="Edit" onClick={() => startEdit(item)} />}
                          {canStatus && (
                            <IconButton
                              id={`campaign-status-${item.id}`}
                              icon={<PowerIcon />}
                              label={item.status === "active" ? "Deactivate" : "Activate"}
                              onClick={() => handleToggleStatus(item)}
                            />
                          )}
                          {canDelete && <IconButton id={`campaign-delete-${item.id}`} icon={<TrashIcon />} label="Delete" variant="danger" onClick={() => handleDelete(item)} />}
                        </>
                      )}
                    </div>
                  </td>
                )}
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
