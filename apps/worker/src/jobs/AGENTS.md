# AGENTS.md

## Scope
This file applies to `apps/worker/src/jobs`.

## Architecture
- Job modules execute fetches and convert remote content into raw and normalized records.
- This is where endpoint-kind-specific behavior belongs.

## Implementation Guidance
- Treat every job as rerunnable.
- Use content hashes and canonical URLs consistently.
- Log operational details, but keep return values compact and machine-friendly.
- If new endpoint kinds or parsers are introduced, centralize them here.

