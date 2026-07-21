"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { useBranding } from "@/components/providers/branding-provider";
import { useTheme } from "@/components/providers/theme-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { useToast } from "@/components/providers/toast-provider";
import { toTitleCase } from "@/lib/titlecase";
import { withMinDelay } from "@/lib/min-delay";
import { Spinner } from "@/components/ui/spinner";
import {
  OverviewIcon,
  LinksIcon,
  CampaignsIcon,
  MerchantsIcon,
  UsersIcon,
  ProfileIcon,
  AuditLogsIcon,
  SettingsIcon,
  SunIcon,
  MoonIcon,
  LogoutIcon,
} from "@/components/icons";

type Role = "super_admin" | "admin" | "marketer";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Role[];
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: OverviewIcon },
  { href: "/links", label: "Links", icon: LinksIcon },
  { href: "/campaigns", label: "Campaigns", icon: CampaignsIcon },
  { href: "/merchants", label: "Merchants", icon: MerchantsIcon },
  { href: "/users", label: "Users", icon: UsersIcon, roles: ["super_admin", "admin"] },
  { href: "/profile", label: "Profile", icon: ProfileIcon },
  { href: "/audit-logs", label: "Audit Logs", icon: AuditLogsIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon, roles: ["super_admin"] },
];

type SidebarProps = {
  open: boolean;
  onClose: () => void;
};

export function Sidebar({ open, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const { siteTitle, faviconUrl } = useBranding();
  const { theme, toggleTheme } = useTheme();
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  const visibleItems = NAV_ITEMS.filter((item) => !item.roles || (user && item.roles.includes(user.role)));

  async function handleLogout() {
    const confirmed = await confirm({
      title: "Log Out?",
      message: "You will need to sign in again to access the dashboard.",
      confirmLabel: "Log Out",
      tone: "danger",
    });
    if (!confirmed) return;
    setLoggingOut(true);
    try {
      await withMinDelay(logout());
      toast.info("You have been logged out.");
      router.replace("/login");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <>
      {open && (
        <div
          id="sidebar-backdrop"
          className="c-sidebar-backdrop fixed inset-0 z-30 bg-black/40 min-[1200px]:hidden"
          onClick={onClose}
        />
      )}
      <aside
        id="app-sidebar"
        className={`c-sidebar fixed inset-y-0 left-0 top-0 z-40 flex h-screen max-h-screen w-64 flex-col border-r border-border bg-surface transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div id="sidebar-site-title" className="c-sidebar__title flex items-center gap-2 border-b border-border px-5 py-4">
          {faviconUrl && <img src={faviconUrl} alt="" className="h-8 w-8 rounded" />}
          <span className="text-[20px] leading-7 font-semibold text-foreground">{siteTitle}</span>
        </div>

        <div id="sidebar-user" className="c-sidebar__user border-b border-border px-5 py-4">
          <p className="c-sidebar__user-name text-sm font-medium text-foreground">{user?.full_name}</p>
          <p className="c-sidebar__user-role text-xs text-foreground-muted">{toTitleCase(user?.role ?? "")}</p>
        </div>

        <nav id="sidebar-nav" className="c-sidebar__nav flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-1">
            {visibleItems.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    id={`sidebar-link-${item.href.replace("/", "")}`}
                    href={item.href}
                    className={`c-sidebar__link flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "c-sidebar__link--active bg-accent text-accent-foreground"
                        : "text-foreground-muted hover:bg-surface-alt hover:text-foreground"
                    }`}
                  >
                    <Icon />
                    {toTitleCase(item.label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div id="sidebar-theme" className="c-sidebar__theme border-t border-border px-3 py-3">
          <button
            id="sidebar-theme-toggle"
            type="button"
            onClick={toggleTheme}
            className="c-sidebar__theme-btn flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-alt hover:text-foreground"
          >
            {theme === "light" ? <MoonIcon /> : <SunIcon />}
            {theme === "light" ? "Dark Mode" : "Light Mode"}
          </button>
        </div>

        <div id="sidebar-logout" className="c-sidebar__logout border-t border-border px-3 py-3">
          <button
            id="sidebar-logout-btn"
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="c-sidebar__logout-btn flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-red-950"
          >
            {loggingOut ? <Spinner /> : <LogoutIcon />}
            {loggingOut ? toTitleCase("logging out") : "Logout"}
          </button>
        </div>
      </aside>
    </>
  );
}
