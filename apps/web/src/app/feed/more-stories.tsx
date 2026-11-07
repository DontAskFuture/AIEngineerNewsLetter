"use client";

import { useState } from "react";
import {
  formatCategoryLabel,
  formatPercent,
  formatRelativeTime,
  summarizeText,
} from "@/lib/formatters";
import { FeedStoryActions } from "./feed-story-actions";

interface MoreStoriesDocument {
  id: number;
  title: string;
  canonicalUrl: string;
  sourceName: string;
  category: string;
  sortTime: string;
  previewParagraph: string;
  matchScore: number | null;
  whyRelevant: string | null;
  curatorNote: string | null;
  isPinned: boolean;
  isHidden: boolean;
  isRead: boolean;
  readAt: string | null;
}

interface MoreStoriesProps {
  documents: MoreStoriesDocument[];
  showWhyRelevant: boolean;
  showReadListActions: boolean;
  savedDocumentIds: number[];
  timeWindow: string;
  profileSlug: string;
  brandAuthorName: string;
}

const PAGE_SIZE = 20;

export function MoreStories({
  documents,
  showWhyRelevant,
  showReadListActions,
  savedDocumentIds,
  timeWindow,
  profileSlug,
  brandAuthorName,
}: MoreStoriesProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const savedDocumentIdSet = new Set(savedDocumentIds);

  const visibleDocs = documents.slice(0, visibleCount);
  const hasMore = visibleCount < documents.length;

  return (
    <section className="glass-card rounded-[2rem] p-6 sm:p-8">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
            More stories
          </p>
          <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
            Secondary ranked results and fallback signals that still match your current time window.
          </p>
        </div>
        <span className="surface-chip px-3 py-2 text-xs uppercase tracking-[0.16em]">
          {documents.length} items
          <svg
            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="mt-6 grid gap-3">
          {visibleDocs.map((document) => (
            <article
              key={document.id}
              className={`surface-panel rounded-[1.25rem] px-5 py-4 transition sm:px-6 ${
                document.isRead || document.isHidden ? "opacity-75" : ""
              }`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-4xl">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                      {document.sourceName}
                    </p>
                    <span className="text-xs text-[color:var(--muted)]">
                      {formatRelativeTime(document.sortTime)}
                    </span>
                    {document.isPinned && (
                      <span className="surface-chip px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--leaf)]">
                        Pinned Pick
                      </span>
                    )}
                    {document.isHidden && (
                      <span className="surface-chip px-3 py-1 text-xs uppercase tracking-[0.16em] text-[color:var(--danger)]">
                        Hidden from public
                      </span>
                    )}
                    {document.isRead && (
                      <span className="surface-chip px-3 py-1 text-xs uppercase tracking-[0.16em]">
                        Read{document.readAt ? ` ${formatRelativeTime(document.readAt)}` : ""}
                      </span>
                    )}
                    {document.matchScore != null && (
                      <span className="surface-chip px-3 py-1 text-xs uppercase tracking-[0.16em]">
                        Match {formatPercent(document.matchScore)}
                      </span>
                    )}
                  </div>
                  <a
                    href={`/out/${document.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="display-font mt-1 block text-lg font-semibold tracking-tight"
                  >
                    {document.title}
                  </a>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                    {summarizeText(document.previewParagraph, "No first paragraph was extracted yet.")}
                  </p>
                  {document.curatorNote ? (
                    <div className="surface-panel-strong mt-3 border-l-4 border-[color:var(--leaf)] rounded-[1rem] p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--leaf)]">
                        {brandAuthorName}&apos;s Take
                      </p>
                      <p className="mt-2 text-sm leading-7 text-[color:var(--ink)]">
                        {document.curatorNote}
                      </p>
                    </div>
                  ) : null}
                  {showWhyRelevant && document.whyRelevant ? (
                    <div className="surface-panel-strong mt-3 rounded-[1rem] p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--leaf)]">
                        Why Relevant To You
                      </p>
                      <p className="mt-2 text-sm leading-7 text-[color:var(--ink)]">
                        {document.whyRelevant}
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  <span className="surface-chip w-fit px-3 py-1 text-xs uppercase tracking-[0.18em]">
                    {formatCategoryLabel(document.category)}
                  </span>
                  {showReadListActions ? (
                    <FeedStoryActions
                      documentId={document.id}
                      isRead={document.isRead}
                      isInReadList={savedDocumentIdSet.has(document.id)}
                      isPinned={document.isPinned}
                      isHidden={document.isHidden}
                      curatorNote={document.curatorNote}
                      whyRelevant={document.whyRelevant}
                      timeWindow={timeWindow}
                      profileSlug={profileSlug}
                    />
                  ) : null}
                </div>
              </div>
            </article>
          ))}

          {hasMore && (
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
              className="button-secondary"
            >
              Load {Math.min(PAGE_SIZE, documents.length - visibleCount)} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
