"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useBranding } from "@/components/providers/branding-provider";
import { THEME_STORAGE_KEY as STORAGE_KEY } from "@/lib/theme-no-flash-script";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Public pages (login, the root redirector) always render light — theme choice is a
// dashboard-only, per-user preference and must not leak onto the public-facing screens.
// loginPath is admin-configurable (Settings > General), so this can't be a fixed string.
// Mirrors the pre-hydration inline script in lib/theme-no-flash-script.ts.
function isPublicPath(pathname: string, loginPath: string) {
  return pathname === "/" || pathname === `/${loginPath}`;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const pathname = usePathname();
  const { loginPath } = useBranding();

  useEffect(() => {
    // Reading localStorage can only happen post-mount; doing this via a lazy useState
    // initializer instead would risk a server/client hydration mismatch on first paint.
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setThemeState(stored);
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isPublicPath(pathname, loginPath) ? "light" : theme);
  }, [theme, pathname, loginPath]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    // TODO(Phase 2): also persist to users.theme via the API.
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "light" ? "dark" : "light");
  }, [theme, setTheme]);

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
