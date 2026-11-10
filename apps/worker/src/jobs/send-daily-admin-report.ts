import os from "node:os";
import { getDb } from "@ai-intel/db";
import { normalizeSubscriberEmail, type SendDailyAdminReportPayload } from "@ai-intel/shared";
import { sql } from "drizzle-orm";
import { loadWorkerEnv } from "../env";
import { logger } from "../logger";
import { sendTransactionalEmail } from "../services/smtp";

export interface AdminFailedSourceItem {
  sourceName: string;
  endpointUrl: string;
  httpStatus: number | null;
  errorMessage: string | null;
  failureCount: number;
}

export interface AdminReportSnapshot {
  reportDate: string;
  generatedAt: Date;
  subscribers: {
    emailActivePublicCount: number;
    emailUnsubscribedPublicCount: number;
    emailNew24hCount: number;
    accountRecipientsCount: number;
    emailsSent24hCount: number;
    rssActive24hCount: number;
    rssActive7dCount: number;
    rssTotalClientsCount: number;
    rssTotalRequestsCount: number;
  };
  serverHealth: {
    overallStatus: "Healthy" | "Degraded";
    dbLatencyMs: number;
    dbSizePretty: string;
    totalDocumentsCount: number;
    totalRawDocumentsCount: number;
    totalDocumentScoresCount: number;
    scoredDocuments24hCount: number;
    workerMemoryRssMb: number;
    hostMemoryUsedMb: number;
    hostMemoryTotalMb: number;
    hostLoadAvg1m: number;
    hostUptimeHours: number;
    queueCompleted24hCount: number;
    queueFailed24hCount: number;
    queueActiveCount: number;
  };
  crawlStats: {
    activeSourcesCount: number;
    activeEndpointsCount: number;
    distinctSourcesCrawled24hCount: number;
    distinctEndpointsCrawled24hCount: number;
    fetchAttempts24hCount: number;
    fetchSucceeded24hCount: number;
    fetchFailed24hCount: number;
    avgFetchDurationMs24h: number;
    newDocumentsDiscovered24hCount: number;
    recentFailedSources: AdminFailedSourceItem[];
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function parseAdminEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const emails: string[] = [];

  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      const normalized = normalizeSubscriberEmail(trimmed);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        emails.push(normalized);
      }
    } catch {
      // Skip invalid entries
    }
  }

  return emails;
}

