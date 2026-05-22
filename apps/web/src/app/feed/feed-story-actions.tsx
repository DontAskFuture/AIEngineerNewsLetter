"use client";

import Link from "next/link";
import {
  addDocumentToReadListAction,
  markDocumentReadAction,
  removeDocumentFromReadListAction,
} from "../read-list/actions";

interface FeedStoryActionsProps {
  documentId: number;
  isRead: boolean;
  isInReadList: boolean;
  timeWindow: string;
  profileSlug: string;
}

export function FeedStoryActions({
  documentId,
  isRead,
  isInReadList,
  timeWindow,
  profileSlug,
}: FeedStoryActionsProps) {
  return (
    <div className="flex flex-col gap-2 sm:items-end">
      {isInReadList ? (
        <>
          <span className="surface-chip w-fit px-3 py-1 text-xs uppercase tracking-[0.16em]">
            In read list
          </span>
          <Link href="/read-list" className="button-ghost text-xs">
            Open read list
          </Link>
          <form action={removeDocumentFromReadListAction} className="sm:text-right">
            <input type="hidden" name="documentId" value={documentId} />
            <input type="hidden" name="timeWindow" value={timeWindow} />
            <input type="hidden" name="filter" value="all" />
            <input type="hidden" name="returnTo" value="feed" />
            <input type="hidden" name="profile" value={profileSlug} />
            <button type="submit" className="button-ghost text-xs">
              Remove from read list
            </button>
          </form>
        </>
      ) : (
        <form action={addDocumentToReadListAction} className="sm:text-right">
          <input type="hidden" name="documentId" value={documentId} />
          <input type="hidden" name="timeWindow" value={timeWindow} />
          <input type="hidden" name="filter" value="all" />
          <input type="hidden" name="returnTo" value="feed" />
          <input type="hidden" name="profile" value={profileSlug} />
          <button type="submit" className="button-secondary text-xs">
            Add to read list
          </button>
        </form>
      )}
      {!isRead ? (
        <form action={markDocumentReadAction} className="sm:text-right">
          <input type="hidden" name="documentId" value={documentId} />
          <input type="hidden" name="timeWindow" value={timeWindow} />
          <input type="hidden" name="filter" value="all" />
          <input type="hidden" name="returnTo" value="feed" />
          <input type="hidden" name="profile" value={profileSlug} />
          <button type="submit" className="button-ghost text-xs">
            Mark read
          </button>
        </form>
      ) : null}
    </div>
  );
}
