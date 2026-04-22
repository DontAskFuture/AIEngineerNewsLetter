const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function formatCategoryLabel(value: string) {
  return value.replaceAll("_", " ");
}

export function formatCompactNumber(value: number) {
  return compactNumberFormatter.format(value);
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return "Waiting for data";
  }

  return dateTimeFormatter.format(new Date(value));
}

export function formatFullDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return "Waiting for data";
  }

  return fullDateFormatter.format(new Date(value));
}

export function formatRelativeTime(value: Date | string | null | undefined) {
  if (!value) {
    return "Not yet available";
  }

  const now = Date.now();
  const target = new Date(value).getTime();
  const diffMs = target - now;
  const absoluteSeconds = Math.round(Math.abs(diffMs) / 1000);

  if (absoluteSeconds < 60) {
    return diffMs >= 0 ? "in under a minute" : "just now";
  }

  const absoluteMinutes = Math.round(absoluteSeconds / 60);

  if (absoluteMinutes < 60) {
    return diffMs >= 0 ? `in ${absoluteMinutes} min` : `${absoluteMinutes} min ago`;
  }

  const absoluteHours = Math.round(absoluteMinutes / 60);

  if (absoluteHours < 24) {
    return diffMs >= 0 ? `in ${absoluteHours} hr` : `${absoluteHours} hr ago`;
  }

  const absoluteDays = Math.round(absoluteHours / 24);

  return diffMs >= 0 ? `in ${absoluteDays} day` : `${absoluteDays} day ago`;
}

export function formatDuration(durationMs: number | null | undefined) {
  if (durationMs == null) {
    return "n/a";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

export function formatPercent(value: number) {
  return `${value.toFixed(0)}%`;
}

export function summarizeText(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }

  return value.length > 220 ? `${value.slice(0, 217)}...` : value;
}