export async function collectAdminReportSnapshot(reportDate: string): Promise<AdminReportSnapshot> {
  const db = getDb();
  const dbStart = Date.now();
  await db.execute(sql`SELECT 1`);
  const dbLatencyMs = Date.now() - dbStart;

  const [
    subscriberRows,
    rssRows,
    storageRows,
    queueRows,
    crawlSummaryRows,
    failedSourceRows,
  ] = await Promise.all([
    db.execute<{
      active_public: number;
      unsubscribed_public: number;
      new_24h: number;
      active_auth_users: number;
      emails_sent_24h: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM newsletter_subscribers WHERE is_active = true) AS active_public,
        (SELECT count(*)::int FROM newsletter_subscribers WHERE is_active = false) AS unsubscribed_public,
        (SELECT count(*)::int FROM newsletter_subscribers WHERE is_active = true AND created_at > now() - interval '24 hours') AS new_24h,
        (SELECT count(*)::int FROM auth_users WHERE is_active = true) AS active_auth_users,
        (
          (SELECT count(*)::int FROM newsletter_sends WHERE sent_at > now() - interval '24 hours') +
          (SELECT count(*)::int FROM newsletter_subscribers WHERE last_sent_date = ${reportDate})
        ) AS emails_sent_24h
    `),
    db.execute<{
      active_24h: number;
      active_7d: number;
      total_clients: number;
      total_requests: number;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE last_seen_at > now() - interval '24 hours')::int AS active_24h,
        count(*) FILTER (WHERE last_seen_at > now() - interval '7 days')::int AS active_7d,
        count(*)::int AS total_clients,
        coalesce(sum(request_count), 0)::int AS total_requests
      FROM rss_feed_clients
    `),
    db.execute<{
      db_size_pretty: string;
      total_documents: number;
      total_raw_documents: number;
      total_document_scores: number;
      scored_24h: number;
    }>(sql`
      SELECT
        pg_size_pretty(pg_database_size(current_database())) AS db_size_pretty,
        (SELECT count(*)::int FROM documents) AS total_documents,
        (SELECT count(*)::int FROM raw_documents) AS total_raw_documents,
        (SELECT count(*)::int FROM document_scores) AS total_document_scores,
        (SELECT count(*)::int FROM document_scores WHERE scored_at > now() - interval '24 hours') AS scored_24h
    `),
    db.execute<{
      completed_24h: number;
      failed_24h: number;
      active_now: number;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE state = 'completed' AND created_on > now() - interval '24 hours')::int AS completed_24h,
        count(*) FILTER (WHERE state = 'failed' AND created_on > now() - interval '24 hours')::int AS failed_24h,
        count(*) FILTER (WHERE state = 'active')::int AS active_now
      FROM pgboss.job
      WHERE name IN ('fetch-source-endpoint', 'score-documents', 'send-daily-newsletter', 'send-daily-admin-report')
    `),
    db.execute<{
      active_sources: number;
      active_endpoints: number;
      distinct_sources_crawled_24h: number;
      distinct_endpoints_crawled_24h: number;
      fetch_attempts_24h: number;
      fetch_succeeded_24h: number;
      fetch_failed_24h: number;
      avg_duration_ms_24h: number;
      new_documents_24h: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM sources WHERE is_active = true) AS active_sources,
        (
          SELECT count(*)::int
          FROM source_endpoints se
          INNER JOIN sources s ON s.id = se.source_id
          WHERE se.is_active = true AND s.is_active = true
        ) AS active_endpoints,
        (
          SELECT count(DISTINCT s.id)::int
          FROM fetch_attempts fa
          INNER JOIN fetch_jobs fj ON fj.id = fa.fetch_job_id
          INNER JOIN source_endpoints se ON se.id = fj.source_endpoint_id
          INNER JOIN sources s ON s.id = se.source_id
          WHERE fa.finished_at > now() - interval '24 hours'
        ) AS distinct_sources_crawled_24h,
        (
          SELECT count(DISTINCT fj.source_endpoint_id)::int
          FROM fetch_attempts fa
          INNER JOIN fetch_jobs fj ON fj.id = fa.fetch_job_id
          WHERE fa.finished_at > now() - interval '24 hours'
        ) AS distinct_endpoints_crawled_24h,
        (SELECT count(*)::int FROM fetch_attempts WHERE finished_at > now() - interval '24 hours') AS fetch_attempts_24h,
        (SELECT count(*)::int FROM fetch_attempts WHERE finished_at > now() - interval '24 hours' AND status = 'succeeded') AS fetch_succeeded_24h,
        (SELECT count(*)::int FROM fetch_attempts WHERE finished_at > now() - interval '24 hours' AND status = 'failed') AS fetch_failed_24h,
        (SELECT coalesce(round(avg(duration_ms)), 0)::int FROM fetch_attempts WHERE finished_at > now() - interval '24 hours') AS avg_duration_ms_24h,
        (SELECT count(*)::int FROM documents WHERE discovered_at > now() - interval '24 hours') AS new_documents_24h
    `),
    db.execute<{
      source_name: string;
      endpoint_url: string;
      http_status: number | null;
      error_message: string | null;
      failure_count: number;
    }>(sql`
      SELECT
        s.name AS source_name,
        se.url AS endpoint_url,
        max(fa.http_status)::int AS http_status,
        max(fa.error_message) AS error_message,
        count(*)::int AS failure_count
      FROM fetch_attempts fa
      INNER JOIN fetch_jobs fj ON fj.id = fa.fetch_job_id
      INNER JOIN source_endpoints se ON se.id = fj.source_endpoint_id
      INNER JOIN sources s ON s.id = se.source_id
      WHERE fa.finished_at > now() - interval '24 hours'
        AND fa.status = 'failed'
      GROUP BY s.name, se.url
      ORDER BY count(*) DESC, max(fa.finished_at) DESC
      LIMIT 5
    `),
  ]);

  const subRow = subscriberRows.rows[0];
  const rssRow = rssRows.rows[0];
  const storeRow = storageRows.rows[0];
  const qRow = queueRows.rows[0];
  const crawlRow = crawlSummaryRows.rows[0];

  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
  const usedMemMb = Math.max(0, totalMemMb - freeMemMb);
  const workerRssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
  const loadAvg1m = Number((os.loadavg()[0] ?? 0).toFixed(2));
  const hostUptimeHours = Math.round(os.uptime() / 3600);

  const fetchAttempts24hCount = crawlRow?.fetch_attempts_24h ?? 0;
  const fetchSucceeded24hCount = crawlRow?.fetch_succeeded_24h ?? 0;
  const crawlSuccessRatio =
    fetchAttempts24hCount > 0 ? fetchSucceeded24hCount / fetchAttempts24hCount : 1;

  const overallStatus: "Healthy" | "Degraded" =
    dbLatencyMs < 500 && crawlSuccessRatio >= 0.7 && fetchAttempts24hCount > 0
      ? "Healthy"
      : "Degraded";

  return {
    reportDate,
    generatedAt: new Date(),
    subscribers: {
      emailActivePublicCount: subRow?.active_public ?? 0,
      emailUnsubscribedPublicCount: subRow?.unsubscribed_public ?? 0,
      emailNew24hCount: subRow?.new_24h ?? 0,
      accountRecipientsCount: subRow?.active_auth_users ?? 0,
      emailsSent24hCount: subRow?.emails_sent_24h ?? 0,
      rssActive24hCount: rssRow?.active_24h ?? 0,
      rssActive7dCount: rssRow?.active_7d ?? 0,
      rssTotalClientsCount: rssRow?.total_clients ?? 0,
      rssTotalRequestsCount: rssRow?.total_requests ?? 0,
    },
    serverHealth: {
      overallStatus,
      dbLatencyMs,
      dbSizePretty: storeRow?.db_size_pretty ?? "unknown",
      totalDocumentsCount: storeRow?.total_documents ?? 0,
      totalRawDocumentsCount: storeRow?.total_raw_documents ?? 0,
      totalDocumentScoresCount: storeRow?.total_document_scores ?? 0,
      scoredDocuments24hCount: storeRow?.scored_24h ?? 0,
      workerMemoryRssMb: workerRssMb,
      hostMemoryUsedMb: usedMemMb,
      hostMemoryTotalMb: totalMemMb,
      hostLoadAvg1m: loadAvg1m,
      hostUptimeHours,
      queueCompleted24hCount: qRow?.completed_24h ?? 0,
      queueFailed24hCount: qRow?.failed_24h ?? 0,
      queueActiveCount: qRow?.active_now ?? 0,
    },
    crawlStats: {
      activeSourcesCount: crawlRow?.active_sources ?? 0,
      activeEndpointsCount: crawlRow?.active_endpoints ?? 0,
      distinctSourcesCrawled24hCount: crawlRow?.distinct_sources_crawled_24h ?? 0,
      distinctEndpointsCrawled24hCount: crawlRow?.distinct_endpoints_crawled_24h ?? 0,
      fetchAttempts24hCount,
      fetchSucceeded24hCount,
      fetchFailed24hCount: crawlRow?.fetch_failed_24h ?? 0,
      avgFetchDurationMs24h: crawlRow?.avg_duration_ms_24h ?? 0,
      newDocumentsDiscovered24hCount: crawlRow?.new_documents_24h ?? 0,
      recentFailedSources: failedSourceRows.rows.map((row) => ({
        sourceName: row.source_name,
        endpointUrl: row.endpoint_url,
        httpStatus: row.http_status,
        errorMessage: row.error_message,
        failureCount: row.failure_count,
      })),
    },
  };
}

