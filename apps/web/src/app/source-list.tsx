import { defaultSources, type SourceCategory } from "@ai-intel/shared";

const sourceGroups: { category: SourceCategory; label: string }[] = [
  { category: "community_feed", label: "News and community" },
  { category: "lab_blog", label: "Labs" },
  { category: "research_feed", label: "Research" },
  { category: "engineering_blog", label: "Engineering" },
  { category: "github", label: "Open source" },
];

export function SourceList() {
  const grouped = sourceGroups
    .map((group) => ({
      ...group,
      sources: defaultSources
        .filter((source) => source.category === group.category)
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .filter((group) => group.sources.length > 0);

  return (
    <footer className="mx-auto w-full max-w-7xl px-6 pb-10 sm:px-10">
      <div className="border-t border-[color:var(--line)] pt-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--muted)]">
          {defaultSources.length} sources
        </p>
        <div className="mt-3 space-y-2 text-sm leading-6 text-[color:var(--muted)]">
          {grouped.map((group) => (
            <p key={group.category}>
              <span className="font-medium text-[color:var(--ink)]">{group.label}</span>
              <span aria-hidden="true"> · </span>
              {group.sources.map((source, index) => (
                <span key={source.slug}>
                  {index > 0 ? ", " : null}
                  <a
                    href={source.baseUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={source.description}
                    className="underline-offset-2 hover:text-[color:var(--ink)] hover:underline"
                  >
                    {source.name}
                  </a>
                </span>
              ))}
            </p>
          ))}
        </div>
      </div>
    </footer>
  );
}
