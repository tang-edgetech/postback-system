"use client";

import { useEffect, useRef, useState } from "react";
import { toTitleCase } from "@/lib/titlecase";
import { IconButton } from "@/components/ui/icon-button";
import { TrashIcon, PowerIcon, ChevronLeftIcon, ChevronRightIcon, CaretDownIcon } from "@/components/icons";

const PER_PAGE_VALUES = [25, 50, 100, 150, 200];

// Combines the items-per-page selector (left, plain numbers, no label) with the
// prev/next chevron controls (right) into a single footer row for every listing page.
export function ListFooter({
  page,
  perPage,
  total,
  onPageChange,
  onPerPageChange,
}: {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div id="list-footer" className="c-list-footer flex flex-wrap items-center justify-between gap-3 text-sm text-foreground-muted">
      <select
        id="per-page-select"
        aria-label="Items per page"
        value={perPage}
        onChange={(e) => onPerPageChange(Number(e.target.value))}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
      >
        {PER_PAGE_VALUES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-3">
        <span>
          Showing {from}–{to} of {total}
        </span>
        <div className="flex items-center gap-1">
          <IconButton id="pagination-prev" icon={<ChevronLeftIcon />} label="Previous Page" onClick={() => onPageChange(page - 1)} disabled={page <= 1} />
          <span>
            Page {page} of {totalPages}
          </span>
          <IconButton id="pagination-next" icon={<ChevronRightIcon />} label="Next Page" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} />
        </div>
      </div>
    </div>
  );
}

export function SortableTh({
  column,
  label,
  sort,
  dir,
  onSort,
  className = "",
}: {
  column: string;
  label: string;
  sort: string | null;
  dir: "asc" | "desc";
  onSort: (column: string) => void;
  className?: string;
}) {
  const active = sort === column;
  return (
    <th
      id={`sort-${column}`}
      onClick={() => onSort(column)}
      className={`cursor-pointer select-none px-4 py-3 font-medium ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${active ? "text-accent" : ""}`}>
        {toTitleCase(label)}
        <CaretDownIcon className={`transition-transform ${active ? "text-accent" : "text-foreground-muted/60"} ${active && dir === "asc" ? "rotate-180" : ""}`} />
      </span>
    </th>
  );
}

export function SearchInput({ value, onChange, id, placeholder }: { value: string; onChange: (v: string) => void; id: string; placeholder?: string }) {
  return (
    <input
      id={id}
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? "Search…"}
      className="c-search-input rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
    />
  );
}

export function BulkToolbar({
  count,
  onActivate,
  onDeactivate,
  onDelete,
}: {
  count: number;
  onActivate?: () => void;
  onDeactivate?: () => void;
  onDelete?: () => void;
}) {
  if (count === 0) return null;
  return (
    <div id="bulk-toolbar" className="c-bulk-toolbar flex items-center gap-3 rounded-md bg-accent/10 px-4 py-2 text-sm text-foreground">
      <span className="font-medium">{count} Selected</span>
      <div className="flex items-center gap-1">
        {onActivate && <IconButton id="bulk-activate" icon={<PowerIcon />} label="Activate Selected" onClick={onActivate} />}
        {onDeactivate && <IconButton id="bulk-deactivate" icon={<PowerIcon />} label="Deactivate Selected" onClick={onDeactivate} />}
        {onDelete && <IconButton id="bulk-delete" icon={<TrashIcon />} label="Delete Selected" variant="danger" onClick={onDelete} />}
      </div>
    </div>
  );
}

// A checkbox-based multi-select filter (e.g. Device/OS/Browser on the Visits table) —
// value is a comma-joined string so it slots directly into useListQuery's setFilter.
export function MultiSelectFilter({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = value ? value.split(",").filter(Boolean) : [];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleOption(option: string) {
    const next = selected.includes(option) ? selected.filter((o) => o !== option) : [...selected, option];
    onChange(next.join(","));
  }

  return (
    <div id={id} ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
      >
        {toTitleCase(label)}
        {selected.length > 0 && <span className="rounded-full bg-accent px-1.5 text-md text-accent-foreground">{selected.length}</span>}
        <CaretDownIcon className={`text-foreground-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 min-w-[160px] rounded-md border border-border bg-surface p-2 shadow-md">
          {options.map((option) => (
            <label key={option} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-surface-alt">
              <input type="checkbox" checked={selected.includes(option)} onChange={() => toggleOption(option)} className="h-4 w-4" />
              {option}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
