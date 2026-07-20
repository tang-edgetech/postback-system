"use client";

import { SetupOnly } from "@/components/auth/setup-only";
import { SetupWizard } from "@/components/setup-wizard";

export default function SetupPage() {
  return (
    <SetupOnly>
      <SetupWizard />
    </SetupOnly>
  );
}
