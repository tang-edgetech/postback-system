// Split out of theme-provider.tsx (a "use client" module) because layout.tsx is a
// Server Component that needs to call this directly, not just render it — a plain
// function export from a "use client" file can't be invoked from server code.
//
// Runs before paint/hydration, straight from server-rendered HTML — mirrors
// isPublicPath() in theme-provider.tsx since it can't import it (runs as a raw string,
// before React/context exist). loginPath has to be baked in server-side by layout.tsx,
// which fetches the current value before rendering this into the page's <head>.
export const THEME_STORAGE_KEY = "pb-theme";

export function themeNoFlashScript(loginPath: string) {
  return `
(function () {
  try {
    var p = window.location.pathname;
    if (p === '/' || p === '/${loginPath}') return;
    var t = localStorage.getItem('${THEME_STORAGE_KEY}');
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  } catch (e) {}
})();
`;
}
