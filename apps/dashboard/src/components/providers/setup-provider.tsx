"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

type SetupContextValue = {
  needsSetup: boolean | null;
  loading: boolean;
  availableRegions: string[];
  markComplete: () => void;
};

const SetupContext = createContext<SetupContextValue>({ needsSetup: null, loading: true, availableRegions: [], markComplete: () => {} });

export function SetupProvider({ children }: { children: React.ReactNode }) {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [availableRegions, setAvailableRegions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ needs_setup: boolean; available_regions: string[] }>("/v1/setup/status");
        setNeedsSetup(res.needs_setup);
        setAvailableRegions(res.available_regions ?? []);
      } catch {
        // If the check fails (API unreachable), don't block the app on it — fall
        // through as if setup is done; the login page will surface the real error.
        setNeedsSetup(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function markComplete() {
    setNeedsSetup(false);
  }

  return <SetupContext.Provider value={{ needsSetup, loading, availableRegions, markComplete }}>{children}</SetupContext.Provider>;
}

export function useSetupStatus() {
  return useContext(SetupContext);
}
