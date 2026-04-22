import { redirect } from "next/navigation";
import { getAllowedEmailLabel, getCurrentUser } from "@/lib/auth";
import { loginAction } from "@/app/auth-actions";

export const dynamic = "force-dynamic";

const errorMessages: Record<string, string> = {
  missing_fields: "Enter both your email and password.",
  email_not_allowed: "This email is not on the allowlist yet.",
  password_too_short: "Use a password with at least 8 characters.",
  invalid_credentials: "Email or password is incorrect.",
  account_disabled: "This account is currently disabled.",
  unknown: "We could not sign you in. Please try again.",
};

interface LoginPageProps {
  searchParams?: Promise<{
    error?: string;
    email?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const currentUser = await getCurrentUser();

  if (currentUser) {
    redirect("/feed");
  }

  const params = searchParams ? await searchParams : undefined;
  const errorCode = typeof params?.error === "string" ? params.error : "";
  const email = typeof params?.email === "string" ? params.email : "";
  const errorMessage = errorCode ? errorMessages[errorCode] ?? errorMessages.unknown : null;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-7xl items-center px-6 pb-16 pt-6 sm:px-10">
      <section className="glass-card mx-auto grid w-full max-w-5xl gap-8 overflow-hidden rounded-[2rem] lg:grid-cols-[1.05fr_0.95fr]">
        <div className="border-b border-black/6 px-6 py-8 sm:px-10 lg:border-b-0 lg:border-r">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
            Private access
          </p>
          <h1 className="display-font mt-4 max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Sign in to the AI builder intelligence workspace.
          </h1>
          <div className="mt-6 space-y-4 text-sm leading-7 text-[color:var(--muted)] sm:text-base">
            <p>
              This workspace is currently closed to one approved email address. For now, only{" "}
              <span className="font-medium text-[color:var(--ink)]">{getAllowedEmailLabel()}</span> can create an
              account or sign back in.
            </p>
            <p>
              The first approved login will create the account in Postgres. Passwords are stored as salted
              hashes rather than plain text.
            </p>
          </div>
        </div>

        <div className="px-6 py-8 sm:px-10">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
            Email login
          </p>

          <form action={loginAction} className="mt-6 grid gap-4">
            <div className="grid gap-2">
              <label htmlFor="email" className="text-sm font-medium text-[color:var(--ink)]">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={email}
                className="rounded-2xl border border-black/10 bg-white/85 px-4 py-3 text-sm text-[color:var(--ink)] outline-none"
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
                autoComplete="current-password"
                className="rounded-2xl border border-black/10 bg-white/85 px-4 py-3 text-sm text-[color:var(--ink)] outline-none"
              />
            </div>

            {errorMessage ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              className="mt-2 rounded-full bg-[color:var(--ink)] px-5 py-3 text-sm font-medium text-white"
            >
              Sign in
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
