"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

type PublicSettings = { site_title: string; logo_path: string; favicon_path: string; discourage_indexing: boolean };

type BrandingContextValue = {
  siteTitle: string;
  logoUrl: string | null;
  faviconUrl: string | null;
};

const BrandingContext = createContext<BrandingContextValue>({ siteTitle: "Postback System", logoUrl: null, faviconUrl: null });

function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<BrandingContextValue>({ siteTitle: "Postback System", logoUrl: null, faviconUrl: null });
  const [discourageIndexing, setDiscourageIndexing] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<PublicSettings>("/v1/settings/public");
        setBranding({
          siteTitle: res.site_title || "Postback System",
          logoUrl: res.logo_path ? `${getApiBaseUrl()}${res.logo_path}` : null,
          faviconUrl: res.favicon_path ? `${getApiBaseUrl()}${res.favicon_path}` : null,
        });
        setDiscourageIndexing(res.discourage_indexing);
      } catch {
        // Branding is cosmetic — silently keep the defaults if this fails.
      }
    })();
  }, []);

  useEffect(() => {
    document.title = branding.siteTitle;
    const href = branding.faviconUrl ?? "/default-favicon.ico";
    // This tag is exclusively owned by BrandingProvider (there is no app/favicon.ico for
    // Next to auto-generate a competing one) — mutate the same node in place rather than
    // removing/replacing it, since React/Next never renders a <link rel="icon"> for this
    // app and there's nothing else that could hold a stale reference to it.
    let link = document.getElementById("dynamic-favicon") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = "dynamic-favicon";
      link.rel = "icon";
      document.head.appendChild(link);
    }
    const ext = href.split(".").pop()?.toLowerCase();
    const mime: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      svg: "image/svg+xml",
      ico: "image/x-icon",
      webp: "image/webp",
    };
    link.type = (ext && mime[ext]) || "image/x-icon";
    link.href = href;
  }, [branding]);

  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>("meta[name='robots']");
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    meta.content = discourageIndexing ? "noindex, nofollow" : "index, follow";
  }, [discourageIndexing]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  return useContext(BrandingContext);
}
