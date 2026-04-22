import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { loadWorkerEnv } from "../env";

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes("xml")) {
    return ".xml";
  }

  if (mimeType.includes("json")) {
    return ".json";
  }

  if (mimeType.includes("text/plain")) {
    return ".txt";
  }

  return ".html";
}

export async function persistRawPayload(contentHash: string, mimeType: string, body: string) {
  const env = loadWorkerEnv();
  const nestedDir = join(env.RAW_STORAGE_DIR, contentHash.slice(0, 2), contentHash.slice(2, 4));
  const storageKey = join(nestedDir, `${contentHash}${extensionForMimeType(mimeType)}`);

  await mkdir(dirname(storageKey), { recursive: true });
  await writeFile(storageKey, body, "utf8");

  return {
    storageKey,
    contentLength: Buffer.byteLength(body),
    extension: extname(storageKey),
  };
}

