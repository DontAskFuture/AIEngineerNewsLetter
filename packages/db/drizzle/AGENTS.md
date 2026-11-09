# AGENTS.md

## Scope
This file applies to `packages/db/drizzle` and its subdirectories.

## Architecture
- This directory holds drizzle-kit's generated migration artifacts: numbered `NNNN_*.sql` migration files (through `0019`) and the `meta/_journal.json` plus `meta/NNNN_snapshot.json` schema snapshots. `0019` adds nullable `documents.story_topic` and `document_scores.opinion_model`.
- These files are generated output derived from `packages/db/src/schema.ts`, not hand-authored source.

## Implementation Guidance
- Never hand-edit files here, especially anything under `meta/`; a manually edited snapshot will desync from the real schema history and break future `db:generate` runs.
- To add a migration, edit `packages/db/src/schema.ts` first, then run `pnpm db:generate` (defined in `packages/db/package.json`) to produce a new `NNNN_*.sql` file and matching snapshot.
- Apply pending migrations with `pnpm db:migrate`.
- Prefer additive schema changes (new nullable columns, new tables, new indexes) so existing data and running services keep working through a deploy.
- Keep every generated migration file committed; do not squash, renumber, or delete past migrations.
