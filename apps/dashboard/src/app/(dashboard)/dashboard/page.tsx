"use client";

import { useAuth } from "@/components/providers/auth-provider";
import { toTitleCase } from "@/lib/titlecase";

export default function OverviewPage() {
  const { user } = useAuth();

  return (
    <div id="page-overview" className="c-overview">
      <h1 id="overview-title" className="c-overview__title text-2xl font-semibold text-foreground">
        Overview
      </h1>
      <p id="overview-welcome" className="c-overview__welcome mt-1 text-foreground-muted">
        Welcome back, {user?.full_name} ({toTitleCase(user?.role ?? "")}).
      </p>
    </div>
  );
}
