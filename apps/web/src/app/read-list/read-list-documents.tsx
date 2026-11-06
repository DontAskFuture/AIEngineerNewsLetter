import {
  formatCategoryLabel,
  formatDateTime,
  formatRelativeTime,
  summarizeText,
} from "@/lib/formatters";
import {
  markDocumentReadAction,
  removeDocumentFromReadListAction,
} from "./actions";

export interface ReadListStoryItem {
  id: number;
  title: string;
  canonicalUrl: string;
  sourceName: string;
  category: string;
  sortTime: string;
  savedAt: string;
  previewParagraph: string;
  isRead: boolean;
  readAt: string | null;
}

interface ReadListDocumentsProps {
  stories: ReadListStoryItem[];
  filter: string;
}

export function ReadListDocuments({ stories, filter }: ReadListDocumentsProps) {
  if (stories.length === 0) {
    return (
      <p className="mt-6 text-sm leading-7 text-[color:var(--muted)]">
        No stories match this filter.
      </p>
    );
  }

  return (
    <div className="mt-6 grid gap-4">
      {stories.map((story) => (
        <article
          key={story.id}
          className={`surface-panel rounded-[1.5rem] p-5 transition sm:p-6 ${story.isRead ? "opacity-80" : ""}`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-4xl">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                  {story.sourceName}
                </p>
                {story.isRead ? (
                  <span className="surface-chip px-3 py-1 text-xs uppercase tracking-[0.16em]">
                    Read{story.readAt ? ` ${formatRelativeTime(story.readAt)}` : ""}
                  </span>
                ) : null}
                <span className="text-xs text-[color:var(--muted)]">
                  Saved {formatRelativeTime(story.savedAt)}
                </span>
              </div>
              <a
                href={`/out/${story.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="display-font mt-2 block text-2xl font-semibold tracking-tight"
              >
                {story.title}
              </a>
              <p className="mt-3 text-sm leading-6 text-[color:var(--muted)] sm:text-base">
                {summarizeText(story.previewParagraph, "No preview was extracted yet.")}
              </p>
            </div>
            <div className="flex flex-col gap-2 text-left sm:items-end sm:text-right">
              <span className="surface-chip w-fit px-3 py-1 text-xs uppercase tracking-[0.18em]">
                {formatCategoryLabel(story.category)}
              </span>
              <span className="text-sm text-[color:var(--muted)]">
                {formatRelativeTime(story.sortTime)}
              </span>
              <span className="text-xs text-[color:var(--muted)]">
                {formatDateTime(story.sortTime)}
              </span>
              <form action={removeDocumentFromReadListAction}>
                <input type="hidden" name="documentId" value={story.id} />
                <input type="hidden" name="filter" value={filter} />
                <button type="submit" className="button-ghost text-xs">
                  Remove from read list
                </button>
              </form>
              {!story.isRead ? (
                <form action={markDocumentReadAction}>
                  <input type="hidden" name="documentId" value={story.id} />
                  <input type="hidden" name="filter" value={filter} />
                  <button type="submit" className="button-secondary text-xs">
                    Mark read
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
