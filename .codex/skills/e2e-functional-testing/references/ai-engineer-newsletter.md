# AI Engineer Newsletter E2E Reference

Use this reference when testing `/Users/autumn/src/AIEngineerNewsLetter`.

## Runtime Assumptions

- The web app runs at `http://localhost:3000`.
- Docker Compose is the normal local runtime for web, worker, and Postgres.
- The Next.js app lives in `apps/web`.
- Shared schema and migrations live in `packages/db`.
- Test code should respect repo `AGENTS.md` policy when files inside the repo are changed.

## Useful Preflight Checks

- `docker compose ps`
- `curl -I http://localhost:3000/login`
- Inspect package scripts before inventing new commands.
- Confirm the test account is allowlisted; do not expose credentials in final output.

## Default Smoke Run

When this skill is invoked without a specific task, run this app-level smoke pass:

- Check Docker service health and `/login` reachability.
- Verify logged-out `/feed` and `/admin` redirect to `/login`.
- Verify login and signup forms render.
- Verify disallowed login shows the allowlist error.
- Sign up or log in with `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` if available.
- Verify the authenticated feed renders.
- Verify profile create, switch, duplicate-name validation, and delete behavior when selectors and data are available.
- Verify story click/read-state behavior when at least one story is available.
- Verify theme toggle changes the visible mode affordance.
- Report each item as passed, failed, or blocked.

## Test Credentials

- Read the test email from `E2E_TEST_EMAIL`.
- Read the test password from `E2E_TEST_PASSWORD`.
- Ensure `AUTH_ALLOWED_EMAILS` includes `E2E_TEST_EMAIL`.
- Do not print the password in command output, logs, or final responses.
- If the account does not exist, create it through the signup flow before testing login-only paths.

## High-Value Flows

- Logged-out `/feed` redirects to `/login`.
- Signup or login succeeds for the allowlisted email and fails for other emails.
- Feed renders top 10 personalized stories for the selected profile.
- Creating a profile persists and appears in Interest profiles.
- Switching profiles changes the rendered personalized ranking.
- Creating a duplicate profile name for the same user shows a clear error.
- Deleting a profile removes it and selects another available profile.
- Deleting the final profile is blocked or handled safely.
- Clicking a story hyperlink marks the story as read.
- Theme toggle supports light and dark mode without breaking major sections.
- Admin page contains operational controls and hides model details from the feed page.

## Test Data Guidance

- Prefer unique profile names such as `E2E Infra ${Date.now()}`.
- Clean up through the UI when the feature under test supports it.
- If direct database setup is needed, keep it scoped to the test user and avoid destructive truncation unless the user explicitly approves it.
- For external links, prevent accidental navigation from losing the app context by waiting for the popup or checking persisted read state after returning to the feed.

## Reporting

Include the exact Playwright command, the number of passing/failing tests, and artifact paths for traces or screenshots when failures occur. If Docker, secrets, or external APIs block a flow, say which dependency blocked it and what was still verified.
