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
}

function sanitizeHeaderField(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function sendTransactionalEmail({ to, subject, html, text }: SendEmailInput) {
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

  const cleanRecipientEmail = sanitizeHeaderField(to.email);
  const cleanRecipientName = to.name ? sanitizeHeaderField(to.name) : "";

  const info = await transporter.sendMail({
    from: {
      name: sanitizeHeaderField(env.SMTP_FROM_NAME),
      address: sanitizeHeaderField(env.SMTP_FROM_EMAIL),
    },
    to: cleanRecipientName
      ? { name: cleanRecipientName, address: cleanRecipientEmail }
      : cleanRecipientEmail,
    subject: sanitizeHeaderField(subject),
    html,
    text,
  });

  return {
    providerMessageId: info.messageId || null,
  };
}
