"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "ai-intel-theme";
const COOKIE_NAME = "ai_intel_theme";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore localStorage failures so the toggle still works for this session
  }

  document.cookie = `${COOKIE_NAME}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

interface ThemeToggleProps {
  initialTheme?: Theme;
}

export function ThemeToggle({ initialTheme = "light" }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const nextTheme = theme === "dark" ? "light" : "dark";
  const label = `${theme === "dark" ? "Dark" : "Light"} mode`;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        window.location.href = "/login";
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <button
      type="button"
      onClick={(event) => {
        if (event.shiftKey || event.altKey) {
          window.location.href = "/login";
          return;
        }
        setTheme(nextTheme);
        applyTheme(nextTheme);
      }}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
      className="surface-chip px-3 py-2 text-xs font-medium uppercase tracking-[0.16em]"
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--line)] bg-[color:var(--panel-strong)]"
      >
        {theme === "dark" ? (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            <path d="M21 12.8A9 9 0 0 1 11.2 3a1 1 0 0 0-1.3 1.2A7.5 7.5 0 1 0 19.8 14a1 1 0 0 0 1.2-1.2Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            <path d="M12 17.25A5.25 5.25 0 1 0 12 6.75a5.25 5.25 0 0 0 0 10.5ZM12 2.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 12 2.5Zm0 16.75a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V20a.75.75 0 0 1 .75-.75Zm9.5-7.25a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5a.75.75 0 0 1 .75.75ZM4.75 12a.75.75 0 0 1-.75.75H2.5a.75.75 0 0 1 0-1.5H4a.75.75 0 0 1 .75.75Zm13.36-6.11a.75.75 0 0 1 1.06 1.06l-1.06 1.06a.75.75 0 1 1-1.06-1.06l1.06-1.06Zm-11.16 11.16a.75.75 0 0 1 1.06 1.06L6.95 19.17a.75.75 0 1 1-1.06-1.06l1.06-1.06Zm12.22 1.06a.75.75 0 0 1-1.06 1.06l-1.06-1.06a.75.75 0 1 1 1.06-1.06l1.06 1.06ZM8.01 8.01a.75.75 0 0 1-1.06 0L5.89 6.95a.75.75 0 1 1 1.06-1.06l1.06 1.06a.75.75 0 0 1 0 1.06Z" />
          </svg>
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}
