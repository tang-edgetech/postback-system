"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { useSetupStatus } from "@/components/providers/setup-provider";

export function GuestOnly({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const { needsSetup, loading: setupLoading } = useSetupStatus();
  const router = useRouter();

  useEffect(() => {
    if (setupLoading) return;
    if (needsSetup) {
      router.replace("/setup");
    } else if (status === "authenticated") {
      router.replace("/dashboard");
    }
  }, [status, needsSetup, setupLoading, router]);

  if (setupLoading || needsSetup || status === "loading" || status === "authenticated") {
    return (
      <div
        id="auth-loading"
        className="c-auth-loading flex min-h-screen items-center justify-center bg-background text-foreground-muted"
      >
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}
