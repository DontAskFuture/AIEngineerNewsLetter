#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function runGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function parseArgs(argv) {
  let mode = "working-tree";
  let baseRef = process.env.AGENTS_BASE_REF || process.env.GITHUB_BASE_SHA || null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--staged") {
      mode = "staged";
      continue;
    }

    if (value === "--base" && argv[index + 1]) {
      baseRef = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (value?.startsWith("--base=")) {
      baseRef = value.slice("--base=".length);
    }
  }

  return {
    mode,
    baseRef,
  };
}

function getChangedFiles({ mode, baseRef }) {
  if (baseRef) {
    const output = runGit(["diff", "--name-only", "--diff-filter=ACMR", `${baseRef}...HEAD`]);
    return output ? output.split("\n").filter(Boolean) : [];
  }

  if (mode === "staged") {
    const output = runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
    return output ? output.split("\n").filter(Boolean) : [];
  }

  const trackedOutput = runGit(["diff", "--name-only", "--diff-filter=ACMR"]);
  const untrackedOutput = runGit(["ls-files", "--others", "--exclude-standard"]);
  const trackedFiles = trackedOutput ? trackedOutput.split("\n").filter(Boolean) : [];
  const untrackedFiles = untrackedOutput ? untrackedOutput.split("\n").filter(Boolean) : [];

  return Array.from(new Set([...trackedFiles, ...untrackedFiles]));
}

function isDocumentationFile(relativePath) {
  return relativePath.endsWith(".md");
}

function isPolicyFile(relativePath) {
  return path.basename(relativePath) === "AGENTS.md";
}

function isCodeOrConfigChange(relativePath) {
  if (isDocumentationFile(relativePath)) {
    return false;
  }

  if (path.basename(relativePath) === "CLAUDE.md") {
    return false;
  }

  return true;
}

function findNearestAgentsFile(relativePath) {
  let currentDir = path.dirname(relativePath);

  while (true) {
    const candidate = currentDir === "." ? "AGENTS.md" : path.posix.join(currentDir, "AGENTS.md");

    if (existsSync(path.join(repoRoot, candidate))) {
      return candidate;
    }

    if (currentDir === ".") {
      return null;
    }

    const parentDir = path.posix.dirname(currentDir);
    currentDir = parentDir === currentDir ? "." : parentDir;
  }
}

function formatList(values) {
  return values.map((value) => `- ${value}`).join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = getChangedFiles(args);

  if (changedFiles.length === 0) {
    console.log("AGENTS policy: no changed files to inspect.");
    return;
  }

  const changedAgentsFiles = new Set(changedFiles.filter(isPolicyFile));
  const relevantFiles = changedFiles.filter(isCodeOrConfigChange);

  if (relevantFiles.length === 0) {
    console.log("AGENTS policy: no code or config changes detected.");
    return;
  }

  const violations = relevantFiles
    .map((relativePath) => {
      const requiredAgentsFile = findNearestAgentsFile(relativePath);

      if (!requiredAgentsFile) {
        return {
          relativePath,
          requiredAgentsFile: "AGENTS.md",
          reason: "No scoped AGENTS.md file exists for this path.",
        };
      }

      if (!changedAgentsFiles.has(requiredAgentsFile)) {
        return {
          relativePath,
          requiredAgentsFile,
          reason: "The nearest scoped AGENTS.md was not updated in this change.",
        };
      }

      return null;
    })
    .filter((value) => value !== null);

  if (violations.length === 0) {
    console.log("AGENTS policy: every code or config change updated its nearest AGENTS.md.");
    return;
  }

  const lines = violations.map(
    (violation) =>
      `${violation.relativePath}\n  required: ${violation.requiredAgentsFile}\n  reason: ${violation.reason}`,
  );

  console.error(
    [
      "AGENTS policy check failed.",
      "Each code or config change must update the nearest scoped AGENTS.md in the same directory tree.",
      "",
      formatList(lines),
      "",
      "Tip: touch the matching AGENTS.md and describe the architecture or implementation implication of your code change.",
    ].join("\n"),
  );

  process.exit(1);
}

main();
