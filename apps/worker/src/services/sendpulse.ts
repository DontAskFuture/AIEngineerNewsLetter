import { loadWorkerEnv } from "../env";

interface SendPulseTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface SendPulseSendResponse {
  result?: boolean;
  id?: string;
}

interface SendEmailInput {
  to: {
    email: string;
    name?: string;
  };
  subject: string;
  html: string;
  text: string;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function encodeEmailBody(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function getAccessToken() {
  const env = loadWorkerEnv();

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  if (!env.SENDPULSE_CLIENT_ID || !env.SENDPULSE_CLIENT_SECRET) {
    throw new Error("SendPulse client id and secret are required to send newsletters");
  }

  const response = await fetch(`${env.SENDPULSE_API_BASE_URL}/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: env.SENDPULSE_CLIENT_ID,
      client_secret: env.SENDPULSE_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`SendPulse auth failed with HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as SendPulseTokenResponse;

  if (!payload.access_token) {
    throw new Error("SendPulse auth response did not include an access token");
  }

  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };

  return cachedToken.accessToken;
}

export async function sendTransactionalEmail({ to, subject, html, text }: SendEmailInput) {
  const env = loadWorkerEnv();

  if (!env.SENDPULSE_FROM_EMAIL) {
    throw new Error("SENDPULSE_FROM_EMAIL is required to send newsletters");
  }

  const accessToken = await getAccessToken();
  const response = await fetch(`${env.SENDPULSE_API_BASE_URL}/smtp/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: {
        html: encodeEmailBody(html),
        text: encodeEmailBody(text),
        subject,
        from: {
          name: env.SENDPULSE_FROM_NAME,
          email: env.SENDPULSE_FROM_EMAIL,
        },
        to: [
          {
            name: to.name ?? to.email,
            email: to.email,
          },
        ],
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`SendPulse send failed with HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as SendPulseSendResponse;

  if (payload.result === false) {
    throw new Error("SendPulse rejected the email send request");
  }

  return {
    providerMessageId: payload.id ?? null,
  };
}
