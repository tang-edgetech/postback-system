// Device/OS/Browser are parsed once at redirect time and stored as real columns on
// link_clicks (shared/uaparse) — these option lists drive filter dropdowns anywhere
// clicks are filtered (Single Link > Visits, Reports).
export const DEVICE_OPTIONS = ["Desktop", "Mobile", "Tablet", "Bot"];
export const OS_OPTIONS = ["Windows", "macOS", "Android", "iOS", "Linux", "Unknown"];
export const BROWSER_OPTIONS = ["Chrome", "Firefox", "Safari", "Edge", "Opera", "HTTP Client", "Unknown"];
