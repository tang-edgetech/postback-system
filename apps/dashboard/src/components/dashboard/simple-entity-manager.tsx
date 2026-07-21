"use client";

import { useState } from "react";
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
import { FilterBar } from "@/components/dashboard/filter-bar";

type EntityRow = {
  id: number;
  name: string;
  status: "active" | "inactive";
};

type SimpleEntityManagerProps = {
  title: string;
  apiPath: string;
  entityLabel: string;
  /** Permission key prefix, e.g. "merchants" checks merchants.create/edit/status/delete. */
  permissionPrefix: string;
};

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export function SimpleEntityManager({ title, apiPath, entityLabel, permissionPrefix }: SimpleEntityManagerProps) {
  const slug = entityLabel.toLowerCase();
  const { user } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const canCreate = user?.permissions[`${permissionPrefix}.create`] ?? false;
  const canEdit = user?.permissions[`${permissionPrefix}.edit`] ?? false;
  const canStatus = user?.permissions[`${permissionPrefix}.status`] ?? false;
  const canDelete = user?.permissions[`${permissionPrefix}.delete`] ?? false;
  const canManage = canEdit || canStatus || canDelete;
  const canBulk = canStatus || canDelete;

  const list = useListQuery<EntityRow>(apiPath);

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api.post(apiPath, { name: newName.trim() });
      toast.success(`${entityLabel} created successfully.`);
      setNewName("");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  function startEdit(item: EntityRow) {
    setEditingId(item.id);
    setEditingName(item.name);
  }

  async function saveEdit() {
    if (editingId === null || !editingName.trim()) return;
    try {
      await api.patch(`${apiPath}/${editingId}`, { name: editingName.trim() });
      toast.success(`${entityLabel} updated successfully.`);
      setEditingId(null);
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleToggleStatus(item: EntityRow) {
    const nextStatus = item.status === "active" ? "inactive" : "active";
    const confirmed = await confirm({
      title: `${nextStatus === "inactive" ? "Deactivate" : "Activate"} This ${entityLabel}?`,
      message: `"${item.name}" will be marked as ${nextStatus}.`,
      confirmLabel: nextStatus === "inactive" ? "Deactivate" : "Activate",
      tone: nextStatus === "inactive" ? "danger" : "default",
    });
    if (!confirmed) return;
    try {
      await api.patch(`${apiPath}/${item.id}/status`, { status: nextStatus });
      toast.success("Status updated successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleDelete(item: EntityRow) {
    const confirmed = await confirm({
      title: `Delete This ${entityLabel}?`,
      message: `"${item.name}" will be permanently deleted. This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await api.delete(`${apiPath}/${item.id}`);
      toast.success(`${entityLabel} deleted successfully.`);
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleBulkStatus(status: "active" | "inactive") {
    const ids = Array.from(list.selected);
    const confirmed = await confirm({
      title: `${status === "active" ? "Activate" : "Deactivate"} ${ids.length} ${entityLabel}${ids.length > 1 ? "s" : ""}?`,
      confirmLabel: status === "active" ? "Activate" : "Deactivate",
      tone: status === "active" ? "default" : "danger",
    });
    if (!confirmed) return;
    try {
      await api.patch(`${apiPath}/bulk/status`, { ids, status });
      toast.success("Status updated successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(list.selected);
    const confirmed = await confirm({
      title: `Delete ${ids.length} ${entityLabel}${ids.length > 1 ? "s" : ""}?`,
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await api.post(`${apiPath}/bulk/delete`, { ids });
      toast.success(`${entityLabel}s deleted successfully.`);
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div id={`page-${slug}`} className="c-entity-manager">
      <h1 className="c-entity-manager__title text-[26px] leading-8 font-semibold text-foreground">{title}</h1>

      {canCreate && (
        <form onSubmit={handleCreate} className="c-entity-manager__create mt-4 flex items-end gap-3">
          <div className="w-full max-w-xs">
            <Input id={`${slug}-new-name`} label={`${entityLabel} Name`} value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <Button id={`${slug}-add-btn`} type="submit" variant="primary">
            {`add ${slug}`}
          </Button>
        </form>
      )}

      <div className="c-entity-manager__filters mt-6">
        <FilterBar
          id={`${slug}-filters`}
          activeCount={(list.search ? 1 : 0) + Object.values(list.filters).filter(Boolean).length}
          onClear={list.clearFilters}
        >
          <SearchInput id={`${slug}-search`} value={list.search} onChange={list.setSearch} placeholder={`Search ${slug}s…`} />
          <Select
            id={`${slug}-status-filter`}
            label="Status"
            className="w-40"
            value={list.filters.status ?? ""}
            onChange={(e) => list.setFilter("status", e.target.value)}
            options={STATUS_OPTIONS}
          />
        </FilterBar>
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
        <table className="c-entity-manager__table w-full min-w-[480px] text-left text-sm">
          <thead className="bg-surface-alt text-foreground-muted">
            <tr>
              {canBulk && (
                <th className="w-10 px-4 py-3">
                  <input
                    id={`${slug}-select-all`}
                    type="checkbox"
                    checked={list.items.length > 0 && list.selected.size === list.items.length}
                    onChange={list.toggleSelectAll}
                  />
                </th>
              )}
              <SortableTh column="name" label="Name" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
              <SortableTh column="status" label="Status" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
              {canManage && <th className="px-4 py-3 font-medium text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {list.loading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-foreground-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!list.loading && list.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-foreground-muted">
                  No {slug}s found.
                </td>
              </tr>
            )}
            {list.items.map((item) => (
              <tr key={item.id} id={`${slug}-row-${item.id}`} className="border-t border-border">
                {canBulk && (
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={list.selected.has(item.id)} onChange={() => list.toggleSelect(item.id)} />
                  </td>
                )}
                <td className="px-4 py-3 text-foreground">
                  {editingId === item.id ? (
                    <input
                      id={`${slug}-edit-input-${item.id}`}
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                    />
                  ) : (
                    item.name
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
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      {editingId === item.id ? (
                        <>
                          <IconButton id={`${slug}-save-${item.id}`} icon={<CheckIcon />} label="Save" onClick={saveEdit} />
                          <IconButton id={`${slug}-cancel-${item.id}`} icon={<XIcon />} label="Cancel" onClick={() => setEditingId(null)} />
                        </>
                      ) : (
                        <>
                          {canEdit && <IconButton id={`${slug}-edit-${item.id}`} icon={<EditIcon />} label="Edit" onClick={() => startEdit(item)} />}
                          {canStatus && (
                            <IconButton
                              id={`${slug}-status-${item.id}`}
                              icon={<PowerIcon />}
                              label={item.status === "active" ? "Deactivate" : "Activate"}
                              onClick={() => handleToggleStatus(item)}
                            />
                          )}
                          {canDelete && <IconButton id={`${slug}-delete-${item.id}`} icon={<TrashIcon />} label="Delete" variant="danger" onClick={() => handleDelete(item)} />}
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
