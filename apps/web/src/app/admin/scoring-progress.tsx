"use client";

import { useEffect, useState } from "react";
import type { ScoringJobState } from "@/lib/scoring-tracker";

interface ScoringStatusResponse {
  current: ScoringJobState;
  history: ScoringJobState[];
}

const POLL_INTERVAL_MS = 2000;

function StatusBadge({ status }: { status: ScoringJobState["status"] }) {
  const styles = {
    running: "status-pill status-pill--running",
    completed: "status-pill status-pill--success",
    failed: "status-pill status-pill--danger",
    idle: "status-pill status-pill--neutral",
  };
  const labels = {
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    idle: "Idle",
  };

  return (
    <span className={styles[status]}>
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

  useEffect(() => {
    let isActive = true;

    async function pollStatus() {
      try {
        const res = await fetch("/api/scoring-status");
        if (res.ok && isActive) {
          setData((await res.json()) as ScoringStatusResponse);
        }
      } catch {
        // ignore
      }
    }

    void pollStatus();
    const interval = setInterval(() => {
      void pollStatus();
    }, POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, []);

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
        <div className="surface-panel rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--warning)]">
              Scoring in progress
            </p>
            <StatusBadge status="running" />
          </div>
          <div className="mt-3">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--warning-soft)]">
              <div
                className="h-full rounded-full bg-[color:var(--warning)] transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-5 text-sm text-[color:var(--warning)]">
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
          <div className="table-shell min-w-[700px]">
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[13%]" />
                <col className="w-[13%]" />
                <col className="w-[16%]" />
                <col className="w-[10%]" />
                <col className="w-[18%]" />
                <col className="w-[12%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead className="table-head text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Progress</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Scored / Total</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Failed</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Started</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Duration</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {history.map((job, index) => {
                  const jobPct = job.totalDocuments > 0
                    ? Math.round(((job.scoredDocuments + job.failedDocuments) / job.totalDocuments) * 100)
                    : 0;

                  return (
                    <tr
                      key={`${job.startedAt}-${index}`}
                      className="table-row text-[color:var(--muted)]"
                    >
                      <td className="px-4 py-3 align-middle"><StatusBadge status={job.status} /></td>
                      <td className="px-4 py-3 align-middle tabular-nums">
                        <span className="mr-2">{jobPct}%</span>
                        <span className="text-xs">({job.currentBatch}/{job.totalBatches})</span>
                      </td>
                      <td className="px-4 py-3 align-middle tabular-nums">
                        <strong className="text-[color:var(--leaf)]">{job.scoredDocuments}</strong> / {job.totalDocuments}
                      </td>
                      <td
                        className={`px-4 py-3 text-right align-middle tabular-nums ${
                          job.failedDocuments > 0 ? "text-[color:var(--danger)]" : ""
                        }`}
                      >
                        {job.failedDocuments}
                      </td>
                      <td className="px-4 py-3 align-middle whitespace-nowrap tabular-nums">
                        {formatTime(job.startedAt)}
                      </td>
                      <td className="px-4 py-3 align-middle whitespace-nowrap tabular-nums">
                        {formatDuration(job.startedAt, job.completedAt)}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <span className="line-clamp-2" title={job.errorMessage ?? ""}>
                          {job.errorMessage ?? "-"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
