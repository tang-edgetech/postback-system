"use client";

import { useListQuery } from "@/lib/use-list-query";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toTitleCase } from "@/lib/titlecase";
import { SortableTh, SearchInput, ListFooter } from "@/components/dashboard/list-controls";

type AuditLogRow = {
  id: number;
  actor_full_name: string;
  actor_email: string;
  action: string;
  status_code: number;
  changes: Record<string, unknown> | null;
  created_at: string;
};

function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
}

function formatChanges(changes: Record<string, unknown> | null) {
  if (!changes) return "—";
  const entries = Object.entries(changes).filter(([key]) => key !== "password" && key !== "current_password" && key !== "new_password" && key !== "repeat_password");
  if (entries.length === 0) return "—";
  return entries.map(([key, value]) => `${toTitleCase(key)}: ${String(value)}`).join(", ");
}

export default function AuditLogsPage() {
  const list = useListQuery<AuditLogRow>("/v1/audit-logs");
  const availableActions = (list.extra.available_actions as string[] | undefined) ?? [];

  const actionOptions = [{ value: "", label: "All Actions" }, ...availableActions.map((a) => ({ value: a, label: a.replace(/\./g, " ") }))];

  function handleExport() {
    const params = new URLSearchParams();
    if (list.search) params.set("search", list.search);
    if (list.filters.action) params.set("action", list.filters.action);
    if (list.filters.date_from) params.set("date_from", list.filters.date_from);
    if (list.filters.date_to) params.set("date_to", list.filters.date_to);
    window.open(`${getApiBaseUrl()}/v1/audit-logs/export?${params.toString()}`, "_blank");
  }

  return (
    <div id="page-audit-logs" className="c-audit-logs">
      <div className="flex items-center justify-between">
        <h1 className="c-audit-logs__title text-[26px] leading-8 font-semibold text-foreground">Audit Logs</h1>
        <Button id="audit-logs-export" variant="secondary" onClick={handleExport}>
          export csv
        </Button>
      </div>

      <div className="c-audit-logs__filters mt-6 flex flex-wrap items-end gap-3">
        <SearchInput id="audit-logs-search" value={list.search} onChange={list.setSearch} placeholder="Search by name, email or action…" />
        <Select
          id="audit-logs-action-filter"
          label="Action"
          className="w-48"
          value={list.filters.action ?? ""}
          onChange={(e) => list.setFilter("action", e.target.value)}
          options={actionOptions}
        />
        <div className="c-field flex flex-col gap-1">
          <label htmlFor="audit-logs-date-from" className="c-field__label text-md font-medium text-foreground">
            From Date
          </label>
          <input
            id="audit-logs-date-from"
            type="date"
            value={list.filters.date_from ?? ""}
            onChange={(e) => list.setFilter("date_from", e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>
        <div className="c-field flex flex-col gap-1">
          <label htmlFor="audit-logs-date-to" className="c-field__label text-md font-medium text-foreground">
            To Date
          </label>
          <input
            id="audit-logs-date-to"
            type="date"
            value={list.filters.date_to ?? ""}
            onChange={(e) => list.setFilter("date_to", e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>
      </div>

      <div className="c-audit-logs__table-wrap mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="c-audit-logs__table w-full min-w-[860px] text-left text-sm">
          <thead className="bg-surface-alt text-foreground-muted">
            <tr>
              <SortableTh column="created_at" label="Timestamp" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
              <th className="px-4 py-3 font-medium">Performed By</th>
              <SortableTh column="action" label="Action" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
              <th className="px-4 py-3 font-medium">Data Changed</th>
              <SortableTh column="status_code" label="Status Code" sort={list.sort} dir={list.dir} onSort={list.toggleSort} />
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
                  No activity recorded yet.
                </td>
              </tr>
            )}
            {list.items.map((log) => (
              <tr key={log.id} id={`audit-row-${log.id}`} className="border-t border-border align-top">
                <td className="px-4 py-3 whitespace-nowrap text-foreground-muted">{new Date(log.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-foreground">
                  {log.actor_full_name || "System"}
                  {log.actor_email && <span className="ml-1 text-md text-foreground-muted">({log.actor_email})</span>}
                </td>
                <td className="px-4 py-3 text-foreground">{toTitleCase(log.action.replace(/\./g, " "))}</td>
                <td className="max-w-md px-4 py-3 text-md text-foreground-muted">{formatChanges(log.changes)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`c-badge inline-flex rounded-full px-2 py-0.5 text-sm font-medium ${
                      log.status_code < 400
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                    }`}
                  >
                    {log.status_code}
                  </span>
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
