"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "pb-theme";

// Public pages (login, the root redirector) always render light — theme choice is a
// dashboard-only, per-user preference and must not leak onto the public-facing screens.
function isPublicPath(pathname: string) {
  return pathname === "/" || pathname === "/login";
}

// Runs before paint (see the inline script in layout.tsx) so there is no flash-of-wrong-theme.
// Mirrors isPublicPath() above since it can't import it (runs as a raw string pre-hydration).
export const themeNoFlashScript = `
(function () {
  try {
    var p = window.location.pathname;
    if (p === '/' || p === '/login') return;
    var t = localStorage.getItem('${STORAGE_KEY}');
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  } catch (e) {}
})();
`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const pathname = usePathname();

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
    document.documentElement.setAttribute("data-theme", isPublicPath(pathname) ? "light" : theme);
  }, [theme, pathname]);

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
