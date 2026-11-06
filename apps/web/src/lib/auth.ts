import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@ai-intel/db";
import { loadWebEnv } from "@/lib/env";

const SESSION_COOKIE_NAME = "ai_intel_session";
const PASSWORD_HASH_BYTES = 64;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 256;
const EMAIL_MAX_LENGTH = 254;
const LOGIN_ATTEMPT_WINDOW_MINUTES = 15;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const MAX_FAILED_LOGIN_ATTEMPTS_PER_EMAIL = 15;
const MAX_FAILED_LOGIN_ATTEMPTS_PER_IP = 20;
const SESSION_LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;
const DUMMY_PASSWORD_SALT = "0123456789abcdef0123456789abcdef";
const DUMMY_PASSWORD_HASH = scryptSync("dummy-constant-time-password", DUMMY_PASSWORD_SALT, PASSWORD_HASH_BYTES);

export interface AuthenticatedUser {
  id: number;
  email: string;
}

export type AuthErrorCode =
  | "missing_fields"
  | "email_not_allowed"
  | "password_too_short"
  | "invalid_credentials"
  | "account_disabled"
  | "email_already_exists"
  | "too_many_attempts";

export class AuthError extends Error {
  code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, PASSWORD_HASH_BYTES).toString("hex");
}

function verifyPasswordConstantTime(
  password: string,
  salt: string | null | undefined,
  expectedHashHex: string | null | undefined,
): boolean {
  const effectiveSalt = salt || DUMMY_PASSWORD_SALT;
  const providedHash = scryptSync(
    password.slice(0, PASSWORD_MAX_LENGTH),
    effectiveSalt,
    PASSWORD_HASH_BYTES,
  );
  const expectedHash = expectedHashHex
    ? Buffer.from(expectedHashHex, "hex")
    : DUMMY_PASSWORD_HASH;

  if (expectedHash.length !== providedHash.length) {
    timingSafeEqual(DUMMY_PASSWORD_HASH, providedHash);
    return false;
  }

  return Boolean(expectedHashHex) && timingSafeEqual(expectedHash, providedHash);
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getSessionDurationMs() {
  const sessionDays = loadWebEnv().authSessionDays;
  const normalizedDays = Number.isFinite(sessionDays) && sessionDays > 0 ? sessionDays : 30;
  return normalizedDays * 24 * 60 * 60 * 1000;
}

async function shouldUseSecureCookies() {
  const baseUrl = loadWebEnv().appBaseUrl;
  if (baseUrl && baseUrl.startsWith("https://")) {
    return true;
  }
  try {
    const headerStore = await headers();
    const forwardedProto = headerStore.get("x-forwarded-proto");
    return forwardedProto?.split(",")[0]?.trim().toLowerCase() === "https";
  } catch {
    return false;
  }
}

async function setSessionCookie(sessionToken: string, expiresAt: Date) {
  const [cookieStore, secure] = await Promise.all([cookies(), shouldUseSecureCookies()]);

  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: expiresAt,
  });
}

export function getAllowedEmails() {
  return loadWebEnv().authAllowedEmails;
}

export function getAllowedEmailLabel() {
  return getAllowedEmails().join(", ");
}

