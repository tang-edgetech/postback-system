"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/providers/toast-provider";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { MultiSelectFilter } from "@/components/dashboard/list-controls";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { DEVICE_OPTIONS, OS_OPTIONS, BROWSER_OPTIONS } from "@/lib/click-filter-options";
import { toTitleCase } from "@/lib/titlecase";
import { CaretDownIcon } from "@/components/icons";

type EntityOption = { id: number; name: string };

type ConversionRow = { event_name: string; count: number; conversion_rate_pct: number };
type SeriesPoint = { day: string; count: number };
type BreakdownRow = { label: string; count: number; pct: number };
type TopLinkRow = { link_id: number; slug: string; campaign_name: string; merchant_name: string; clicks: number };

type ReportResult = {
  total_clicks: number;
  total_postbacks: number;
  conversion_by_event: ConversionRow[];
  click_series: SeriesPoint[];
  postback_series: SeriesPoint[];
  device_breakdown: BreakdownRow[];
  os_breakdown: BreakdownRow[];
  browser_breakdown: BreakdownRow[];
  top_links: TopLinkRow[];
};

const BASIC_PRESETS = [
  { value: "7d", label: "Last 7 Days" },
  { value: "2w", label: "Last 2 Weeks" },
  { value: "1m", label: "Last Month" },
  { value: "3m", label: "Last 3 Months" },
];
const ADVANCED_PRESETS = [
  { value: "quarter", label: "This Quarter" },
  { value: "semiannual", label: "Last 6 Months" },
  { value: "annual", label: "Last 12 Months" },
];

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6"];

function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
}

