"use client";

import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { Sidebar } from "@/components/dashboard/sidebar";
import { IconButton } from "@/components/ui/icon-button";
import { MenuIcon } from "@/components/icons";

export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const evaluate = () => setSidebarOpen(window.innerWidth >= 1200);
    evaluate();
    window.addEventListener("resize", evaluate);
    return () => window.removeEventListener("resize", evaluate);
  }, []);

  return (
    <RequireAuth>
      <div id="dashboard-shell" className="c-dashboard-shell flex min-h-screen bg-background">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div
          id="dashboard-shell-main"
          className={`c-dashboard-shell__main flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ${
            sidebarOpen ? "min-[1200px]:pl-64" : "min-[1200px]:pl-0"
          }`}
        >
          <header
            id="dashboard-topbar"
            className="c-dashboard-topbar sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface px-4 py-3"
          >
            <IconButton id="sidebar-toggle" icon={<MenuIcon />} label="Toggle Menu" onClick={() => setSidebarOpen((v) => !v)} />
          </header>
          <main id="dashboard-content" className="c-dashboard-content min-w-0 flex-1 p-6">
            {children}
          </main>
        </div>
      </div>
    </RequireAuth>
  );
}
