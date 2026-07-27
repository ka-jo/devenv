import os from "node:os";
import path from "node:path";

/** Absolute path to the devenv repo root — the repo is required to live at `~/devenv` (see CLAUDE.md's hard invariants). */
export const REPO_DIR = path.join(os.homedir(), "devenv");
