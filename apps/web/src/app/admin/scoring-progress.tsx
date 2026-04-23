"use client";

import { useEffect, useState, useCallback } from "react";
import type { ScoringJobState } from "@/lib/scoring-tracker";

interface ScoringStatusResponse {
  current: ScoringJobState;
  history: ScoringJobState[];
}

const POLL_INTERVAL_MS = 2000;

function StatusBadge({ status }: { status: ScoringJobState["status"] }) {
  const styles = {
    running: "bg-amber-100 text-amber-700",
    completed: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
    idle: "bg-gray-100 text-gray-500",
  };
  const labels = {
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    idle: "Idle",
  };

  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function ScoringProgress() {
  const [data, setData] = useState<ScoringStatusResponse | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/scoring-status");
      if (res.ok) {
        setData((await res.json()) as ScoringStatusResponse);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [poll]);

  if (!data) return null;

  const { current, history } = data;
  const hasHistory = history.length > 0;
  const isRunning = current.status === "running";

  if (!hasHistory && current.status === "idle") return null;

  const pct = current.totalDocuments > 0
    ? Math.round(((current.scoredDocuments + current.failedDocuments) / current.totalDocuments) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {isRunning && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
          <div className="flex items-center gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-amber-700">
              Scoring in progress
            </p>
            <StatusBadge status="running" />
          </div>
          <div className="mt-3">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-amber-200/40">
              <div
                className="h-full rounded-full bg-amber-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-5 text-sm text-amber-800">
              <span>Batch {current.currentBatch}/{current.totalBatches}</span>
              <span>{pct}%</span>
              <span>Scored: <strong>{current.scoredDocuments}</strong>/{current.totalDocuments}</span>
              {current.failedDocuments > 0 && (
                <span>Failed: <strong>{current.failedDocuments}</strong></span>
              )}
              <span>Elapsed: {formatDuration(current.startedAt, null)}</span>
            </div>
          </div>
        </div>
      )}

      {hasHistory && (
        <div className="overflow-x-auto">
          <div className="min-w-[700px] overflow-hidden rounded-[1.25rem] border border-black/6">
            <div className="grid grid-cols-[0.5fr_0.6fr_0.6fr_0.5fr_0.6fr_0.6fr] gap-4 bg-[rgba(255,255,255,0.82)] px-4 py-3 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
              <span>Status</span>
              <span>Progress</span>
              <span>Scored / Total</span>
              <span>Failed</span>
              <span>Started</span>
              <span>Duration</span>
            </div>
            {history.map((job, index) => {
              const jobPct = job.totalDocuments > 0
                ? Math.round(((job.scoredDocuments + job.failedDocuments) / job.totalDocuments) * 100)
                : 0;

              return (
                <div
                  key={`${job.startedAt}-${index}`}
                  className="grid grid-cols-[0.5fr_0.6fr_0.6fr_0.5fr_0.6fr_0.6fr] gap-4 border-t border-black/6 bg-white/70 px-4 py-3 text-sm text-[color:var(--muted)]"
                >
                  <span><StatusBadge status={job.status} /></span>
                  <span>
                    <span className="mr-2">{jobPct}%</span>
                    <span className="text-xs">({job.currentBatch}/{job.totalBatches})</span>
                  </span>
                  <span>
                    <strong className="text-[color:var(--leaf)]">{job.scoredDocuments}</strong> / {job.totalDocuments}
                  </span>
                  <span className={job.failedDocuments > 0 ? "text-red-600" : ""}>
                    {job.failedDocuments}
                  </span>
                  <span>{formatTime(job.startedAt)}</span>
                  <span>{formatDuration(job.startedAt, job.completedAt)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
