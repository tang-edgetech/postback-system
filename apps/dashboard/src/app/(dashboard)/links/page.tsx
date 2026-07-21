"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useListQuery } from "@/lib/use-list-query";
import { useAuth } from "@/components/providers/auth-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/select";
import { CopyButton } from "@/components/ui/copy-button";
import { toTitleCase } from "@/lib/titlecase";
import { EditIcon, TrashIcon, PowerIcon } from "@/components/icons";
import { ListFooter, SortableTh, SearchInput, BulkToolbar } from "@/components/dashboard/list-controls";

type LinkRow = {
  id: number;
  type: string;
  slug: string;
  destination_url: string;
  param_mode: string;
  tenant_name: string;
  campaign_id: number;
  campaign_name: string;
  remarks: string;
  status: "active" | "inactive";
  expires_at: string | null;
  created_by_name: string;
  created_at: string;
};

type EntityOption = { id: number; name: string };

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

function getExpiryBadge(expiresAt: string | null) {
  if (!expiresAt) {
    return { label: "Permanent", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" };
  }
  const diffDays = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  const dateLabel = new Date(expiresAt).toLocaleDateString();
  if (diffDays < 0) return { label: "Expired", className: "bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-300" };
  if (diffDays <= 5) return { label: dateLabel, className: "bg-orange-300 text-orange-950 dark:bg-orange-900 dark:text-orange-200" };
  if (diffDays <= 14) return { label: dateLabel, className: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" };
  return { label: dateLabel, className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" };
}

function getRedirectBaseUrl() {
  return process.env.NEXT_PUBLIC_REDIRECT_BASE_URL ?? "";
}

export default function LinksPage() {
  const list = useListQuery<LinkRow>("/v1/links");
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const canCreate = user?.permissions["links.create"] ?? false;
  const canStatus = user?.permissions["links.status"] ?? false;
  const canDelete = user?.permissions["links.delete"] ?? false;
  const canBulk = canStatus || canDelete;
  const [tenants, setTenants] = useState<EntityOption[]>([]);
  const [campaigns, setCampaigns] = useState<EntityOption[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [tenantRes, campaignRes] = await Promise.all([
          api.get<{ items: EntityOption[] }>("/v1/tenants?per_page=200"),
          api.get<{ items: EntityOption[] }>("/v1/campaigns?per_page=200"),
        ]);
        setTenants(tenantRes.items);
        setCampaigns(campaignRes.items);
      } catch {
        // filter dropdowns are a convenience — silently degrade to search-only if this fails
      }
    })();
  }, []);

  async function handleToggleStatus(link: LinkRow) {
    const nextStatus = link.status === "active" ? "inactive" : "active";
    const confirmed = await confirm({
      title: `${nextStatus === "inactive" ? "Deactivate" : "Activate"} This Link?`,
      message: `"${link.slug}" will be marked as ${nextStatus}.`,
      confirmLabel: nextStatus === "inactive" ? "Deactivate" : "Activate",
      tone: nextStatus === "inactive" ? "danger" : "default",
    });
    if (!confirmed) return;
    try {
      await api.patch(`/v1/links/${link.id}/status`, { status: nextStatus });
      toast.success("Status updated successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleDelete(link: LinkRow) {
    const confirmed = await confirm({
      title: "Delete This Link?",
      message: `"${link.slug}" will be permanently deleted. This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await api.delete(`/v1/links/${link.id}`);
      toast.success("Link deleted successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleBulkStatus(status: "active" | "inactive") {
    const ids = Array.from(list.selected);
    const confirmed = await confirm({
      title: `${status === "active" ? "Activate" : "Deactivate"} ${ids.length} Link${ids.length > 1 ? "s" : ""}?`,
      confirmLabel: status === "active" ? "Activate" : "Deactivate",
      tone: status === "active" ? "default" : "danger",
    });
    if (!confirmed) return;
    try {
      await api.patch("/v1/links/bulk/status", { ids, status });
      toast.success("Status updated successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(list.selected);
    const confirmed = await confirm({ title: `Delete ${ids.length} Link${ids.length > 1 ? "s" : ""}?`, message: "This cannot be undone.", confirmLabel: "Delete", tone: "danger" });
    if (!confirmed) return;
    try {
      await api.post("/v1/links/bulk/delete", { ids });
      toast.success("Links deleted successfully.");
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div id="page-links" className="c-links">
      <div className="flex items-center justify-between">
        <h1 className="c-links__title text-[26px] leading-8 font-semibold text-foreground">Links</h1>
        {canCreate && (
          <Button id="links-create-btn" variant="primary" onClick={() => router.push("/links/create")}>
            create link
          </Button>
        )}
      </div>

      <div className="c-links__filters mt-6 flex flex-wrap items-end gap-3">
        <SearchInput id="links-search" value={list.search} onChange={list.setSearch} placeholder="Search by slug or remarks…" />
        <Select
          id="links-tenant-filter"
          label="Merchant"
          className="w-44"
          value={list.filters.tenant_id ?? ""}
          onChange={(e) => list.setFilter("tenant_id", e.target.value)}
          options={[{ value: "", label: "All Merchants" }, ...tenants.map((t) => ({ value: String(t.id), label: t.name }))]}
        />
        <Select
          id="links-campaign-filter"
          label="Campaign"
          className="w-44"
          value={list.filters.campaign_id ?? ""}
          onChange={(e) => list.setFilter("campaign_id", e.target.value)}
          options={[{ value: "", label: "All Campaigns" }, ...campaigns.map((c) => ({ value: String(c.id), label: c.name }))]}
        />
        <Select
          id="links-status-filter"
          label="Status"
          className="w-40"
          value={list.filters.status ?? ""}
          onChange={(e) => list.setFilter("status", e.target.value)}
          options={STATUS_OPTIONS}
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

      <div className="c-links__table-wrap mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="c-links__table w-full min-w-[960px] text-left text-sm">
          <thead className="bg-surface-alt text-foreground-muted">
            <tr>
              {canBulk && (
                <th className="w-10 px-4 py-3">
                  <input id="links-select-all" type="checkbox" checked={list.items.length > 0 && list.selected.size === list.items.length} onChange={list.toggleSelectAll} />
                </th>
              )}
              <SortableTh column="slug" label="Short URL" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
              <th className="px-4 py-3 font-medium">Remarks</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Merchant</th>
              <th className="px-4 py-3 font-medium">Campaign</th>
              <th className="px-4 py-3 font-medium">Created By</th>
              <SortableTh column="created_at" label="Created At" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
              <SortableTh column="status" label="Status" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.loading && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-foreground-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!list.loading && list.items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-foreground-muted">
                  No links found.
                </td>
              </tr>
            )}
            {list.items.map((link) => {
              const shortUrl = `${getRedirectBaseUrl()}/${link.slug}`;
              const expiry = getExpiryBadge(link.expires_at);
              return (
                <tr key={link.id} id={`link-row-${link.id}`} className="border-t border-border">
                  {canBulk && (
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={list.selected.has(link.id)} onChange={() => list.toggleSelect(link.id)} />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground whitespace-nowrap">{shortUrl}</span>
                      <CopyButton id={`link-copy-${link.id}`} value={shortUrl} />
                    </div>
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-foreground-muted">{link.remarks || "—"}</td>
                  <td className="px-4 py-3 text-foreground">{toTitleCase(link.type)}</td>
                  <td className="px-4 py-3 text-foreground">{link.tenant_name}</td>
                  <td className="px-4 py-3 text-foreground">{link.campaign_name}</td>
                  <td className="px-4 py-3 text-foreground-muted">{link.created_by_name || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-foreground-muted">{new Date(link.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span
                        className={`c-badge inline-flex w-fit rounded-full px-2 py-0.5 text-sm font-medium ${
                          link.status === "active"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {toTitleCase(link.status)}
                      </span>
                      <span className={`c-badge inline-flex w-fit rounded-full px-2 py-0.5 text-sm font-medium ${expiry.className}`}>{expiry.label}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <IconButton id={`link-edit-${link.id}`} icon={<EditIcon />} label="View" onClick={() => router.push(`/links/${link.id}`)} />
                      {canStatus && (
                        <IconButton
                          id={`link-status-${link.id}`}
                          icon={<PowerIcon />}
                          label={link.status === "active" ? "Deactivate" : "Activate"}
                          onClick={() => handleToggleStatus(link)}
                        />
                      )}
                      {canDelete && <IconButton id={`link-delete-${link.id}`} icon={<TrashIcon />} label="Delete" variant="danger" onClick={() => handleDelete(link)} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <ListFooter page={list.page} perPage={list.perPage} total={list.total} onPageChange={list.setPage} onPerPageChange={list.setPerPage} />
      </div>
    </div>
  );
}
