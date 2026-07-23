import { notFound } from "next/navigation";
import { LoginView } from "@/components/auth/login-view";

// Catch-all for a single top-level segment — this is what makes the login page's URL
// admin-configurable (Settings > General > Login Path) instead of a fixed "/login".
// Static routes (dashboard/links/campaigns/... — see the (dashboard) group, and setup/)
// always win over this dynamic segment for the same path, so there's no risk of this
// swallowing a real route; it only ever fires for an unrecognized single-segment path.
//
// Fails "safe to log in" rather than "safe to hide" on a settings-fetch error — better
// to render the default login form during a transient API/DB blip than have that blip
// look like the whole site is down.
async function getConfiguredLoginPath(): Promise<string> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}/v1/settings/public`, { cache: "no-store" });
    const body = await res.json();
    const path = body?.data?.login_path;
    return typeof path === "string" && path ? path : "login";
  } catch {
    return "login";
  }
}

export default async function SlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loginPath = await getConfiguredLoginPath();

  if (slug !== loginPath) {
    notFound();
  }

  return <LoginView />;
}
