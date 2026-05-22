import Link from "next/link";
import { requireCurrentUser } from "@/lib/auth";
import { getReadListSnapshot, type ReadListFilter } from "@/lib/document-read-list";
import { ReadListDocuments } from "./read-list-documents";

export const dynamic = "force-dynamic";

interface ReadListPageProps {
  searchParams?: Promise<{
    filter?: string;
  }>;
}

const FILTER_OPTIONS: { value: ReadListFilter; label: string }[] = [
  { value: "all", label: "All saved" },
  { value: "unread", label: "Unread only" },
];

export default async function ReadListPage({ searchParams }: ReadListPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const rawFilter = typeof params?.filter === "string" ? params.filter : "all";
  const filter: ReadListFilter = rawFilter === "unread" ? "unread" : "all";
  const returnPath = `/read-list?filter=${filter}`;
  const currentUser = await requireCurrentUser(returnPath);

  const snapshot = await getReadListSnapshot(currentUser.id, filter);

  return (
    <main className="page-shell">
      <section className="glass-card rounded-[2rem] p-6 sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
          Story read list
        </p>
        <h1 className="display-font mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Stories to read later
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
          Save individual stories from the feed with Add to read list. Open a story to mark it read,
          or use Mark read without leaving the page.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {FILTER_OPTIONS.map((option) => {
            const isActive = snapshot.activeFilter === option.value;
            return (
              <Link
                key={option.value}
                href={`/read-list?filter=${option.value}`}
                className={isActive ? "button-primary" : "button-secondary"}
              >
                {option.label}
              </Link>
            );
          })}
        </div>

        <p className="mt-4 text-sm text-[color:var(--muted)]">
          {snapshot.savedCount} saved stor{snapshot.savedCount === 1 ? "y" : "ies"} ·{" "}
          {snapshot.unreadCount} unread
        </p>
      </section>

      <section className="glass-card rounded-[2rem] p-6 sm:p-8">
        {snapshot.savedCount === 0 ? (
          <p className="text-sm leading-7 text-[color:var(--muted)]">
            Your read list is empty. On the feed, use Add to read list on any story you want to read
            later.
          </p>
        ) : (
          <>
            <p className="text-sm text-[color:var(--muted)]">
              Showing {snapshot.stories.length} stor{snapshot.stories.length === 1 ? "y" : "ies"}
              {filter === "unread" ? " · unread only" : ""}
            </p>
            <ReadListDocuments
              stories={snapshot.stories.map((story) => ({
                id: story.id,
                title: story.title,
                canonicalUrl: story.canonicalUrl,
                sourceName: story.sourceName,
                category: story.category,
                sortTime: (story.sortTime instanceof Date
                  ? story.sortTime
                  : new Date(story.sortTime)
                ).toISOString(),
                savedAt: (story.savedAt instanceof Date
                  ? story.savedAt
                  : new Date(story.savedAt)
                ).toISOString(),
                previewParagraph: story.previewParagraph,
                isRead: story.isRead,
                readAt: story.readAt ? story.readAt.toISOString() : null,
              }))}
              filter={filter}
            />
          </>
        )}
      </section>
    </main>
  );
}