export async function assertLoginAttemptAllowed(email: string, ipAddress: string) {
  const normalizedEmail = normalizeEmail(email).slice(0, EMAIL_MAX_LENGTH);
  const normalizedIp = ipAddress.slice(0, 128);

  if (!normalizedEmail && !normalizedIp) {
    return;
  }

  const db = getDb();
  const attemptedAfter = new Date(Date.now() - LOGIN_ATTEMPT_WINDOW_MINUTES * 60 * 1000);
  const [counts] = await db
    .select({
      emailIpFailedCount: sql<number>`count(*) filter (where ${schema.authLoginAttempts.email} = ${normalizedEmail} and ${schema.authLoginAttempts.ipAddress} = ${normalizedIp})::int`,
      emailFailedCount: sql<number>`count(*) filter (where ${schema.authLoginAttempts.email} = ${normalizedEmail})::int`,
      ipFailedCount: sql<number>`count(*) filter (where ${schema.authLoginAttempts.ipAddress} = ${normalizedIp})::int`,
    })
    .from(schema.authLoginAttempts)
    .where(
      and(
        eq(schema.authLoginAttempts.succeeded, false),
        gt(schema.authLoginAttempts.attemptedAt, attemptedAfter),
      ),
    );

  if (
    (counts?.emailIpFailedCount ?? 0) >= MAX_FAILED_LOGIN_ATTEMPTS ||
    (normalizedEmail && (counts?.emailFailedCount ?? 0) >= MAX_FAILED_LOGIN_ATTEMPTS_PER_EMAIL) ||
    (normalizedIp !== "unknown" && (counts?.ipFailedCount ?? 0) >= MAX_FAILED_LOGIN_ATTEMPTS_PER_IP)
  ) {
    throw new AuthError(
      "too_many_attempts",
      `Too many failed login attempts. Try again in ${LOGIN_ATTEMPT_WINDOW_MINUTES} minutes.`,
    );
  }
}

export async function recordLoginAttempt(email: string, ipAddress: string, succeeded: boolean) {
  const normalizedEmail = normalizeEmail(email).slice(0, EMAIL_MAX_LENGTH);

  if (!normalizedEmail) {
    return;
  }

  await getDb().insert(schema.authLoginAttempts).values({
    email: normalizedEmail,
    ipAddress: ipAddress.slice(0, 128),
    succeeded,
  });
}

