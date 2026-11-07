function sanitizeHttpUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
  } catch {
    // Ignore invalid URL
  }
  return null;
}

const DEFAULT_BRAND_AUTHOR_BIO =
  "Opinionated daily curation of high-signal AI engineering, agent tooling, and inference infrastructure stories across 122 primary sources — with practitioner notes on what actually matters.";

let cachedEnv:
  | {
      openRouterApiKey: string | null;
      openRouterModel: string;
      appBaseUrl: string | null;
      appTimeZone: string;
      feedShowWhyRelevant: boolean;
      authAllowedEmails: string[];
      adminEmails: string[];
      authSessionDays: number;
      brandAuthorName: string;
      brandAuthorBio: string;
      brandXUrl: string | null;
      brandLinkedinUrl: string | null;
      brandGithubUrl: string | null;
    }
  | undefined;

export function loadWebEnv() {
  if (!cachedEnv) {
    const feedShowWhyRelevant = ["1", "true", "yes", "on"].includes(
      process.env.FEED_SHOW_WHY_RELEVANT?.trim().toLowerCase() || "",
    );
    const allowedEmails = (process.env.AUTH_ALLOWED_EMAILS?.trim() || "lianglingfan@gmail.com")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const adminEmails = (process.env.ADMIN_EMAILS?.trim() || "lianglingfan@gmail.com")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const authSessionDays = Number(process.env.AUTH_SESSION_DAYS?.trim() || "30");

    cachedEnv = {
      openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || null,
      openRouterModel: process.env.OPENROUTER_MODEL?.trim() || "deepseek/deepseek-v4-flash-0731",
      appBaseUrl: process.env.APP_BASE_URL?.trim() || "http://localhost:3000",
      appTimeZone: process.env.APP_TIME_ZONE?.trim() || "America/Los_Angeles",
      feedShowWhyRelevant,
      authAllowedEmails: allowedEmails.length > 0 ? allowedEmails : ["lianglingfan@gmail.com"],
      adminEmails: adminEmails.length > 0 ? adminEmails : ["lianglingfan@gmail.com"],
      authSessionDays: Number.isFinite(authSessionDays) && authSessionDays > 0 ? authSessionDays : 30,
      brandAuthorName: process.env.BRAND_AUTHOR_NAME?.trim() || "Founding AI Engineer",
      brandAuthorBio: process.env.BRAND_AUTHOR_BIO?.trim() || DEFAULT_BRAND_AUTHOR_BIO,
      brandXUrl: sanitizeHttpUrl(process.env.BRAND_X_URL),
      brandLinkedinUrl: sanitizeHttpUrl(process.env.BRAND_LINKEDIN_URL),
      brandGithubUrl: sanitizeHttpUrl(process.env.BRAND_GITHUB_URL),
    };
  }

  return cachedEnv;
}
