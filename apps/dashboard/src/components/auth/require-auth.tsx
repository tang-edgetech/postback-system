"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

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
