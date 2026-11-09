import nodemailer from "nodemailer";
import { loadWorkerEnv } from "../env";

interface SendEmailInput {
  to: {
    email: string;
    name?: string;
  };
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl?: string;
}

function sanitizeHeaderField(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function sanitizeHttpHeaderUrl(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = sanitizeHeaderField(value).replace(/[<>]/g, "");
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
  } catch {
    // Ignore invalid URLs
  }
  return null;
}

export function buildListUnsubscribeHeaders(
  fromEmail: string,
  unsubscribeUrl?: string,
): Record<string, string> {
  const cleanFromEmail = sanitizeHeaderField(fromEmail).replace(/[<>]/g, "");
  const cleanUnsubscribeUrl = sanitizeHttpHeaderUrl(unsubscribeUrl);
  const mailtoEntry = cleanFromEmail ? `<mailto:${cleanFromEmail}?subject=unsubscribe>` : null;

  if (cleanUnsubscribeUrl) {
    const entries = [`<${cleanUnsubscribeUrl}>`, mailtoEntry].filter(Boolean);
    return {
      "List-Unsubscribe": entries.join(", "),
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }

  if (mailtoEntry) {
    return {
      "List-Unsubscribe": mailtoEntry,
    };
  }

  return {};
}

export async function sendTransactionalEmail({
  to,
  subject,
  html,
  text,
  unsubscribeUrl,
}: SendEmailInput) {
  const env = loadWorkerEnv();

  if (!env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM_EMAIL) {
    throw new Error("SMTP_USER, SMTP_PASSWORD, and SMTP_FROM_EMAIL are required to send newsletters");
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
  });

  const cleanFromEmail = sanitizeHeaderField(env.SMTP_FROM_EMAIL);
  const cleanRecipientEmail = sanitizeHeaderField(to.email);
  const cleanRecipientName = to.name ? sanitizeHeaderField(to.name) : "";
  const headers = buildListUnsubscribeHeaders(cleanFromEmail, unsubscribeUrl);

  const info = await transporter.sendMail({
    from: {
      name: sanitizeHeaderField(env.SMTP_FROM_NAME),
      address: cleanFromEmail,
    },
    to: cleanRecipientName
      ? { name: cleanRecipientName, address: cleanRecipientEmail }
      : cleanRecipientEmail,
    subject: sanitizeHeaderField(subject),
    html,
    text,
    headers,
  });

  return {
    providerMessageId: info.messageId || null,
  };
}
