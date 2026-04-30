let cachedEnv:
  | {
      openRouterApiKey: string | null;
      openRouterModel: string;
      appBaseUrl: string | null;
      appTimeZone: string;
      authAllowedEmails: string[];
      adminEmails: string[];
      authSessionDays: number;
    }
  | undefined;

export function loadWebEnv() {
  if (!cachedEnv) {
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
      authAllowedEmails: allowedEmails.length > 0 ? allowedEmails : ["lianglingfan@gmail.com"],
      adminEmails: adminEmails.length > 0 ? adminEmails : ["lianglingfan@gmail.com"],
      authSessionDays: Number.isFinite(authSessionDays) && authSessionDays > 0 ? authSessionDays : 30,
    };
  }

  return cachedEnv;
}
