import { randomBytes } from "node:crypto";
import { getDb, schema } from "@ai-intel/db";
import { eq, sql } from "drizzle-orm";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export class InvalidSubscriberEmailError extends Error {
  constructor() {
    super("Enter a valid email address.");
    this.name = "InvalidSubscriberEmailError";
  }
}

export function normalizeSubscriberEmail(rawEmail: string): string {
  const cleaned = rawEmail.trim().toLowerCase();
  if (!cleaned || cleaned.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(cleaned)) {
    throw new InvalidSubscriberEmailError();
  }
  return cleaned;
}

export async function subscribeToNewsletter(rawEmail: string) {
  const email = normalizeSubscriberEmail(rawEmail);
  const db = getDb();
  const now = new Date();
  const token = randomBytes(24).toString("hex");

  const [subscriber] = await db
    .insert(schema.newsletterSubscribers)
    .values({
      email,
      unsubscribeToken: token,
      isActive: true,
      unsubscribedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.newsletterSubscribers.email],
      set: {
        isActive: true,
        unsubscribedAt: null,
        updatedAt: now,
      },
    })
    .returning({
      id: schema.newsletterSubscribers.id,
      email: schema.newsletterSubscribers.email,
      unsubscribeToken: schema.newsletterSubscribers.unsubscribeToken,
    });

  return subscriber;
}

export async function unsubscribeFromNewsletterByToken(rawToken: string): Promise<boolean> {
  const token = rawToken.trim();
  if (!token || token.length > 128) {
    return false;
  }

  const db = getDb();
  const now = new Date();
  const updated = await db
    .update(schema.newsletterSubscribers)
    .set({
      isActive: false,
      unsubscribedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.newsletterSubscribers.unsubscribeToken, token))
    .returning({ id: schema.newsletterSubscribers.id });

  return updated.length > 0;
}

export async function getActiveNewsletterSubscriberCount(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(schema.newsletterSubscribers)
    .where(eq(schema.newsletterSubscribers.isActive, true));

  return row?.count ?? 0;
}
