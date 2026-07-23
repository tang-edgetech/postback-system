"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSetupStatus } from "@/components/providers/setup-provider";
import { useBranding } from "@/components/providers/branding-provider";

// Opposite of GuestOnly — the wizard route is only reachable while the system genuinely
// has zero users. Once setup is done, this route redirects away (checked server-side
// too by SetupHandler.Complete, this is just so the page itself isn't dead-end reachable).
export function SetupOnly({ children }: { children: React.ReactNode }) {
  const { needsSetup, loading } = useSetupStatus();
  const { loginPath } = useBranding();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !needsSetup) {
      router.replace(`/${loginPath}`);
    }
  }, [needsSetup, loading, loginPath, router]);

  if (loading || !needsSetup) {
    return (
      <div id="auth-loading" className="c-auth-loading flex min-h-screen items-center justify-center bg-background text-foreground-muted">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}
