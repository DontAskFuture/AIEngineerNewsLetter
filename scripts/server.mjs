#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

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
  pnpm ops deploy [--host user@host] [--path /remote/repo] [--branch main]
  pnpm ops db-dump [--file local/path.dump]
  pnpm ops db-restore --host user@host [--path /remote/repo] --file local/path.dump

Examples:
  pnpm ops start
  pnpm ops logs worker --follow
  pnpm ops job-logs crawl --limit 30
  pnpm ops job-logs scoring
  DEPLOY_SSH_HOST=ubuntu@1.2.3.4 pnpm ops deploy
  pnpm ops deploy --host ubuntu@1.2.3.4 --path /home/ubuntu/AIEngineerNewsLetter
  pnpm ops db-dump
  pnpm ops db-restore --host ubuntu@1.2.3.4 --file var/backups/ai_intel-2026-07-26T12-00-00.dump

Deploy/restore env vars (used when the matching flag is omitted):
  DEPLOY_SSH_HOST  user@host for the target VM
  DEPLOY_SSH_PATH  path to the repo clone on the VM (default: ~/AIEngineerNewsLetter)

db-dump/db-restore is a one-time step for carrying an existing local database
to a fresh VM on first setup. db-restore OVERWRITES the target database.`);
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

function runChecked(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
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
    WHERE name IN ('fetch-source-endpoint', 'score-documents', 'send-daily-newsletter')
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

function parseDeployOptions(args) {
  const options = {
    host: process.env.DEPLOY_SSH_HOST ?? null,
    path: process.env.DEPLOY_SSH_PATH ?? "~/AIEngineerNewsLetter",
    branch: "main",
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--host" || arg === "-H") {
      options.host = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
    } else if (arg === "--path" || arg === "-p") {
      options.path = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--path=")) {
      options.path = arg.slice("--path=".length);
    } else if (arg === "--branch" || arg === "-b") {
      options.branch = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--branch=")) {
      options.branch = arg.slice("--branch=".length);
    } else {
      throw new Error(`Unknown deploy option: ${arg}`);
    }
  }

  if (!options.host) {
    throw new Error(
      "Missing deploy target. Set DEPLOY_SSH_HOST=user@host or pass --host user@host",
    );
  }

  return options;
}

function deploy(args) {
  const options = parseDeployOptions(args);

  const remoteCommand = [
    `cd ${options.path}`,
    `git fetch origin ${options.branch}`,
    `git checkout ${options.branch}`,
    `git merge --ff-only origin/${options.branch}`,
    "docker compose --profile tunnel up --build -d",
    "docker compose --profile tunnel ps",
  ].join(" && ");

  console.log(`Deploying ${options.branch} to ${options.host}:${options.path}\n`);
  run("ssh", [options.host, remoteCommand]);
}

function defaultDumpPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `var/backups/ai_intel-${stamp}.dump`;
}

function parseFileFlag(args, defaultValue) {
  const options = { file: defaultValue };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--file" || arg === "-f") {
      options.file = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--file=")) {
      options.file = arg.slice("--file=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function dbDump(args) {
  const { file } = parseFileFlag(args, defaultDumpPath());
  const filePath = resolve(file);
  mkdirSync(dirname(filePath), { recursive: true });

  console.log(`Dumping local database to ${filePath}`);
  const fd = openSync(filePath, "w");

  try {
    const result = spawnSync(
      "docker",
      [
        ...composeBase,
        "exec",
        "-T",
        "postgres",
        "sh",
        "-lc",
        'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc',
      ],
      { stdio: ["ignore", fd, "inherit"], cwd: process.cwd(), env: process.env },
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`pg_dump exited with status ${result.status}`);
    }
  } finally {
    closeSync(fd);
  }

  console.log(`Dump written to ${filePath}`);
  console.log(
    `Restore it on a fresh VM with: pnpm ops db-restore --host user@vm-ip --file ${filePath}`,
  );
}

function parseDbRestoreOptions(args) {
  const options = {
    host: process.env.DEPLOY_SSH_HOST ?? null,
    path: process.env.DEPLOY_SSH_PATH ?? "~/AIEngineerNewsLetter",
    file: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--host" || arg === "-H") {
      options.host = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
    } else if (arg === "--path" || arg === "-p") {
      options.path = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--path=")) {
      options.path = arg.slice("--path=".length);
    } else if (arg === "--file" || arg === "-f") {
      options.file = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--file=")) {
      options.file = arg.slice("--file=".length);
    } else {
      throw new Error(`Unknown db-restore option: ${arg}`);
    }
  }

  if (!options.host) {
    throw new Error(
      "Missing deploy target. Set DEPLOY_SSH_HOST=user@host or pass --host user@host",
    );
  }

  if (!options.file) {
    throw new Error("Missing dump file. Pass --file /path/to/dump (from pnpm ops db-dump)");
  }

  return options;
}

function dbRestore(args) {
  const options = parseDbRestoreOptions(args);
  const localFile = resolve(options.file);
  const remoteFile = `${options.path}/var/backups/${basename(localFile)}`;
  const remoteDir = dirname(remoteFile);

  console.log(`Copying ${localFile} to ${options.host}:${remoteFile}`);
  runChecked("ssh", [options.host, `mkdir -p "${remoteDir}"`]);
  runChecked("scp", [localFile, `${options.host}:${remoteFile}`]);

  console.log(
    `\nRestoring into ${options.host}'s postgres container. This starts postgres if it is not already running and OVERWRITES any existing data in that database.\n`,
  );

  const remoteCommand = [
    `cd ${options.path}`,
    "docker compose --profile tunnel up -d --wait postgres",
    `docker compose --profile tunnel cp "${remoteFile}" postgres:/tmp/restore.dump`,
    `docker compose --profile tunnel exec -T postgres sh -lc 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/restore.dump'`,
    "docker compose --profile tunnel exec -T postgres rm -f /tmp/restore.dump",
  ].join(" && ");

  run("ssh", [options.host, remoteCommand]);

  console.log(
    "\nRestore complete. Now bring up the rest of the stack so migrate/web/worker start:\n" +
      `  pnpm ops deploy --host ${options.host} --path ${options.path}`,
  );
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
    } else if (command === "deploy") {
      deploy(args);
    } else if (command === "db-dump") {
      dbDump(args);
    } else if (command === "db-restore") {
      dbRestore(args);
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
