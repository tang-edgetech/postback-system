"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";

const GRACE_PERIOD_MS = 5 * 60 * 1000;

// Shown in place of the dashboard once the server-side session has expired from
// inactivity. The only way out is "Ok" (logout + redirect to /login) — but if that never
// gets clicked, force the same outcome after 5 minutes. Background tabs throttle/suspend
// JS timers, so a plain setTimeout can't be trusted alone — shownAt is a real timestamp,
// re-checked both by an interval and on visibilitychange so a tab that's been
// backgrounded past the grace period is caught the instant it's switched back to.
export function IdleTimeoutModal() {
  const { logout } = useAuth();
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    shownAtRef.current = Date.now();
    function checkExpired() {
      if (shownAtRef.current !== null && Date.now() - shownAtRef.current >= GRACE_PERIOD_MS) {
        logout();
      }
    }
    const interval = setInterval(checkExpired, 15_000);
    document.addEventListener("visibilitychange", checkExpired);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", checkExpired);
    };
  }, [logout]);

  return (
    <div id="idle-timeout-modal-backdrop" className="c-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        id="idle-timeout-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-timeout-modal-title"
        className="c-modal w-full max-w-sm rounded-lg bg-surface p-6 text-center shadow-xl"
      >
        <h2 id="idle-timeout-modal-title" className="text-[20px] leading-7 font-semibold text-foreground">
          Session Expired
        </h2>
        <p className="mt-2 text-sm text-foreground-muted">You&apos;ve been signed out due to inactivity. Please log in again to continue.</p>
        <div className="mt-6">
          <Button id="idle-timeout-ok" variant="primary" onClick={() => logout()}>
            Ok
          </Button>
        </div>
      </div>
    </div>
  );
}