export function buildAdminReportHtml(snapshot: AdminReportSnapshot, baseUrl = "https://news.michaelliang.dev"): string {
  const { subscribers, serverHealth, crawlStats } = snapshot;
  const totalEmailRecipients = subscribers.emailActivePublicCount + subscribers.accountRecipientsCount;
  const crawlSuccessPct =
    crawlStats.fetchAttempts24hCount > 0
      ? Math.round((crawlStats.fetchSucceeded24hCount / crawlStats.fetchAttempts24hCount) * 100)
      : 100;
  const statusBadgeBg = serverHealth.overallStatus === "Healthy" ? "#dcfce7" : "#fef3c7";
  const statusBadgeColor = serverHealth.overallStatus === "Healthy" ? "#166534" : "#92400e";
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");

  const failedSourcesHtml =
    crawlStats.recentFailedSources.length > 0
      ? `
        <p style="margin:14px 0 6px 0;color:#182126;font-size:13px;font-weight:700;">
          Top Endpoint Failures (Last 24h)
        </p>
        <ul style="margin:0;padding-left:18px;color:#5f6a6f;font-size:13px;line-height:1.55;">
          ${crawlStats.recentFailedSources
            .map(
              (item) =>
                `<li style="margin:0 0 4px 0;"><strong style="color:#182126;">${escapeHtml(item.sourceName)}</strong> (${item.failureCount}x${item.httpStatus ? `, HTTP ${item.httpStatus}` : ""}) — ${escapeHtml((item.errorMessage ?? "Failed").slice(0, 120))}</li>`,
            )
            .join("")}
        </ul>
      `
      : `<p style="margin:12px 0 0 0;color:#2e5b4f;font-size:13px;">Zero endpoint failures in the last 24 hours.</p>`;

  return `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#f6f1e7;font-family:Arial,sans-serif;color:#182126;">
        <div style="max-width:680px;margin:0 auto;padding:32px 20px;">
          <div style="background:#fffaf0;border:1px solid #e3dccd;border-radius:24px;padding:28px;">
            <p style="margin:0 0 8px 0;color:#2e5b4f;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.18em;">
              Daily Admin Operations Report · ${escapeHtml(snapshot.reportDate)}
            </p>
            <h1 style="margin:0 0 12px 0;color:#182126;font-size:26px;line-height:1.2;">
              System Health, Subscribers &amp; Crawl Summary
            </h1>
            <p style="margin:0 0 24px 0;font-size:13px;">
              <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${statusBadgeBg};color:${statusBadgeColor};font-weight:700;">
                Status: ${escapeHtml(serverHealth.overallStatus)}
              </span>
              &nbsp;·&nbsp;
              <a href="${escapeHtml(`${cleanBaseUrl}/admin`)}" style="color:#2e5b4f;text-decoration:none;font-weight:600;">Open Admin Dashboard</a>
              &nbsp;·&nbsp;
              <a href="${escapeHtml(`${cleanBaseUrl}/feed`)}" style="color:#2e5b4f;text-decoration:none;font-weight:600;">Live Feed</a>
            </p>

            <div style="margin:0 0 20px 0;padding:18px 20px;background:#eef5f2;border-left:4px solid #2e5b4f;border-radius:14px;">
              <p style="margin:0 0 10px 0;color:#2e5b4f;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;">
                1. Audience &amp; Subscribers (Email + RSS)
              </p>
              <ul style="margin:0;padding-left:18px;color:#182126;font-size:15px;line-height:1.6;">
                <li><strong>Total Active Email Recipients:</strong> ${totalEmailRecipients} (${subscribers.emailActivePublicCount} public subscribers + ${subscribers.accountRecipientsCount} account users)</li>
                <li><strong>Email List Activity (24h):</strong> +${subscribers.emailNew24hCount} new subscribers · ${subscribers.emailUnsubscribedPublicCount} total unsubscribed · ${subscribers.emailsSent24hCount} emails delivered</li>
                <li><strong>Active RSS Readers:</strong> ${subscribers.rssActive24hCount} unique clients in last 24h · ${subscribers.rssActive7dCount} in last 7d (${subscribers.rssTotalClientsCount} all-time clients, ${subscribers.rssTotalRequestsCount} total feed polls)</li>
              </ul>
            </div>

            <div style="margin:0 0 20px 0;padding:18px 20px;background:#ffffff;border:1px solid #e3dccd;border-radius:14px;">
              <p style="margin:0 0 10px 0;color:#2e5b4f;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;">
                2. Server &amp; Pipeline Health
              </p>
              <ul style="margin:0;padding-left:18px;color:#182126;font-size:15px;line-height:1.6;">
                <li><strong>Database:</strong> ${serverHealth.dbLatencyMs} ms ping · ${escapeHtml(serverHealth.dbSizePretty)} size · ${serverHealth.totalDocumentsCount.toLocaleString()} stories (${serverHealth.totalRawDocumentsCount.toLocaleString()} raw payloads)</li>
                <li><strong>Host &amp; Worker Resources:</strong> Load ${serverHealth.hostLoadAvg1m} (1m) · Host RAM ${serverHealth.hostMemoryUsedMb}/${serverHealth.hostMemoryTotalMb} MB · Worker RSS ${serverHealth.workerMemoryRssMb} MB · Uptime ${serverHealth.hostUptimeHours}h</li>
                <li><strong>LLM Scoring (24h):</strong> ${serverHealth.scoredDocuments24hCount.toLocaleString()} stories scored (${serverHealth.totalDocumentScoresCount.toLocaleString()} total scores stored)</li>
                <li><strong>Job Queue (24h):</strong> ${serverHealth.queueCompleted24hCount.toLocaleString()} completed · ${serverHealth.queueActiveCount} active · ${serverHealth.queueFailed24hCount} failed</li>
              </ul>
            </div>

            <div style="margin:0;padding:18px 20px;background:#ffffff;border:1px solid #e3dccd;border-radius:14px;">
              <p style="margin:0 0 10px 0;color:#2e5b4f;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;">
                3. Source Crawling (Last 24h)
              </p>
              <ul style="margin:0;padding-left:18px;color:#182126;font-size:15px;line-height:1.6;">
                <li><strong>Sources Crawled:</strong> ${crawlStats.distinctSourcesCrawled24hCount} / ${crawlStats.activeSourcesCount} active sources (${crawlStats.distinctEndpointsCrawled24hCount} / ${crawlStats.activeEndpointsCount} active endpoints)</li>
                <li><strong>Fetch Attempts (24h):</strong> ${crawlStats.fetchAttempts24hCount.toLocaleString()} total (${crawlStats.fetchSucceeded24hCount.toLocaleString()} succeeded, ${crawlStats.fetchFailed24hCount.toLocaleString()} failed · ${crawlSuccessPct}% success rate · avg ${crawlStats.avgFetchDurationMs24h} ms)</li>
                <li><strong>New Stories Ingested (24h):</strong> ${crawlStats.newDocumentsDiscovered24hCount.toLocaleString()} new normalized documents</li>
              </ul>
              ${failedSourcesHtml}
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

export function buildAdminReportText(snapshot: AdminReportSnapshot, baseUrl = "https://news.michaelliang.dev"): string {
  const { subscribers, serverHealth, crawlStats } = snapshot;
  const totalEmailRecipients = subscribers.emailActivePublicCount + subscribers.accountRecipientsCount;
  const crawlSuccessPct =
    crawlStats.fetchAttempts24hCount > 0
      ? Math.round((crawlStats.fetchSucceeded24hCount / crawlStats.fetchAttempts24hCount) * 100)
      : 100;
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");

  const lines = [
    `Daily Admin Operations Report (${snapshot.reportDate})`,
    `Overall Status: ${serverHealth.overallStatus}`,
    `Admin Dashboard: ${cleanBaseUrl}/admin`,
    "",
    "1. AUDIENCE & SUBSCRIBERS (EMAIL + RSS)",
    `- Total Active Email Recipients: ${totalEmailRecipients} (${subscribers.emailActivePublicCount} public subscribers + ${subscribers.accountRecipientsCount} account users)`,
    `- Email Activity (24h): +${subscribers.emailNew24hCount} new subscribers | ${subscribers.emailUnsubscribedPublicCount} unsubscribed | ${subscribers.emailsSent24hCount} emails delivered`,
    `- Active RSS Readers: ${subscribers.rssActive24hCount} unique clients (24h) | ${subscribers.rssActive7dCount} (7d) | ${subscribers.rssTotalClientsCount} all-time (${subscribers.rssTotalRequestsCount} total polls)`,
    "",
    "2. SERVER & PIPELINE HEALTH",
    `- Database: ${serverHealth.dbLatencyMs} ms ping | ${serverHealth.dbSizePretty} | ${serverHealth.totalDocumentsCount} stories (${serverHealth.totalRawDocumentsCount} raw payloads)`,
    `- Host & Worker: Load ${serverHealth.hostLoadAvg1m} (1m) | Host RAM ${serverHealth.hostMemoryUsedMb}/${serverHealth.hostMemoryTotalMb} MB | Worker RSS ${serverHealth.workerMemoryRssMb} MB | Uptime ${serverHealth.hostUptimeHours}h`,
    `- LLM Scoring (24h): ${serverHealth.scoredDocuments24hCount} stories scored (${serverHealth.totalDocumentScoresCount} total scores)`,
    `- Job Queue (24h): ${serverHealth.queueCompleted24hCount} completed | ${serverHealth.queueActiveCount} active | ${serverHealth.queueFailed24hCount} failed`,
    "",
    "3. SOURCE CRAWLING (LAST 24H)",
    `- Sources Crawled: ${crawlStats.distinctSourcesCrawled24hCount} / ${crawlStats.activeSourcesCount} active sources (${crawlStats.distinctEndpointsCrawled24hCount} / ${crawlStats.activeEndpointsCount} endpoints)`,
    `- Fetch Attempts (24h): ${crawlStats.fetchAttempts24hCount} total (${crawlStats.fetchSucceeded24hCount} succeeded, ${crawlStats.fetchFailed24hCount} failed, ${crawlSuccessPct}% success, avg ${crawlStats.avgFetchDurationMs24h} ms)`,
    `- New Stories Ingested (24h): ${crawlStats.newDocumentsDiscovered24hCount}`,
  ];

  if (crawlStats.recentFailedSources.length > 0) {
    lines.push("", "Top Endpoint Failures (Last 24h):");
    for (const item of crawlStats.recentFailedSources) {
      lines.push(
        `- ${item.sourceName} (${item.failureCount}x${item.httpStatus ? `, HTTP ${item.httpStatus}` : ""}): ${(item.errorMessage ?? "Failed").slice(0, 120)}`,
      );
    }
  }

  return lines.join("\n");
}

export async function sendDailyAdminReport({ reportDate }: SendDailyAdminReportPayload) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    throw new Error(`Invalid reportDate format: ${reportDate}`);
  }

  const env = loadWorkerEnv();
  const adminEmails = parseAdminEmails(env.ADMIN_EMAILS);
  if (adminEmails.length === 0) {
    logger.warn({ reportDate }, "Skipped daily admin report because ADMIN_EMAILS has no valid addresses");
    return { sentCount: 0 };
  }

  const snapshot = await collectAdminReportSnapshot(reportDate);
  const totalEmailSubs =
    snapshot.subscribers.emailActivePublicCount + snapshot.subscribers.accountRecipientsCount;
  const subject = `[Admin Report] ${snapshot.serverHealth.overallStatus} · ${totalEmailSubs} Email / ${snapshot.subscribers.rssActive24hCount} RSS · ${snapshot.crawlStats.distinctSourcesCrawled24hCount}/${snapshot.crawlStats.activeSourcesCount} Sources (${reportDate})`;
  const html = buildAdminReportHtml(snapshot, env.APP_BASE_URL);
  const text = buildAdminReportText(snapshot, env.APP_BASE_URL);

  let sentCount = 0;
  for (const email of adminEmails) {
    await sendTransactionalEmail({
      to: { email },
      subject,
      html,
      text,
    });
    sentCount += 1;
  }

  logger.info(
    {
      reportDate,
      sentCount,
      adminEmails,
      overallStatus: snapshot.serverHealth.overallStatus,
      sourcesCrawled24h: snapshot.crawlStats.distinctSourcesCrawled24hCount,
    },
    "Daily admin report job completed",
  );

  return { sentCount, snapshot };
}
