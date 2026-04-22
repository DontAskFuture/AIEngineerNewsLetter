const trackingKeys = new Set(["fbclid", "gclid", "mc_cid", "mc_eid", "ref", "ref_src"]);

export function canonicalizeUrl(value: string) {
  const url = new URL(value);

  url.hash = "";

  for (const key of Array.from(url.searchParams.keys())) {
    if (key.startsWith("utm_") || trackingKeys.has(key)) {
      url.searchParams.delete(key);
    }
  }

  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  return url.toString();
}

