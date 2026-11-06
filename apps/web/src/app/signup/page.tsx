import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { signupAction } from "@/app/auth-actions";

export const dynamic = "force-dynamic";

const errorMessages: Record<string, string> = {
  missing_fields: "Enter both your email and password.",
  email_not_allowed: "This email is not on the allowlist yet.",
  password_too_short: "Use a password with at least 8 characters.",
  invalid_credentials: "Use a valid email and password.",
  email_already_exists: "An account with this email already exists.",
  too_many_attempts: "Too many attempts. Try again in a few minutes.",
  unknown: "We could not create your account. Please try again.",
};

interface SignupPageProps {
  searchParams?: Promise<{
    error?: string;
    email?: string;
  }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const currentUser = await getCurrentUser();

  if (currentUser) {
    redirect("/feed?window=week");
  }

  const params = searchParams ? await searchParams : undefined;
  const errorCode = typeof params?.error === "string" ? params.error : "";
  const email = typeof params?.email === "string" ? params.email : "";
  const errorMessage = errorCode ? errorMessages[errorCode] ?? errorMessages.unknown : null;

  return (
    <main className="page-shell min-h-[calc(100vh-8rem)] justify-center">
      <section className="glass-card mx-auto grid w-full max-w-5xl gap-8 overflow-hidden rounded-[2rem] lg:grid-cols-[1.05fr_0.95fr]">
        <div className="border-b border-[color:var(--line)] px-6 py-8 sm:px-10 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap gap-2">
            <span className="surface-chip px-3 py-2 text-xs font-medium uppercase tracking-[0.16em]">
              Create account
            </span>
            <span className="surface-chip px-3 py-2 text-xs font-medium uppercase tracking-[0.16em]">
              Single-customer beta
            </span>
          </div>
          <h1 className="display-font mt-4 max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Join the AI builder intelligence workspace.
          </h1>
          <div className="mt-6 space-y-4 text-sm leading-7 text-[color:var(--muted)] sm:text-base">
            <p>
              This workspace is currently closed to approved email addresses configured on the server.
            </p>
            <p>
              Passwords are stored as salted hashes rather than plain text.
            </p>
          </div>
          <div className="mt-8 grid gap-3">
            <div className="surface-panel rounded-[1.25rem] p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">Workspace shape</p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                Feed ranking, source monitoring, and admin operations all sit behind the same account.
              </p>
            </div>
            <div className="surface-panel rounded-[1.25rem] p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">Access model</p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                Signup is restricted today so we can tune the product around a single high-signal workflow.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-8 sm:px-10">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
            New account
          </p>

          <form action={signupAction} className="mt-6 grid gap-4">
            <div className="grid gap-2">
              <label htmlFor="email" className="text-sm font-medium text-[color:var(--ink)]">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                defaultValue={email}
                className="field-shell px-4 py-3 text-sm"
              />
            </div>

            <div className="grid gap-2">
              <label htmlFor="password" className="text-sm font-medium text-[color:var(--ink)]">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                maxLength={256}
                autoComplete="new-password"
                className="field-shell px-4 py-3 text-sm"
              />
            </div>

            {errorMessage ? (
              <div className="alert-error rounded-2xl px-4 py-3 text-sm">
                {errorMessage}
              </div>
            ) : null}

            <button type="submit" className="button-primary mt-2">
              Create account
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[color:var(--muted)]">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-[color:var(--ink)] underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
