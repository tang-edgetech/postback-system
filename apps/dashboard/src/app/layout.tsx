import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers/providers";
import { themeNoFlashScript } from "@/lib/theme-no-flash-script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Postback System Dashboard",
  description: "Postback System admin dashboard",
};

// The no-flash script below runs before React/hydration, straight from server-rendered
// HTML — it can't call useBranding() for the current login path, so this fetches it
// server-side and bakes it directly into the script text instead. Falls back to the
// default "login" on any fetch error, matching the [slug] route's same fail-safe.
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const loginPath = await getConfiguredLoginPath();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeNoFlashScript(loginPath) }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
