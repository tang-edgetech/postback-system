"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
import { useSetupStatus } from "@/components/providers/setup-provider";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toTitleCase } from "@/lib/titlecase";

const LANGUAGE_OPTIONS = [{ value: "EN", label: "English" }];
const STEPS = ["Site Info", "Super Admin", "Review"] as const;
type Step = (typeof STEPS)[number];

export function SetupWizard() {
  const router = useRouter();
  const { refresh } = useAuth();
  const { availableRegions, markComplete } = useSetupStatus();

  const [step, setStep] = useState<Step>("Site Info");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [siteTitle, setSiteTitle] = useState("Postback System");
  const [siteUrl, setSiteUrl] = useState("");
  const [region, setRegion] = useState("GMT+8");
  const [language, setLanguage] = useState("EN");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");

  function goToSuperAdmin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStep("Super Admin");
  }

  function goToReview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== repeatPassword) {
      setError("Password and repeat password do not match.");
      return;
    }
    setStep("Review");
  }

  async function handleFinish() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/v1/setup/complete", {
        site_title: siteTitle.trim(),
        site_url: siteUrl.trim(),
        region,
        language,
        full_name: fullName.trim(),
        email: email.trim(),
        password,
      });
      await refresh();
      markComplete();
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div id="page-setup" className="c-setup flex min-h-screen items-center justify-center bg-background px-4">
      <div id="setup-card" className="c-setup__card w-full max-w-lg rounded-lg border border-border bg-surface p-8 shadow-sm">
        <h1 id="setup-title" className="c-setup__title text-xl font-semibold text-foreground">
          Welcome — Let&apos;s Set Up Your System
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">This runs once. You&apos;ll create the first Super Admin account and set a few basics.</p>

        <div id="setup-steps" className="mt-6 flex items-center gap-2 text-xs text-foreground-muted">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                  step === s ? "bg-accent text-accent-foreground" : STEPS.indexOf(step) > i ? "bg-emerald-500 text-white" : "bg-surface-alt"
                }`}
              >
                {i + 1}
              </span>
              <span className={step === s ? "font-medium text-foreground" : ""}>{s}</span>
              {i < STEPS.length - 1 && <span className="mx-1">→</span>}
            </div>
          ))}
        </div>

        {step === "Site Info" && (
          <form id="setup-site-form" onSubmit={goToSuperAdmin} className="mt-6 flex flex-col gap-4">
            <Input id="setup-site-title" label="Site Title" required value={siteTitle} onChange={(e) => setSiteTitle(e.target.value)} />
            <Input id="setup-site-url" label="Site URL" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="Captured automatically unless set" />
            <Select id="setup-region" label="Region" value={region} onChange={(e) => setRegion(e.target.value)} options={availableRegions.map((r) => ({ value: r, label: r }))} />
            <Select id="setup-language" label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} options={LANGUAGE_OPTIONS} />
            <div>
              <Button id="setup-next-1" type="submit" variant="primary">
                next
              </Button>
            </div>
          </form>
        )}

        {step === "Super Admin" && (
          <form id="setup-admin-form" onSubmit={goToReview} className="mt-6 flex flex-col gap-4">
            <Input id="setup-fullname" label="Full Name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <Input id="setup-email" label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <PasswordInput id="setup-password" label="Password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <PasswordInput id="setup-repeat-password" label="Repeat Password" required value={repeatPassword} onChange={(e) => setRepeatPassword(e.target.value)} />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button id="setup-back-1" type="button" variant="ghost" onClick={() => setStep("Site Info")}>
                back
              </Button>
              <Button id="setup-next-2" type="submit" variant="primary">
                next
              </Button>
            </div>
          </form>
        )}

        {step === "Review" && (
          <div className="mt-6 flex flex-col gap-4">
            <div className="rounded-md border border-border bg-background p-4 text-sm">
              <p className="text-foreground">
                <span className="text-foreground-muted">Site Title:</span> {siteTitle}
              </p>
              <p className="text-foreground">
                <span className="text-foreground-muted">Region / Language:</span> {region} / {toTitleCase(language)}
              </p>
              <p className="mt-2 text-foreground">
                <span className="text-foreground-muted">Super Admin:</span> {fullName} ({email})
              </p>
            </div>
            <p className="text-xs text-foreground-muted">You can add a logo and favicon later in Settings → General.</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button id="setup-back-2" type="button" variant="ghost" onClick={() => setStep("Super Admin")} disabled={submitting}>
                back
              </Button>
              <Button id="setup-finish" type="button" variant="primary" onClick={handleFinish} disabled={submitting}>
                {submitting ? "setting up" : "finish setup"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
