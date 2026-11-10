import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdminReportHtml,
  buildAdminReportText,
  parseAdminEmails,
  type AdminReportSnapshot,
} from "./send-daily-admin-report";

describe("parseAdminEmails", () => {
  it("normalizes, deduplicates, and filters comma-separated admin emails", () => {
    const emails = parseAdminEmails("  LiangLingFan@gmail.com , invalid-email, lianglingfan@gmail.com ");
    assert.deepEqual(emails, ["lianglingfan@gmail.com"]);
  });
});

describe("buildAdminReportHtml and buildAdminReportText", () => {
  const sampleSnapshot: AdminReportSnapshot = {
    reportDate: "2026-11-09",
    generatedAt: new Date("2026-11-09T16:00:00Z"),
    subscribers: {
      emailActivePublicCount: 14,
      emailUnsubscribedPublicCount: 2,
      emailNew24hCount: 3,
      accountRecipientsCount: 1,
      emailsSent24hCount: 15,
      rssActive24hCount: 8,
      rssActive7dCount: 19,
      rssTotalClientsCount: 25,
      rssTotalRequestsCount: 340,
    },
    serverHealth: {
      overallStatus: "Healthy",
      dbLatencyMs: 7,
      dbSizePretty: "142 MB",
      totalDocumentsCount: 4120,
      totalRawDocumentsCount: 4300,
      totalDocumentScoresCount: 3980,
      scoredDocuments24hCount: 620,
      workerMemoryRssMb: 118,
      hostMemoryUsedMb: 1850,
      hostMemoryTotalMb: 11900,
      hostLoadAvg1m: 0.42,
      hostUptimeHours: 72,
      queueCompleted24hCount: 1450,
      queueFailed24hCount: 3,
      queueActiveCount: 1,
    },
    crawlStats: {
      activeSourcesCount: 122,
      activeEndpointsCount: 128,
      distinctSourcesCrawled24hCount: 120,
      distinctEndpointsCrawled24hCount: 126,
      fetchAttempts24hCount: 2800,
      fetchSucceeded24hCount: 2760,
      fetchFailed24hCount: 40,
      avgFetchDurationMs24h: 410,
      newDocumentsDiscovered24hCount: 185,
      recentFailedSources: [
        {
          sourceName: "Example Feed",
          endpointUrl: "https://example.com/rss.xml",
          httpStatus: 503,
          errorMessage: "HTTP 503 Service Unavailable",
          failureCount: 4,
        },
      ],
    },
  };

  it("renders subscriber counts, server health, and crawled source stats", () => {
    const html = buildAdminReportHtml(sampleSnapshot, "https://news.michaelliang.dev");
    const text = buildAdminReportText(sampleSnapshot, "https://news.michaelliang.dev");

    assert.match(html, /Daily Admin Operations Report · 2026-11-09/);
    assert.match(html, /Status: Healthy/);
    assert.match(html, /15 \(14 public subscribers \+ 1 account users\)/);
    assert.match(html, /8 unique clients in last 24h/);
    assert.match(html, /120 \/ 122 active sources/);
    assert.match(html, /Example Feed/);

    assert.match(text, /Overall Status: Healthy/);
    assert.match(text, /Total Active Email Recipients: 15/);
    assert.match(text, /Active RSS Readers: 8 unique clients \(24h\)/);
    assert.match(text, /Sources Crawled: 120 \/ 122 active sources/);
    assert.match(text, /Example Feed \(4x, HTTP 503\)/);
  });
});