// A checkbox multi-select identical in behavior to MultiSelectFilter but keyed by
// numeric id/name pairs (Merchants/Campaigns) rather than a flat string[] of options.
function EntityMultiSelect({ id, label, options, value, onChange }: { id: string; label: string; options: EntityOption[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggle(optionId: string) {
    onChange(value.includes(optionId) ? value.filter((v) => v !== optionId) : [...value, optionId]);
  }

  return (
    <div id={id} ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
      >
        {toTitleCase(label)}
        {value.length > 0 && <span className="rounded-full bg-accent px-1.5 text-md text-accent-foreground">{value.length}</span>}
        <CaretDownIcon className={`text-foreground-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 max-h-64 min-w-[220px] overflow-y-auto rounded-md border border-border bg-surface p-2 shadow-md">
          {options.length === 0 && <p className="px-2 py-1.5 text-md text-foreground-muted">No options.</p>}
          {options.map((opt) => (
            <label key={opt.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-surface-alt">
              <input type="checkbox" checked={value.includes(String(opt.id))} onChange={() => toggle(String(opt.id))} className="h-4 w-4" />
              {opt.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const canUseAdvancedRanges = user?.role === "super_admin" || user?.role === "admin";

  const [merchants, setMerchants] = useState<EntityOption[]>([]);
  const [campaigns, setCampaigns] = useState<EntityOption[]>([]);

  const [merchantIds, setMerchantIds] = useState<string[]>([]);
  const [campaignIds, setCampaignIds] = useState<string[]>([]);
  const [linkIdsInput, setLinkIdsInput] = useState("");
  const [device, setDevice] = useState("");
  const [os, setOs] = useState("");
  const [browser, setBrowser] = useState("");
  const [linkStatus, setLinkStatus] = useState("");
  const [eventNameInput, setEventNameInput] = useState("");
  const [geoCountryInput, setGeoCountryInput] = useState("");
  const [geoRegionInput, setGeoRegionInput] = useState("");
  const [dateRange, setDateRange] = useState("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [ranOnce, setRanOnce] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [merchantRes, campaignRes] = await Promise.all([
          api.get<{ items: EntityOption[] }>("/v1/tenants?per_page=200"),
          api.get<{ items: EntityOption[] }>("/v1/campaigns?per_page=200"),
        ]);
        setMerchants(merchantRes.items);
        setCampaigns(campaignRes.items);
      } catch {
        // Filter options are non-critical — the report still runs without them.
      }
    })();
  }, []);

  const dateRangeOptions = useMemo(() => (canUseAdvancedRanges ? [...BASIC_PRESETS, ...ADVANCED_PRESETS] : BASIC_PRESETS), [canUseAdvancedRanges]);

  function buildParams() {
    const params = new URLSearchParams();
    if (merchantIds.length) params.set("merchant_ids", merchantIds.join(","));
    if (campaignIds.length) params.set("campaign_ids", campaignIds.join(","));
    if (linkIdsInput.trim()) params.set("link_ids", linkIdsInput.trim());
    if (device) params.set("device", device);
    if (os) params.set("os", os);
    if (browser) params.set("browser", browser);
    if (linkStatus) params.set("link_status", linkStatus);
    if (eventNameInput.trim()) params.set("event_name", eventNameInput.trim());
    if (geoCountryInput.trim()) params.set("geo_country", geoCountryInput.trim());
    if (geoRegionInput.trim()) params.set("geo_region", geoRegionInput.trim());
    if (customFrom && customTo) {
      params.set("date_from", customFrom);
      params.set("date_to", customTo);
    } else {
      params.set("date_range", dateRange);
    }
    return params;
  }

  async function handleRun() {
    setLoading(true);
    setRanOnce(true);
    try {
      const res = await api.get<ReportResult>(`/v1/reports?${buildParams().toString()}`);
      setResult(res);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load the report.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    window.open(`${getApiBaseUrl()}/v1/reports/export?${buildParams().toString()}`, "_blank");
  }

  const activeFilterCount =
    merchantIds.length +
    campaignIds.length +
    (linkIdsInput.trim() ? 1 : 0) +
    (device ? 1 : 0) +
    (os ? 1 : 0) +
    (browser ? 1 : 0) +
    (linkStatus ? 1 : 0) +
    (eventNameInput.trim() ? 1 : 0) +
    (geoCountryInput.trim() ? 1 : 0) +
    (geoRegionInput.trim() ? 1 : 0) +
    (dateRange !== "7d" ? 1 : 0) +
    (customFrom && customTo ? 1 : 0);

  function handleClearFilters() {
    setMerchantIds([]);
    setCampaignIds([]);
    setLinkIdsInput("");
    setDevice("");
    setOs("");
    setBrowser("");
    setLinkStatus("");
    setEventNameInput("");
    setGeoCountryInput("");
    setGeoRegionInput("");
    setDateRange("7d");
    setCustomFrom("");
    setCustomTo("");
  }

  const trendData = useMemo(() => {
    if (!result) return [];
    const byDay = new Map<string, { day: string; clicks: number; postbacks: number }>();
    result.click_series.forEach((p) => byDay.set(p.day, { day: p.day, clicks: p.count, postbacks: 0 }));
    result.postback_series.forEach((p) => {
      const existing = byDay.get(p.day);
      if (existing) existing.postbacks = p.count;
      else byDay.set(p.day, { day: p.day, clicks: 0, postbacks: p.count });
    });
    return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [result]);

  return (
    <div id="page-reports" className="c-reports">
      <div className="flex items-center justify-between">
        <h1 className="c-reports__title text-[26px] leading-8 font-semibold text-foreground">Reports</h1>
        <Button id="reports-export" variant="secondary" onClick={handleExport} disabled={!ranOnce}>
          export csv
        </Button>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
      <FilterBar id="reports-filters" activeCount={activeFilterCount} onClear={handleClearFilters}>
        <EntityMultiSelect id="reports-filter-merchants" label="Merchant" options={merchants} value={merchantIds} onChange={setMerchantIds} />
        <EntityMultiSelect id="reports-filter-campaigns" label="Campaign" options={campaigns} value={campaignIds} onChange={setCampaignIds} />
        <div className="c-field flex flex-col gap-1">
          <label className="c-field__label text-md font-medium text-foreground-muted">Link IDs (Comma-Separated)</label>
          <input
            id="reports-filter-link-ids"
            value={linkIdsInput}
            onChange={(e) => setLinkIdsInput(e.target.value)}
            placeholder="e.g. 12,34"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
        <MultiSelectFilter id="reports-filter-device" label="Device" options={DEVICE_OPTIONS} value={device} onChange={setDevice} />
        <MultiSelectFilter id="reports-filter-os" label="OS" options={OS_OPTIONS} value={os} onChange={setOs} />
        <MultiSelectFilter id="reports-filter-browser" label="Browser" options={BROWSER_OPTIONS} value={browser} onChange={setBrowser} />
        <MultiSelectFilter id="reports-filter-link-status" label="Link Status" options={["active", "inactive"]} value={linkStatus} onChange={setLinkStatus} />
        <div className="c-field flex flex-col gap-1">
          <label className="c-field__label text-md font-medium text-foreground-muted">Postback Event Name(s)</label>
          <input
            id="reports-filter-event-name"
            value={eventNameInput}
            onChange={(e) => setEventNameInput(e.target.value)}
            placeholder="e.g. purchase,signup"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
        <div className="c-field flex flex-col gap-1">
          <label className="c-field__label text-md font-medium text-foreground-muted">Geo Country(s)</label>
          <input
            id="reports-filter-geo-country"
            value={geoCountryInput}
            onChange={(e) => setGeoCountryInput(e.target.value)}
            placeholder="e.g. US,SG"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
        <div className="c-field flex flex-col gap-1">
          <label className="c-field__label text-md font-medium text-foreground-muted">Geo Region(s)</label>
          <input
            id="reports-filter-geo-region"
            value={geoRegionInput}
            onChange={(e) => setGeoRegionInput(e.target.value)}
            placeholder="Comma-separated"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
        <Select
          id="reports-filter-date-range"
          label="Date Range"
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          options={dateRangeOptions}
          disabled={Boolean(customFrom && customTo)}
        />
        <div className="c-field flex flex-col gap-1">
          <label className="c-field__label text-md font-medium text-foreground-muted">Custom From</label>
          <input
            id="reports-filter-date-from"
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
        <div className="c-field flex flex-col gap-1">
          <label className="c-field__label text-md font-medium text-foreground-muted">Custom To</label>
          <input
            id="reports-filter-date-to"
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
      </FilterBar>
        <div className="mt-4 flex justify-end border-t border-border pt-4">
          <Button id="reports-run" type="button" variant="primary" onClick={handleRun} disabled={loading}>
            {loading ? "running" : "run report"}
          </Button>
        </div>
      </div>

      {!ranOnce && <p className="mt-6 text-foreground-muted">Set your filters above and click Run Report.</p>}
      {ranOnce && loading && <p className="mt-6 text-foreground-muted">Loading…</p>}

      {ranOnce && !loading && result && (
        <div className="mt-6 flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-md text-foreground-muted">Total Clicks</p>
              <p className="text-[26px] leading-8 font-semibold text-foreground">{result.total_clicks.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-md text-foreground-muted">Total Postbacks</p>
              <p className="text-[26px] leading-8 font-semibold text-foreground">{result.total_postbacks.toLocaleString()}</p>
            </div>
          </div>

          {result.total_clicks === 0 && result.total_postbacks === 0 && (
            <p className="rounded-lg border border-border bg-surface p-4 text-foreground-muted">
              No clicks or postbacks were recorded for the selected filters and date range — try widening the date range or clearing some filters.
            </p>
          )}

          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-[20px] leading-7 font-semibold text-foreground">Clicks &amp; Postbacks Trend</h2>
            {trendData.length === 0 ? (
              <p className="mt-3 text-foreground-muted">No data available for this range.</p>
            ) : (
              <div className="mt-3 h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="clicks" name="Clicks" stroke={PALETTE[0]} strokeWidth={2} />
                    <Line type="monotone" dataKey="postbacks" name="Postbacks" stroke={PALETTE[1]} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {[
              { title: "Device Breakdown", rows: result.device_breakdown ?? [] },
              { title: "OS Breakdown", rows: result.os_breakdown ?? [] },
              { title: "Browser Breakdown", rows: result.browser_breakdown ?? [] },
            ].map(({ title, rows }) => (
              <div key={title} className="rounded-lg border border-border bg-surface p-4">
                <h2 className="text-[18px] leading-6 font-semibold text-foreground">{title}</h2>
                {rows.length === 0 ? (
                  <p className="mt-2 text-foreground-muted">No data available.</p>
                ) : (
                  <div className="mt-2 h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={rows}
                          dataKey="count"
                          nameKey="label"
                          outerRadius={80}
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          label={(entry: any) => `${entry.label} (${entry.pct.toFixed(0)}%)`}
                        >
                          {rows.map((_, i) => (
                            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-[20px] leading-7 font-semibold text-foreground">Top Links By Clicks</h2>
              {(result.top_links ?? []).length === 0 ? (
                <p className="mt-3 text-foreground-muted">No links have recorded clicks in this range.</p>
              ) : (
                <div className="mt-3 h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={result.top_links}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="slug" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="clicks" name="Clicks" fill={PALETTE[0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-[20px] leading-7 font-semibold text-foreground">Conversion Rate By Postback Event</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-foreground-muted">
                    <tr>
                      <th className="px-2 py-2 font-medium">Event</th>
                      <th className="px-2 py-2 font-medium">Count</th>
                      <th className="px-2 py-2 font-medium">Conversion Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.conversion_by_event ?? []).length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-2 py-4 text-center text-foreground-muted">
                          No postbacks in this range.
                        </td>
                      </tr>
                    )}
                    {(result.conversion_by_event ?? []).map((row) => (
                      <tr key={row.event_name} className="border-t border-border">
                        <td className="px-2 py-2 text-foreground">{row.event_name}</td>
                        <td className="px-2 py-2 text-foreground-muted">{row.count.toLocaleString()}</td>
                        <td className="px-2 py-2 text-foreground-muted">{row.conversion_rate_pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
