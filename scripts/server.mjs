#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const composeBase = ["compose", "--profile", "tunnel"];
const defaultTail = "120";

function usage() {
  console.log(`Usage:
  pnpm ops start
  pnpm ops stop
  pnpm ops restart
  pnpm ops status
  pnpm ops logs [all|web|worker|cloudflared|postgres] [--tail N] [--follow]
  pnpm ops job-logs [all|crawl|scoring|queue] [--limit N]

Examples:
  pnpm ops start
  pnpm ops logs worker --follow
  pnpm ops job-logs crawl --limit 30
  pnpm ops job-logs scoring`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
    ...options,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exitCode = result.status ?? 0;
  return result;
}

function parseOptions(args) {
  const options = {
    tail: defaultTail,
    follow: false,
    limit: "20",
    positional: [],
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--follow" || arg === "-f") {
      options.follow = true;
    } else if (arg === "--tail") {
      options.tail = args[i + 1] ?? defaultTail;
      i += 1;
    } else if (arg.startsWith("--tail=")) {
      options.tail = arg.slice("--tail=".length) || defaultTail;
    } else if (arg === "--limit") {
      options.limit = args[i + 1] ?? "20";
      i += 1;
    } else if (arg.startsWith("--limit=")) {
      options.limit = arg.slice("--limit=".length) || "20";
    } else {
      options.positional.push(arg);
    }
  }

  if (!/^\d+$/.test(options.tail)) {
    throw new Error("--tail must be a positive integer");
  }

  if (!/^\d+$/.test(options.limit)) {
    throw new Error("--limit must be a positive integer");
  }

  return options;
}

function dockerCompose(args) {
  return run("docker", [...composeBase, ...args]);
}

function logs(args) {
  const options = parseOptions(args);
  const target = options.positional[0] ?? "all";
  const services = target === "all" ? [] : [target];
  const logArgs = ["logs", `--tail=${options.tail}`];

  if (options.follow) {
    logArgs.push("--follow");
  }

  dockerCompose([...logArgs, ...services]);
}

function psql(query) {
  const compactQuery = query.replace(/\s+/g, " ").trim();
  return run("docker", [
    ...composeBase,
    "exec",
    "-T",
    "postgres",
    "sh",
    "-lc",
    `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c ${JSON.stringify(compactQuery)}`,
  ]);
}

function crawlJobLogs(limit) {
  psql(`
    SELECT
      fa.id,
      s.name AS source,
      fa.status,
      fa.http_status,
      fa.duration_ms,
      fa.finished_at,
      left(coalesce(fa.error_message, ''), 180) AS error
    FROM fetch_attempts fa
    JOIN fetch_jobs fj ON fj.id = fa.fetch_job_id
    JOIN source_endpoints se ON se.id = fj.source_endpoint_id
    JOIN sources s ON s.id = se.source_id
    ORDER BY fa.finished_at DESC
    LIMIT ${limit};
  `);
}

function scoringJobLogs(limit) {
  psql(`
    SELECT
      sj.id,
      up.display_name AS profile,
      sj.status,
      sj.total_documents,
      sj.scored_documents,
      sj.failed_documents,
      sj.current_batch || '/' || sj.total_batches AS batch,
      sj.started_at,
      sj.completed_at,
      left(coalesce(sj.error_message, ''), 220) AS error
    FROM scoring_jobs sj
    JOIN user_profiles up ON up.id = sj.profile_id
    ORDER BY sj.started_at DESC
    LIMIT ${limit};
  `);
}

function queueJobLogs(limit) {
  psql(`
    SELECT
      id,
      name,
      state,
      retry_count || '/' || retry_limit AS retries,
      created_on,
      started_on,
      completed_on,
      left(coalesce(output::text, ''), 220) AS output
    FROM pgboss.job
    WHERE name IN ('fetch-source-endpoint', 'score-documents')
    ORDER BY created_on DESC
    LIMIT ${limit};
  `);
}

function jobLogs(args) {
  const options = parseOptions(args);
  const target = options.positional[0] ?? "all";

  if (target === "crawl" || target === "all") {
    console.log("\n== Crawl job attempts ==");
    crawlJobLogs(options.limit);
  }

  if (target === "scoring" || target === "all") {
    console.log("\n== Scoring jobs ==");
    scoringJobLogs(options.limit);
  }

  if (target === "queue" || target === "all") {
    console.log("\n== pg-boss queue jobs ==");
    queueJobLogs(options.limit);
  }

  if (!["crawl", "scoring", "queue", "all"].includes(target)) {
    throw new Error(`Unknown job log target: ${target}`);
  }
}

function main() {
  const [command, ...args] = process.argv.slice(2);

  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      usage();
      return;
    }

    if (command === "start") {
      dockerCompose(["up", "--build", "-d"]);
    } else if (command === "stop") {
      dockerCompose(["stop"]);
    } else if (command === "restart") {
      dockerCompose(["up", "--build", "-d"]);
    } else if (command === "status" || command === "ps") {
      dockerCompose(["ps"]);
    } else if (command === "logs") {
      logs(args);
    } else if (command === "job-logs" || command === "jobs") {
      jobLogs(args);
    } else {
      console.error(`Unknown command: ${command}`);
      usage();
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

main();
