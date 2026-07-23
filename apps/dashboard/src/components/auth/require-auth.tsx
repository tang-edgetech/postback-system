"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { useBranding } from "@/components/providers/branding-provider";
import { IdleTimeoutModal } from "@/components/auth/idle-timeout-modal";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const { loginPath } = useBranding();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/${loginPath}`);
    }
  }, [status, loginPath, router]);

  if (status === "session_expired") {
    return <IdleTimeoutModal />;
  }

  if (status !== "authenticated") {
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
