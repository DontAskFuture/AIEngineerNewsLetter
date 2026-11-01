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

  const info = await transporter.sendMail({
    from: {
      name: env.SMTP_FROM_NAME,
      address: env.SMTP_FROM_EMAIL,
    },
    to: to.name ? { name: to.name, address: to.email } : to.email,
    subject,
    html,
    text,
  });

  return {
    providerMessageId: info.messageId || null,
  };
}
