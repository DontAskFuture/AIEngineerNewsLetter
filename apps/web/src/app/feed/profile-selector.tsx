"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface ProfileSelectorProfile {
  id: number;
  slug: string;
  displayName: string;
}

interface ProfileSelectorProps {
  profiles: ProfileSelectorProfile[];
  selectedSlug: string;
  timeWindow: string;
}

export function ProfileSelector({ profiles, selectedSlug, timeWindow }: ProfileSelectorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const activeSlug = pendingSlug && pendingSlug !== selectedSlug ? pendingSlug : selectedSlug;

  const selectProfile = (slug: string) => {
    if (slug === selectedSlug) {
      return;
    }

    setPendingSlug(slug);
    startTransition(() => {
      const params = new URLSearchParams({ profile: slug, window: timeWindow });
      router.push(`/feed?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <div className="mt-6 flex flex-wrap gap-3" aria-label="Interest profiles">
      {profiles.map((profile) => {
        const isActive = profile.slug === activeSlug;
        const isNavigating = isPending && profile.slug === pendingSlug && pendingSlug !== selectedSlug;

        return (
          <button
            key={profile.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => selectProfile(profile.slug)}
            className={isActive ? "button-primary" : "button-secondary"}
          >
            {profile.displayName}
            {isNavigating ? (
              <span className="text-xs uppercase tracking-[0.16em] opacity-70">Loading</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
