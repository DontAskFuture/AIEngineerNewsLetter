import type { Metadata } from "next";
import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { logoutAction } from "@/app/auth-actions";
import { getCurrentUser } from "@/lib/auth";
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
  description: "Phase 0 scaffold for the AI builder market intelligence platform.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const currentUser = await getCurrentUser();

  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable}`}>
        <div className="grid-fade min-h-screen">
          <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 sm:px-10">
            <Link href="/" className="display-font text-lg font-semibold tracking-tight">
              AI Builder Intelligence
            </Link>
            <nav className="flex items-center gap-3 text-sm text-[color:var(--muted)]">
              {currentUser ? (
                <>
                  <span className="hidden text-xs uppercase tracking-[0.16em] text-[color:var(--muted)] sm:inline">
                    {currentUser.email}
                  </span>
                  <Link href="/feed" className="rounded-full border border-black/5 bg-white/60 px-4 py-2">
                    Feed
                  </Link>
                  <Link href="/admin" className="rounded-full border border-black/5 bg-white/60 px-4 py-2">
                    Admin
                  </Link>
                  <form action={logoutAction}>
                    <button type="submit" className="rounded-full border border-black/5 bg-white/60 px-4 py-2">
                      Logout
                    </button>
                  </form>
                </>
              ) : (
                <Link href="/login" className="rounded-full border border-black/5 bg-white/60 px-4 py-2">
                  Login
                </Link>
              )}
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
