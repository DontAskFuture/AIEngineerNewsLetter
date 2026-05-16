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
      openRouterModel: process.env.OPENROUTER_MODEL?.trim() || "deepseek/deepseek-v4-flash",
      appBaseUrl: process.env.APP_BASE_URL?.trim() || "http://localhost:3000",
      appTimeZone: process.env.APP_TIME_ZONE?.trim() || "America/Los_Angeles",
      feedShowWhyRelevant,
      authAllowedEmails: allowedEmails.length > 0 ? allowedEmails : ["lianglingfan@gmail.com"],
      adminEmails: adminEmails.length > 0 ? adminEmails : ["lianglingfan@gmail.com"],
      authSessionDays: Number.isFinite(authSessionDays) && authSessionDays > 0 ? authSessionDays : 30,
    };
  }

  return cachedEnv;
}
