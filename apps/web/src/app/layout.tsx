import type { Metadata } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import Script from "next/script";
import { logoutAction } from "@/app/auth-actions";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { SourceList } from "./source-list";
import { ThemeToggle } from "./theme-toggle";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "AI Builder Intelligence",
  description: "Opinionated AI engineering & infrastructure signal synthesis workspace.",
  alternates: {
    types: {
      "application/rss+xml": "/rss.xml",
    },
  },
};

const themeBootstrapScript = `
(() => {
  try {
    const stored = window.localStorage.getItem("ai-intel-theme");
    const cookieMatch = document.cookie.match(/(?:^|; )ai_intel_theme=([^;]+)/);
    const cookieTheme = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;
    const resolved =
      stored ||
      cookieTheme ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const theme = resolved === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const currentUser = await getCurrentUser();
  const cookieTheme = cookieStore.get("ai_intel_theme")?.value;
  const initialTheme = cookieTheme === "dark" ? "dark" : "light";

  return (
    <html lang="en" data-theme={initialTheme} suppressHydrationWarning>
      <body className={`${sans.variable} ${display.variable}`}>
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrapScript}
        </Script>
        <div className="grid-fade min-h-screen">
          <div className="mx-auto w-full max-w-7xl px-6 pt-5 sm:px-10 sm:pt-6">
            <header className="header-shell flex flex-col gap-4 rounded-[1.75rem] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <Link href="/" className="flex flex-col gap-1">
                <span className="display-font text-lg font-semibold tracking-tight">AI Builder Intelligence</span>
                <span className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Signal synthesis workspace
                </span>
              </Link>
              <nav className="flex flex-wrap items-center gap-2 text-sm text-[color:var(--muted)]">
                {currentUser ? (
                  <>
                    <span className="surface-chip hidden px-3 py-2 text-xs uppercase tracking-[0.16em] sm:inline-flex">
                      {currentUser.email}
                    </span>
                    <Link href="/feed?window=week" className="button-secondary">
                      Feed
                    </Link>
                    <Link href="/read-list" className="button-secondary">
                      Read list
                    </Link>
                    {isAdmin(currentUser.email) ? (
                      <Link href="/admin" className="button-secondary">
                        Admin
                      </Link>
                    ) : null}
                    <ThemeToggle initialTheme={initialTheme} />
                    <form action={logoutAction}>
                      <button type="submit" className="button-ghost">
                        Logout
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <a
                      href="/rss.xml"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="button-secondary"
                    >
                      RSS
                    </a>
                    <ThemeToggle initialTheme={initialTheme} />
                  </>
                )}
              </nav>
            </header>
          </div>
          {children}
          <SourceList />
        </div>
      </body>
    </html>
  );
}
