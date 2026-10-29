import { closeSync, mkdirSync, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseGeneratorContext } from "./context.ts";
import { GeneratorError } from "./errors.ts";
import { formatViolations, loadWorktreeConfig } from "./project.ts";
import { approveConfigSet, isConfigSetApproved, latestApprovedSnapshot, writeSnapshot } from "./trust.ts";

// Entry point for `devenv container trust`: reviews a worktree's project config against the repo's last approved
// one and, on confirmation, approves exactly what was shown. Context as JSON on stdin, like cli.ts; the confirmation
// is read from the terminal.

try {
  const context = parseGeneratorContext(await Bun.stdin.text());
  const { source, violations, isMergedChecked, configSet } = await loadWorktreeConfig(context);
  if (configSet === undefined) {
    console.log(`${context.repo}/${context.branch} uses devenv's default config; there's nothing to approve.`);
    process.exit(0);
  }
  if (violations.length > 0) {
    throw new GeneratorError(formatViolations(violations, context, isMergedChecked).join("\n"));
  }
  if (isConfigSetApproved(context.trustDir, context.repo, configSet.hash)) {
    console.log(`This config for ${context.repo} is already approved.`);
    process.exit(0);
  }

  const reviewDir = mkdtempSync(path.join(tmpdir(), "devenv-trust-"));
  try {
    const previous = latestApprovedSnapshot(context.trustDir, context.repo);
    console.log(
      previous === undefined
        ? `${context.repo} has no approved dev container config yet. Its config (${path.relative(context.worktreePath, source.configPath)}) and the files it builds from:`
        : `${context.repo}'s dev container config has changed since it was last approved:`,
    );
    showDiff(reviewDir, previous, configSet);

    if (!confirm(`\nApprove this config for every worktree of ${context.repo}? [y/N] `)) {
      console.log("Not approved.");
      process.exit(1);
    }
    approveConfigSet(context.trustDir, context.repo, configSet);
    console.log("Approved.");
  } finally {
    rmSync(reviewDir, { recursive: true, force: true });
  }
} catch (error) {
  if (!(error instanceof GeneratorError)) {
    throw error;
  }
  console.error(`error: ${error.message}`);
  process.exit(1);
}

/**
 * Shows the change from the last approved snapshot (or from nothing) to the current files with `git diff
 * --no-index`, run from a scratch dir so paths read `approved/...` and `current/...`.
 */
function showDiff(reviewDir: string, previous: string | undefined, configSet: Parameters<typeof writeSnapshot>[1]): void {
  writeSnapshot(path.join(reviewDir, "current"), configSet);
  const approvedDir = path.join(reviewDir, "approved");
  if (previous === undefined) {
    mkdirSync(approvedDir);
  } else {
    Bun.spawnSync(["cp", "-r", previous, approvedDir]);
  }
  // Exit status 1 just means "there are differences". autocrlf off: a global core.autocrlf=true would otherwise warn
  // about every file.
  Bun.spawnSync(["git", "-c", "core.autocrlf=false", "--no-pager", "diff", "--no-index", "--color=auto", "approved", "current"], {
    cwd: reviewDir,
    stdout: "inherit",
    stderr: "inherit",
  });
}

/** Asks a yes/no question on the terminal itself, since stdin carries the context. */
function confirm(question: string): boolean {
  process.stdout.write(question);
  const tty = openSync("/dev/tty", "r");
  try {
    const buffer = Buffer.alloc(256);
    const length = readSync(tty, buffer, 0, buffer.length, null);
    return /^y(es)?$/i.test(buffer.toString("utf8", 0, length).trim());
  } finally {
    closeSync(tty);
  }
}
