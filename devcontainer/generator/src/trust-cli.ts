import { closeSync, mkdirSync, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseGeneratorContext } from "./context.ts";
import { GeneratorError } from "./errors.ts";
import { formatViolations, formatWarnings, loadWorktreeConfig } from "./project.ts";
import { approveConfigSet, type ConfigSet, isConfigSetApproved, lastApprovedSnapshot, writeSnapshot } from "./trust.ts";

// Entry point for `devenv container trust`: reviews a worktree's config against that config's last approved version
// and, on confirmation, approves exactly what was shown. Context as JSON on stdin, like cli.ts; the confirmation is
// read from the terminal.

const scratchDir = mkdtempSync(path.join(tmpdir(), "devenv-trust-"));
try {
  process.exitCode = await reviewConfig(scratchDir);
} catch (error) {
  if (!(error instanceof GeneratorError)) {
    throw error;
  }
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}

/** Reviews the config and approves it on confirmation, returning the exit status: 0 once it's approved. */
async function reviewConfig(scratchDir: string): Promise<number> {
  const context = parseGeneratorContext(await Bun.stdin.text());
  const { name, violations, warnings, isMergedChecked, configSet } = await loadWorktreeConfig(
    context,
    path.join(scratchDir, "stage"),
  );
  if (violations.length > 0) {
    throw new GeneratorError(formatViolations(violations, isMergedChecked).join("\n"));
  }
  for (const line of formatWarnings(warnings)) {
    console.log(`warning: ${line}`);
  }
  if (isConfigSetApproved(context.trustDir, configSet.hash)) {
    console.log(`This version of ${name} is already approved.`);
    return 0;
  }

  const previous = lastApprovedSnapshot(context.trustDir, name);
  console.log(
    previous === undefined ? `${name} has no approved version yet. Its files:` : `${name} has changed since it was last approved:`,
  );
  showDiff(path.join(scratchDir, "review"), previous, configSet);

  if (!confirm(`\nApprove this version of ${name}, for every worktree that uses exactly these files? [y/N] `)) {
    console.log("Not approved.");
    return 1;
  }
  approveConfigSet(context.trustDir, name, configSet);
  console.log("Approved.");
  return 0;
}

/**
 * Shows the change from the last approved snapshot (or from nothing) to the current files with `git diff
 * --no-index`, run from a scratch dir so paths read `approved/...` and `current/...`.
 */
function showDiff(reviewDir: string, previous: string | undefined, configSet: ConfigSet): void {
  mkdirSync(reviewDir);
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
