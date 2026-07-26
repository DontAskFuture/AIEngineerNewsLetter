# AGENTS.md

## Scope
This file applies to `docs` and its subdirectories unless a deeper file overrides it.

## Architecture
- Holds product, planning, and operational-readiness notes that explain intent, roadmap, and deployment posture rather than runtime behavior.
- `feature-and-implementation-plan.md`: product thesis, target users, phased roadmap, and a target information-model/pipeline design.
- `oracle-cloud-deployment-readiness.md`: assessment of the Compose stack against a single Oracle Cloud VM, with blockers, nice-to-haves, a ranked fix list, and a phased execution plan.
- Product/roadmap docs describe aspirational architecture and are not guaranteed to match the current implementation; the readiness assessment is the exception and cites verified file/line evidence as of its stated date.

## Implementation Guidance
- Do not treat this directory as a source of truth for current runtime behavior; prefer the code-adjacent `AGENTS.md` files for that.
- Update the relevant doc here when product direction, scope, or roadmap phases materially change.
- New planning documents belong here rather than scattered in the repo root.
