"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GuestOnly } from "@/components/auth/guest-only";
import { useAuth } from "@/components/providers/auth-provider";
import { useBranding } from "@/components/providers/branding-provider";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ApiError } from "@/lib/api";
import { withMinDelay } from "@/lib/min-delay";
import { toTitleCase } from "@/lib/titlecase";

export default function LoginPage() {
  return (
    <GuestOnly>
      <LoginForm />
    </GuestOnly>
  );
}

function LoginForm() {
  const { login, verify2FA } = useAuth();
  const { siteTitle, logoUrl } = useBranding();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await withMinDelay(login(email, password));
      if ("two_fa_required" in result) {
        setPendingToken(result.pending_token);
      } else {
        router.replace("/dashboard");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setError(null);
    setSubmitting(true);
    try {
      await withMinDelay(verify2FA(pendingToken, code));
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (pendingToken) {
    return (
      <div id="page-login" className="c-login flex min-h-screen items-center justify-center bg-background px-4">
        <form
          id="login-2fa-form"
          onSubmit={handleVerify}
          className="c-login__card w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-sm"
        >
          <h1 id="login-2fa-title" className="c-login__title text-[22px] leading-7 font-semibold text-foreground">
            Verification Required
          </h1>
          <p className="c-login__subtitle mt-1 text-sm text-foreground-muted">Enter the 6-digit code from your authenticator app</p>

          <div className="mt-6 flex flex-col gap-4">
            <Input
              id="login-2fa-code"
              label="Verification Code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          {error && (
            <p id="login-2fa-error" role="alert" className="c-login__error mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          <Button id="login-2fa-submit" type="submit" variant="primary" className="mt-6 w-full" disabled={submitting}>
            {submitting ? (
              <>
                <Spinner />
                {toTitleCase("verifying")}
              </>
            ) : (
              "verify"
            )}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div id="page-login" className="c-login flex min-h-screen items-center justify-center bg-background px-4">
      <form
        id="login-form"
        onSubmit={handleSubmit}
        className="c-login__card w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-sm"
      >
        {logoUrl && <img id="login-logo" src={logoUrl} alt={siteTitle} className="mb-3 h-10 w-auto" />}
        <h1 id="login-title" className="c-login__title text-[22px] leading-7 font-semibold text-foreground">
          {siteTitle}
        </h1>
        <p className="c-login__subtitle mt-1 text-sm text-foreground-muted">Sign in to your dashboard</p>

        <div className="mt-6 flex flex-col gap-4">
          <Input
            id="login-email"
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <PasswordInput
            id="login-password"
            label="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p
            id="login-error"
            role="alert"
            className="c-login__error mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <Button id="login-submit" type="submit" variant="primary" className="mt-6 w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Spinner />
              {toTitleCase("signing in")}
            </>
          ) : (
            "login"
          )}
        </Button>
      </form>
    </div>
  );
}
