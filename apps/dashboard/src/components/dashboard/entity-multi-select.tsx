"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

type Entity = { id: number; label: string };

// Generic "search + checkbox list" picker for scoping something (auth-type unlock,
// data-access grants, ...) to a subset of an existing entity list (Links, Merchants,
// Campaigns). Fetches once up to a generous page size and filters client-side — fine at
// admin-tool scale; would need real server-side search if any of these lists ever grow
// into the thousands.
export function EntityMultiSelect({
  id,
  fetchPath,
  labelKey,
  selected,
  onChange,
  placeholder,
}: {
  id: string;
  fetchPath: string;
  labelKey: string;
  selected: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
}) {
  const [items, setItems] = useState<Entity[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ items: Record<string, unknown>[] }>(`${fetchPath}?per_page=200`);
        setItems(res.items.map((row) => ({ id: row.id as number, label: String(row[labelKey] ?? row.id) })));
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchPath, labelKey]);

  const filtered = useMemo(() => items.filter((item) => item.label.toLowerCase().includes(search.toLowerCase())), [items, search]);

  function toggle(entityId: number) {
    onChange(selected.includes(entityId) ? selected.filter((v) => v !== entityId) : [...selected, entityId]);
  }

  return (
    <div id={id} className="c-entity-multi-select rounded-md border border-border">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder ?? "Search…"}
        className="w-full border-b border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
      />
      <div className="max-h-48 overflow-y-auto p-2">
        {loading && <p className="px-2 py-1 text-sm text-foreground-muted">Loading…</p>}
        {!loading && filtered.length === 0 && <p className="px-2 py-1 text-sm text-foreground-muted">No matches.</p>}
        {filtered.map((item) => (
          <label key={item.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-surface-alt">
            <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} className="h-4 w-4" />
            {item.label}
          </label>
        ))}
      </div>
      {selected.length > 0 && <p className="border-t border-border px-3 py-1.5 text-md text-foreground-muted">{selected.length} selected</p>}
    </div>
  );
}
