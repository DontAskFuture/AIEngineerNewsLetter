"use client";

import Link from "next/link";
import { useState } from "react";
import { formatPractitionerTake } from "@ai-intel/shared";
import {
  addDocumentToReadListAction,
  markDocumentReadAction,
  removeDocumentFromReadListAction,
} from "../read-list/actions";
import {
  saveStoryCurationNoteAction,
  toggleStoryHideAction,
  toggleStoryPinAction,
} from "./actions";

interface FeedStoryActionsProps {
  documentId: number;
  isRead: boolean;
  isInReadList: boolean;
  isPinned: boolean;
  isHidden: boolean;
  curatorNote: string | null;
  whyRelevant: string | null;
  timeWindow: string;
  profileSlug: string;
}

export function FeedStoryActions({
  documentId,
  isRead,
  isInReadList,
  isPinned,
  isHidden,
  curatorNote,
  whyRelevant,
  timeWindow,
  profileSlug,
}: FeedStoryActionsProps) {
  const defaultTake = formatPractitionerTake(curatorNote, whyRelevant) ?? "";
  const [isEditingTake, setIsEditingTake] = useState(false);
  const [draftNote, setDraftNote] = useState(defaultTake);

  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <form action={toggleStoryPinAction}>
          <input type="hidden" name="documentId" value={documentId} />
          <input type="hidden" name="timeWindow" value={timeWindow} />
          <input type="hidden" name="profile" value={profileSlug} />
          <input type="hidden" name="isPinned" value={isPinned ? "false" : "true"} />
          <button
            type="submit"
            className={isPinned ? "button-primary text-xs" : "button-secondary text-xs"}
          >
            {isPinned ? "Unpin" : "Pin to Top 10"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setDraftNote(defaultTake);
            setIsEditingTake((prev) => !prev);
          }}
          className="button-secondary text-xs"
        >
          {curatorNote || whyRelevant ? "Edit My Take" : "Add My Take"}
        </button>

        <form action={toggleStoryHideAction}>
          <input type="hidden" name="documentId" value={documentId} />
          <input type="hidden" name="timeWindow" value={timeWindow} />
          <input type="hidden" name="profile" value={profileSlug} />
          <input type="hidden" name="isHidden" value={isHidden ? "false" : "true"} />
          <button type="submit" className="button-ghost text-xs">
            {isHidden ? "Unhide" : "Hide story"}
          </button>
        </form>
      </div>

      {isEditingTake ? (
        <div className="surface-panel-strong mt-2 w-full max-w-md rounded-[1.25rem] p-4 text-left">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor={`curator-note-${documentId}`}
              className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--leaf)]"
            >
              My Take (Public commentary)
            </label>
            {whyRelevant ? (
              <button
                type="button"
                onClick={() => setDraftNote(whyRelevant)}
                className="button-ghost text-xs"
              >
                Seed from AI note
              </button>
            ) : null}
          </div>
          <form action={saveStoryCurationNoteAction} className="mt-2 grid gap-3">
            <input type="hidden" name="documentId" value={documentId} />
            <input type="hidden" name="timeWindow" value={timeWindow} />
            <input type="hidden" name="profile" value={profileSlug} />
            <textarea
              id={`curator-note-${documentId}`}
              name="curatorNote"
              rows={3}
              maxLength={1000}
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
              placeholder="Share why this story matters, what builders should watch, or your contrarian take..."
              className="field-shell rounded-[1rem] px-3 py-2 text-sm leading-6"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <button type="submit" className="button-primary text-xs">
                  Save take
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingTake(false)}
                  className="button-ghost text-xs"
                >
                  Cancel
                </button>
              </div>
              {curatorNote ? (
                <button
                  type="submit"
                  onClick={() => setDraftNote("")}
                  className="button-ghost text-xs text-[color:var(--danger)]"
                >
                  Clear take
                </button>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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
    </div>
  );
}
