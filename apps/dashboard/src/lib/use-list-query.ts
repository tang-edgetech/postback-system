import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type ListResponse<T> = {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  [key: string]: unknown;
};

export function useListQuery<T extends { id: number }>(basePath: string, initialFilters: Record<string, string> = {}) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [sort, setSort] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters);
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [extra, setExtra] = useState<Record<string, unknown>>({});

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("per_page", String(perPage));
    if (sort) {
      params.set("sort", sort);
      params.set("dir", dir);
    }
    if (search) params.set("search", search);
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    return params.toString();
  }, [page, perPage, sort, dir, search, filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ListResponse<T>>(`${basePath}?${buildQuery()}`);
      setItems(data.items);
      setTotal(data.total);
      setExtra(data);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load data.");
    } finally {
      setLoading(false);
    }
  }, [basePath, buildQuery]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function toggleSort(column: string) {
    if (sort === column) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(column);
      setDir("asc");
    }
    setPage(1);
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === items.length ? new Set<number>() : new Set(items.map((i) => i.id))));
  }

  function setFilter(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function changePerPage(value: number) {
    setPerPage(value);
    setPage(1);
  }

  return {
    items,
    total,
    page,
    perPage,
    loading,
    error,
    sort,
    dir,
    search,
    filters,
    selected,
    extra,
    setPage,
    setPerPage: changePerPage,
    toggleSort,
    toggleSelect,
    toggleSelectAll,
    setFilter,
    setSearch: updateSearch,
    clearSelection: () => setSelected(new Set()),
    refetch: load,
  };
}
