"use client";

import { ThemeProvider } from "@/components/providers/theme-provider";
import { ToastProvider } from "@/components/providers/toast-provider";
import { ConfirmProvider } from "@/components/providers/confirm-provider";
import { AuthProvider } from "@/components/providers/auth-provider";
import { BrandingProvider } from "@/components/providers/branding-provider";
import { SetupProvider } from "@/components/providers/setup-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <BrandingProvider>
      <ThemeProvider>
        <SetupProvider>
          <ToastProvider>
            <ConfirmProvider>
              <AuthProvider>{children}</AuthProvider>
            </ConfirmProvider>
          </ToastProvider>
        </SetupProvider>
      </ThemeProvider>
    </BrandingProvider>
  );
}
