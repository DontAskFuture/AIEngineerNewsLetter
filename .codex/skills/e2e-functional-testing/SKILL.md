---
name: e2e-functional-testing
description: Use when the user mentions this skill to run the project's Playwright E2E tests, or when testing frontend functionality end-to-end with Playwright/browser automation for localhost apps, auth flows, profile CRUD, feed rendering, story clicks, theme toggles, admin actions, redirects, or similar browser behavior.
---

# E2E Functional Testing

## Overview

Use this skill to turn frontend behavior into repeatable Playwright tests. Prefer deterministic test code over one-off manual clicking; use the in-app browser only for exploratory inspection, visual sanity checks, or when the user explicitly asks to interact with the current tab.

## Bare Invocation Behavior

If the user invokes this skill without a more specific request, run the standard E2E smoke test for the current project. For this repository, read `references/ai-engineer-newsletter.md`, verify the Docker app is running, use `.env` test credentials when authenticated flows are needed, then report which smoke flows passed, failed, or were blocked.

## Default Approach

- Use Playwright (`@playwright/test`) for automated functional coverage.
- Test user-visible outcomes: routes, visible text, form validation, disabled states, persisted state, and network-independent UI behavior.
- Prefer resilient selectors: `getByRole`, `getByLabel`, `getByText`, and accessible names.
- Avoid brittle selectors based on generated CSS, exact layout pixels, or implementation-only DOM structure.
- Keep each test focused on one user flow and isolate data with unique names such as `E2E ${Date.now()}`.
- If the repo has app-specific instructions, follow `AGENTS.md` and read a deeper scoped file before editing tests.

## Workflow

1. Inspect the repo for existing test setup: package manager, scripts, Playwright config, app routes, auth requirements, and Docker commands.
2. Verify the app is reachable, usually with `docker compose ps` and a quick request to the local base URL.
3. Identify the test data path: seed data, UI-created data, API helper, or direct database setup. Do not print secrets or passwords in logs.
4. Draft a small smoke matrix before writing tests. Cover the riskiest user journeys first, not every visual permutation.
5. Add or update Playwright specs in the repo's existing E2E location. If none exists, prefer `apps/web/e2e` for monorepos with a Next.js app under `apps/web`.
6. Run the narrowest useful command first, then the broader suite. Use Playwright traces, screenshots, and videos only when diagnosing failures or when already configured.
7. Report results with the exact command, pass/fail state, important artifact paths, and any residual manual checks.

## When Playwright Is Missing

- If the user asked to implement tests, add `@playwright/test`, `playwright.config.ts`, and package scripts that fit the existing package manager.
- Use a `webServer` config only when it is reliable in the local workflow. For Docker-first apps, prefer `baseURL` plus a pre-test instruction that containers must be running.
- Install browsers only if needed for the environment and allowed by the current task.
- Do not add a second E2E framework if the repo already has Cypress, Vitest browser mode, or an established Playwright setup; extend the existing choice unless there is a clear reason not to.

## Smoke Matrix Template

- Auth: logged-out protected routes redirect to login.
- Auth: allowed signup/login succeeds and disallowed users fail clearly.
- Primary page: key sections render after login.
- CRUD: create, update, switch/select, and delete user-owned records.
- Validation: duplicate names, required fields, and destructive-action guards.
- Personalization: switching profile or user context changes visible results.
- Read state: clicking an external/story link marks the item read.
- Admin: privileged actions are visible only to eligible users and trigger expected state.
- Theme/responsive: light/dark toggle persists and one mobile viewport remains usable.

## Playwright Patterns

```ts
import { expect, test } from "@playwright/test";

test("protected feed redirects to login", async ({ page }) => {
  await page.goto("/feed");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /sign in|log in/i })).toBeVisible();
});
```

```ts
const profileName = `E2E profile ${Date.now()}`;
await page.getByLabel(/profile name/i).fill(profileName);
await page.getByRole("button", { name: /add profile/i }).click();
await expect(page.getByRole("button", { name: profileName })).toBeVisible();
```

## Project Reference

For this repository, read `references/ai-engineer-newsletter.md` before adding or running E2E tests. It captures the current routes, Docker assumptions, test credential variables, and suggested smoke flows for this codebase.
