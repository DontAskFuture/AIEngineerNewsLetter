"use client";

import { useTransition, useState, useEffect, useCallback } from "react";

interface ActionButtonProps {
  action: () => Promise<void>;
  label: string;
  pendingLabel: string;
  successMessage: string;
  className?: string;
}

export function ActionButton({ action, label, pendingLabel, successMessage, className }: ActionButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleClick = useCallback(() => {
    startTransition(async () => {
      await action();
      setToast(successMessage);
    });
  }, [action, successMessage]);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={`rounded-full px-5 py-3 text-sm font-medium text-white transition-opacity ${className ?? ""} ${isPending ? "opacity-60" : ""}`}
      >
        {isPending ? pendingLabel : label}
      </button>
      {toast && (
        <div className="absolute left-0 top-full z-10 mt-2 w-max max-w-xs animate-[fadeIn_0.2s_ease-out] rounded-xl border border-black/6 bg-white px-4 py-3 text-sm font-medium text-[color:var(--ink)] shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

interface StreamingActionButtonProps {
  apiUrl: string;
  label: string;
  pendingLabel: string;
  successMessage: string;
  className?: string;
}

export function StreamingActionButton({ apiUrl, label, pendingLabel, successMessage, className }: StreamingActionButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleClick = useCallback(async () => {
    setIsPending(true);
    try {
      // Fire the streaming request — don't await the full body,
      // just confirm it started successfully
      const res = await fetch(apiUrl, { method: "POST" });
      if (res.ok) {
        setToast(successMessage);
        // Read the stream in background so the connection stays alive
        const reader = res.body?.getReader();
        if (reader) {
          const pump = async () => {
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          };
          pump().catch(() => {});
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setToast(`Error: ${(data as Record<string, string>).error ?? res.statusText}`);
      }
    } catch {
      setToast("Failed to connect");
    } finally {
      setIsPending(false);
    }
  }, [apiUrl, successMessage]);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={`rounded-full px-5 py-3 text-sm font-medium text-white transition-opacity ${className ?? ""} ${isPending ? "opacity-60" : ""}`}
      >
        {isPending ? pendingLabel : label}
      </button>
      {toast && (
        <div className="absolute left-0 top-full z-10 mt-2 w-max max-w-xs animate-[fadeIn_0.2s_ease-out] rounded-xl border border-black/6 bg-white px-4 py-3 text-sm font-medium text-[color:var(--ink)] shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
