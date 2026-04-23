"use client";

import { useState } from "react";
import {
  formatCategoryLabel,
  formatPercent,
  formatRelativeTime,
  summarizeText,
} from "@/lib/formatters";

interface MoreStoriesDocument {
  id: number;
  title: string;
  canonicalUrl: string;
  sourceName: string;
  category: string;
  sortTime: string;
  previewParagraph: string;
  matchScore: number | null;
}

interface MoreStoriesProps {
  documents: MoreStoriesDocument[];
}

const PAGE_SIZE = 20;

export function MoreStories({ documents }: MoreStoriesProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const visibleDocs = documents.slice(0, visibleCount);
  const hasMore = visibleCount < documents.length;

  return (
    <section>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="mb-4 flex items-center gap-3"
      >
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
          More stories
        </p>
        <span className="text-sm text-[color:var(--muted)]">
          ({documents.length})
        </span>
        <svg
          className={`h-4 w-4 text-[color:var(--muted)] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="grid gap-3">
          {visibleDocs.map((document) => (
            <article key={document.id} className="glass-card rounded-[1.25rem] px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-4xl">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                      {document.sourceName}
                    </p>
                    <span className="text-xs text-[color:var(--muted)]">
                      {formatRelativeTime(document.sortTime)}
                    </span>
                    {document.matchScore != null && (
                      <span className="rounded-full border border-black/10 bg-white/80 px-3 py-1 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                        Match {formatPercent(document.matchScore)}
                      </span>
                    )}
                  </div>
                  <a
                    href={document.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="display-font mt-1 block text-lg font-semibold tracking-tight"
                  >
                    {document.title}
                  </a>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                    {summarizeText(document.previewParagraph, "No first paragraph was extracted yet.")}
                  </p>
                </div>
                <span className="w-fit rounded-full border border-black/10 bg-white/80 px-3 py-1 text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)] sm:ml-auto">
                  {formatCategoryLabel(document.category)}
                </span>
              </div>
            </article>
          ))}

          {hasMore && (
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
              className="rounded-full border border-black/10 bg-white/60 px-5 py-3 text-center text-sm font-medium text-[color:var(--ink)]"
            >
              Load {Math.min(PAGE_SIZE, documents.length - visibleCount)} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
