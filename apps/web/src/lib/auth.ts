import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@ai-intel/db";
import { loadWebEnv } from "@/lib/env";

const SESSION_COOKIE_NAME = "ai_intel_session";
const PASSWORD_HASH_BYTES = 64;
const PASSWORD_MIN_LENGTH = 8;

export interface AuthenticatedUser {
  id: number;
  email: string;
}

export class AuthError extends Error {
  code: "missing_fields" | "email_not_allowed" | "password_too_short" | "invalid_credentials" | "account_disabled";

  constructor(
    code: "missing_fields" | "email_not_allowed" | "password_too_short" | "invalid_credentials" | "account_disabled",
    message: string,
  ) {
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

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getSessionDurationMs() {
  const sessionDays = loadWebEnv().authSessionDays;
  const normalizedDays = Number.isFinite(sessionDays) && sessionDays > 0 ? sessionDays : 30;
  return normalizedDays * 24 * 60 * 60 * 1000;
}

function shouldUseSecureCookies() {
  const baseUrl = loadWebEnv().appBaseUrl;
  return Boolean(baseUrl && baseUrl.startsWith("https://"));
}

async function setSessionCookie(sessionToken: string, expiresAt: Date) {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
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

export async function signInWithPassword(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = password.trim();

  if (!normalizedEmail || !normalizedPassword) {
    throw new AuthError("missing_fields", "Email and password are required.");
  }

  if (!getAllowedEmails().includes(normalizedEmail)) {
    throw new AuthError("email_not_allowed", "This email address is not allowed yet.");
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

  if (!existingUser) {
    if (normalizedPassword.length < PASSWORD_MIN_LENGTH) {
      throw new AuthError(
        "password_too_short",
        `Passwords must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
      );
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

    return createdUser satisfies AuthenticatedUser;
  }

  if (!existingUser.isActive) {
    throw new AuthError("account_disabled", "This account has been disabled.");
  }

  const expectedHash = Buffer.from(existingUser.passwordHash, "hex");
  const providedHash = Buffer.from(hashPassword(normalizedPassword, existingUser.passwordSalt), "hex");

  if (expectedHash.length !== providedHash.length || !timingSafeEqual(expectedHash, providedHash)) {
    throw new AuthError("invalid_credentials", "Email or password is incorrect.");
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
  } satisfies AuthenticatedUser;
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

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
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

  await db
    .update(schema.authSessions)
    .set({
      lastSeenAt: now,
    })
    .where(eq(schema.authSessions.id, activeSession.sessionId));

  return {
    id: activeSession.userId,
    email: activeSession.email,
  } satisfies AuthenticatedUser;
}

export async function requireCurrentUser() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect("/login");
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