export async function signUpWithPassword(email: string, password: string): Promise<AuthenticatedUser> {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = password.trim();

  if (!normalizedEmail || !normalizedPassword) {
    throw new AuthError("missing_fields", "Email and password are required.");
  }

  if (
    normalizedEmail.length > EMAIL_MAX_LENGTH ||
    !getAllowedEmails().includes(normalizedEmail)
  ) {
    throw new AuthError("email_not_allowed", "This email address is not allowed yet.");
  }

  if (normalizedPassword.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError(
      "password_too_short",
      `Passwords must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
    );
  }

  if (normalizedPassword.length > PASSWORD_MAX_LENGTH) {
    throw new AuthError(
      "invalid_credentials",
      `Passwords must be ${PASSWORD_MAX_LENGTH} characters or fewer.`,
    );
  }

  const db = getDb();

  const [existingUser] = await db
    .select({ id: schema.authUsers.id })
    .from(schema.authUsers)
    .where(eq(schema.authUsers.email, normalizedEmail))
    .limit(1);

  if (existingUser) {
    throw new AuthError("email_already_exists", "An account with this email already exists.");
  }

  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(normalizedPassword, passwordSalt);

  const [createdUser] = await db
    .insert(schema.authUsers)
    .values({
      email: normalizedEmail,
      passwordHash,
      passwordSalt,
      lastLoginAt: new Date(),
    })
    .returning({
      id: schema.authUsers.id,
      email: schema.authUsers.email,
    });

  if (!createdUser) {
    throw new AuthError("invalid_credentials", "We could not create this account.");
  }

  await createSessionForUser(createdUser.id);

  return createdUser;
}

export async function signInWithPassword(email: string, password: string): Promise<AuthenticatedUser> {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = password.trim();

  if (!normalizedEmail || !normalizedPassword) {
    throw new AuthError("missing_fields", "Email and password are required.");
  }

  if (
    normalizedEmail.length > EMAIL_MAX_LENGTH ||
    !getAllowedEmails().includes(normalizedEmail)
  ) {
    verifyPasswordConstantTime(normalizedPassword, null, null);
    throw new AuthError("email_not_allowed", "This email address is not allowed yet.");
  }

  if (normalizedPassword.length > PASSWORD_MAX_LENGTH) {
    verifyPasswordConstantTime(normalizedPassword, null, null);
    throw new AuthError("invalid_credentials", "Email or password is incorrect.");
  }

  const db = getDb();
  const [existingUser] = await db
    .select({
      id: schema.authUsers.id,
      email: schema.authUsers.email,
      passwordHash: schema.authUsers.passwordHash,
      passwordSalt: schema.authUsers.passwordSalt,
      isActive: schema.authUsers.isActive,
    })
    .from(schema.authUsers)
    .where(eq(schema.authUsers.email, normalizedEmail))
    .limit(1);

  const passwordValid = verifyPasswordConstantTime(
    normalizedPassword,
    existingUser?.passwordSalt,
    existingUser?.passwordHash,
  );

  if (!existingUser || !passwordValid) {
    throw new AuthError("invalid_credentials", "Email or password is incorrect.");
  }

  if (!existingUser.isActive) {
    throw new AuthError("account_disabled", "This account has been disabled.");
  }

  await db
    .update(schema.authUsers)
    .set({
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.authUsers.id, existingUser.id));

  await createSessionForUser(existingUser.id);

  return {
    id: existingUser.id,
    email: existingUser.email,
  };
}

export async function createSessionForUser(userId: number) {
  const db = getDb();
  const sessionToken = randomBytes(32).toString("base64url");
  const sessionTokenHash = hashSessionToken(sessionToken);
  const expiresAt = new Date(Date.now() + getSessionDurationMs());

  await db.insert(schema.authSessions).values({
    userId,
    sessionTokenHash,
    expiresAt,
    lastSeenAt: new Date(),
  });

  await setSessionCookie(sessionToken, expiresAt);
}

export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return null;
  }

  const db = getDb();
  const sessionTokenHash = hashSessionToken(sessionToken);
  const now = new Date();

  const [activeSession] = await db
    .select({
      sessionId: schema.authSessions.id,
      userId: schema.authUsers.id,
      email: schema.authUsers.email,
      lastSeenAt: schema.authSessions.lastSeenAt,
    })
    .from(schema.authSessions)
    .innerJoin(schema.authUsers, eq(schema.authUsers.id, schema.authSessions.userId))
    .where(
      and(
        eq(schema.authSessions.sessionTokenHash, sessionTokenHash),
        gt(schema.authSessions.expiresAt, now),
        eq(schema.authUsers.isActive, true),
      ),
    )
    .limit(1);

  if (!activeSession) {
    return null;
  }

  if (
    !activeSession.lastSeenAt ||
    now.getTime() - activeSession.lastSeenAt.getTime() > SESSION_LAST_SEEN_THROTTLE_MS
  ) {
    await db
      .update(schema.authSessions)
      .set({
        lastSeenAt: now,
      })
      .where(eq(schema.authSessions.id, activeSession.sessionId));
  }

  return {
    id: activeSession.userId,
    email: activeSession.email,
  } satisfies AuthenticatedUser;
});

export function getSafeRedirectPath(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    /[\u0000-\u001f\u007f\\]/.test(trimmed)
  ) {
    return null;
  }

  try {
    const parsed = new URL(trimmed, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export async function requireCurrentUser(loginNextPath?: string | null) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    const safeNext = getSafeRedirectPath(loginNextPath);
    redirect(safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login");
  }

  return currentUser;
}

export function isAdmin(email: string) {
  return loadWebEnv().adminEmails.includes(email.toLowerCase());
}

export async function getAuthenticatedAdmin(): Promise<{
  user: AuthenticatedUser | null;
  isAuthorized: boolean;
}> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { user: null, isAuthorized: false };
  }
  return { user: currentUser, isAuthorized: isAdmin(currentUser.email) };
}

export async function requireAdmin() {
  const currentUser = await requireCurrentUser();

  if (!isAdmin(currentUser.email)) {
    redirect("/feed?window=week");
  }

  return currentUser;
}

export async function logoutCurrentUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionToken) {
    const db = getDb();

    await db.delete(schema.authSessions).where(eq(schema.authSessions.sessionTokenHash, hashSessionToken(sessionToken)));
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}
