"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/providers/toast-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ArrowLeftIcon } from "@/components/icons";

type CampaignOption = { id: number; name: string; tenant_id: number; tenant_name: string };

const TYPE_OPTIONS = [
  { value: "redirection", label: "Redirection" },
  { value: "cloaking", label: "Cloaking (Disabled)" },
];

const PARAM_MODE_OPTIONS = [
  { value: "cid_tid_only", label: "CID and TID Only" },
  { value: "pass_all", label: "Pass All Parameters" },
];

export function LinkForm() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [slug, setSlug] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [paramMode, setParamMode] = useState<"cid_tid_only" | "pass_all">("cid_tid_only");
  const [campaignId, setCampaignId] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState("");
  const [remarks, setRemarks] = useState("");

  const selectedMerchantName = useMemo(() => campaigns.find((c) => String(c.id) === campaignId)?.tenant_name ?? "", [campaigns, campaignId]);

  useEffect(() => {
    (async () => {
      try {
        const campaignRes = await api.get<{ items: CampaignOption[] }>("/v1/campaigns?per_page=200&status=active");
        setCampaigns(campaignRes.items);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Could not load form data.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const confirmed = await confirm({ title: "Create This Link?" });
    if (!confirmed) return;

    setSubmitting(true);
    const payload = {
      destination_url: destinationUrl.trim(),
      param_mode: paramMode,
      campaign_id: Number(campaignId),
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      remarks: remarks.trim(),
      slug: slug.trim(),
      type: "redirection",
    };

    try {
      await api.post("/v1/links", payload);
      toast.success("Link created successfully.");
      router.push("/links");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-foreground-muted">Loading…</p>;
  }

  return (
    <div id="page-links-create" className="c-link-form max-w-2xl">
      <div className="flex items-center gap-3">
        <IconButton id="link-form-back" icon={<ArrowLeftIcon />} label="Back" onClick={() => router.push("/links")} />
        <h1 className="text-[26px] leading-8 font-semibold text-foreground">Create Link</h1>
      </div>

      <form id="link-form" onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <Select id="link-type" label="Type" value="redirection" disabled options={TYPE_OPTIONS} />

        <Input id="link-slug" label="Slug (Optional)" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="Leave blank to auto-generate" />

        <Input
          id="link-destination-url"
          label="Destination URL"
          type="url"
          required
          value={destinationUrl}
          onChange={(e) => setDestinationUrl(e.target.value)}
          placeholder="https://example.com/landing"
        />

        <Select id="link-param-mode" label="Original Parameter" value={paramMode} onChange={(e) => setParamMode(e.target.value as typeof paramMode)} options={PARAM_MODE_OPTIONS} />

        <Select
          id="link-campaign"
          label="Campaign"
          required
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          options={[{ value: "", label: "Select a Campaign" }, ...campaigns.map((c) => ({ value: String(c.id), label: c.name }))]}
        />

        <Input id="link-merchant" label="Merchant" value={selectedMerchantName} disabled placeholder="Derived from selected Campaign" className="cursor-not-allowed" />

        <div className="c-field flex flex-col gap-1">
          <label htmlFor="link-expires-at" className="c-field__label text-md font-medium text-foreground">
            Expires At (Optional)
          </label>
          <input
            id="link-expires-at"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
          <p className="text-md text-foreground-muted">Leave blank for a permanent link.</p>
        </div>

        <div className="c-field flex flex-col gap-1">
          <label htmlFor="link-remarks" className="c-field__label text-md font-medium text-foreground">
            Remarks (Optional)
          </label>
          <textarea
            id="link-remarks"
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <Button id="link-form-submit" type="submit" variant="primary" disabled={submitting}>
            {submitting ? "creating" : "create link"}
          </Button>
          <Button id="link-form-cancel" type="button" variant="secondary" onClick={() => router.push("/links")}>
            cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
