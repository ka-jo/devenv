---
rfc: 0005
title: Config approval
status: Draft
see_also:
  - ADR-0001
  - ADR-0005
  - RFC-0001
  - RFC-0002
  - RFC-0003
  - RFC-0004
  - RFC-0007
---

# RFC 0005: Config approval

## 1. Summary

This RFC specifies how a person approves a dev container config before devenv builds from it: which files an approval covers, how their content is identified, how a config is named so its next change can be shown against its last approved version, where approvals are kept, and `devenv container trust`, the command that shows a config for review and approves it on confirmation.

## 2. Motivation

devenv doesn't build or create a sandbox from a dev container config until a person has approved its exact content, and any change needs approving again ([ADR-0005](../adrs/0005-approve-every-dev-container-configs-exact-content-before-building-from-it.md)). Building runs the config's own code, its Dockerfile steps and the install scripts of its Features, before any sandbox exists, so this is the one point where a person looks at that code first. Approval doesn't replace config validation (RFC-0004): a config with a sandbox escape stays blocked whether or not it's approved, while exposing host files is the reviewer's call.

`devenv container up` refuses to create a sandbox from a config whose content isn't approved (RFC-0007 §4.3.6), in terms of the condition §3.1 defines.

Prior to this RFC, when `devenv container trust` was ran without a terminal stopped with an unhandled error, after resolving and validating the config, instead of failing with a message (§4.6.7).

## 3. Interface

### 3.1. Approval terms

- **The folder holding the config**: the folder the config's `devcontainer.json` or `.devcontainer.json` is in. For `<project>/.devcontainer/devcontainer.json`, that's `<project>/.devcontainer`, inside the config's folder (RFC-0003 §3.2).
- **The approval set**: every file an approval of the config covers (§4.2), each under its key (§4.3).
- **The content hash**: the hash that identifies exactly the approval set's keys and contents (§4.4).
- **The config's name**: what the config's last approved version is found by (§4.5).

Other RFCs use one condition this RFC defines:

- **The config's content is approved**: the approval store holds the folder `trust/<content hash>/` for the content hash of its approval set (§4.1.1).

### 3.2. The approval store

```text
~/.local/state/devenv/trust/
  <content hash>/          a copy of each file of the approval set with this content hash, at its key
  names/<sha256 of name>   the name's last approved content hash, as an ApprovedName
```

```typescript
interface ApprovedName {
  /** The config's name (§4.5). */
  readonly name: string;
  /** The content hash of the name's last approved approval set. */
  readonly hash: string;
}
```

### 3.3. `devenv container trust`

```text
devenv container trust [<repo> <branch>] [--config <path>]
```

- `<repo> <branch>`: the worktree (RFC-0002 §3.1). Given together or not at all.
- `--config <path>`, `--config=<path>`: a `devcontainer.json`, or a folder holding one (RFC-0003 §3.1).

Outputs: on stdout, the review (§4.6.5) and its outcome, `Approved.`, `Not approved.` or `This version of <name> is already approved.`; the escape report (RFC-0004 §3.2) or host exposure warnings and other diagnostics on stderr; writes the approval store (§3.2).

## 4. Behavior

### 4.1. Invariants

These requirements apply wherever devenv decides whether a config's content is approved, whichever command decides it.

#### 4.1.1. Approved by content

WHILE the approval store holds the folder `trust/<content hash>/` for a config's content hash (§3.2), devenv SHALL treat the config's content as approved, whatever the config's name, path or worktree.

> [!NOTE]
> Any worktree whose config has exactly the same files shares one approval, so approving a config once covers every branch that carries it unchanged.

#### 4.1.2. A host-only store

devenv SHALL keep the approval store at `~/.local/state/devenv/trust/` AND SHALL NOT mount it into any sandbox.

> [!NOTE]
> An agent that could write the store could approve its own config. The store lies inside the state directory no sandbox mounts (RFC-0007 §4.1.1).

### 4.2. What an approval covers

The approval set holds every file the config's build uses that devenv can identify.

#### 4.2.1. The config's own folder

WHILE the config isn't a `.devcontainer.json` and the folder holding it doesn't contain the home directory, the approval set SHALL include every file under the folder holding the config, at any depth.

WHILE the config is a `.devcontainer.json`, or the folder holding it contains the home directory, the approval set SHALL include the config itself AND SHALL NOT include the other files of the folder holding it.

> [!NOTE]
> A config's Dockerfiles and Features can use any file beside it, so the whole folder is covered. A `.devcontainer.json` sits directly in a project's root, and a folder holding the home directory is far more than a config, so covering every file there would mean approving the whole project or the whole home directory.

#### 4.2.2. Local Features

The approval set SHALL include every file under each of the config's local Features (a `./<path>` key in `features`), at any depth.

#### 4.2.3. Compose files

The approval set SHALL include each of the config's Compose files.

#### 4.2.4. Dockerfiles

The approval set SHALL include each Dockerfile a service in the config's Compose model builds from: the service's `build.dockerfile`, or `Dockerfile` when it sets none, resolved against its `build.context`.

#### 4.2.5. Missing files

WHILE a file §4.2.1 through §4.2.4 name doesn't exist, the approval set SHALL leave it out.

### 4.3. Keys

A key is the path an approval set's file is recorded under. The content hash covers each file's key as well as its content (§4.4), the approval store holds a copy of each file at its key (§3.2), and the review shows each file under its key (§4.6.5).

#### 4.3.1. Inside the config's folder

The approval set SHALL key each file inside the config's folder (RFC-0003 §3.2) by its path relative to that folder.

#### 4.3.2. Outside the config's folder

The approval set SHALL key each file outside the config's folder as `(outside)/<absolute path>`.

> [!NOTE]
> Keys relative to the config's folder make the same config hash the same wherever it is, so identical configs in different worktrees share one approval (§4.1.1).

### 4.4. The content hash

The content hash SHALL be the SHA-256, in lowercase hexadecimal, of the approval set's serialization.

The serialization SHALL be, for every file of the approval set in ascending order of the bytes of its key's UTF-8 encoding, the key's UTF-8 bytes, a zero byte, the file's content bytes and a zero byte.

> [!NOTE]
> Keys are part of what's hashed, so renaming or moving a file changes the hash as well as editing it. The zero bytes keep one file's key and content from being mistaken for another's: without them, a file `a` holding `bc` and a file `ab` holding `c` would serialize identically. Changing how the hash is computed would make every existing approval unrecognized.

### 4.5. A config's name

A config's name finds its last approved version, so a change can be shown against it (§4.6.5). Names don't affect whether content is approved (§4.1.1).

#### 4.5.1. A config inside a worktree

WHILE the config is inside a worktree (RFC-0002 §3.1), the config's name SHALL be `<repo>:<path>`, where `<repo>` is the worktree's repository and `<path>` is the config's path relative to the worktree.

> [!NOTE]
> Every branch of a repository then shares a name, so a branch's changed config is shown against whatever version of it was last approved on any branch. devenv finds the worktree by the nearest folder above the config, inside `worktrees/`, that holds a `.git` file; a branch's name can contain `/`, so its path alone can't say where the worktree starts.

#### 4.5.2. Any other config

WHILE the config isn't inside a worktree, the config's name SHALL be its absolute path.

#### 4.5.3. The name's last approved version

The name's last approved version SHALL be the files in the folder `trust/<content hash>/` (§3.2), where the content hash is the one held by the `names/` entry for the name, which is the file named by the SHA-256 of the name in lowercase hexadecimal.

WHILE the name has no `names/` entry, or its entry doesn't hold a content hash, or the approval store holds no folder `trust/<content hash>/` for that hash, the name SHALL have no last approved version.

### 4.6. `devenv container trust`

#### 4.6.1. What it reviews

`devenv container trust` SHALL resolve its worktree as RFC-0002 §4.4 specifies, AND SHALL resolve that worktree's config as RFC-0003 specifies, AND SHALL run config validation (RFC-0004) on that config before showing anything.

#### 4.6.2. Sandbox escapes

WHILE the config contains a sandbox escape (RFC-0004 §3.1), `devenv container trust` SHALL fail (RFC-0001 §4.3), with the escape report (RFC-0004 §3.2) as its `error:` message, before showing the config or asking anything, AND SHALL NOT approve anything.

#### 4.6.3. Host exposure

WHILE the config exposes host files (RFC-0004 §3.1), `devenv container trust` SHALL print a host exposure warning (RFC-0004 §3.2) for each host exposure, before showing the config.

#### 4.6.4. Already approved

WHILE the config contains no sandbox escape and its content is approved, `devenv container trust` SHALL print `This version of <name> is already approved.` AND SHALL exit with status `0` without showing the config or asking anything.

#### 4.6.5. Showing the config

WHILE the config contains no sandbox escape, its content isn't approved and its name has a last approved version, `devenv container trust` SHALL print `<name> has changed since it was last approved:` AND SHALL then show the difference from that version to the approval set.

WHILE the config contains no sandbox escape, its content isn't approved and its name has no last approved version, `devenv container trust` SHALL print `<name> has no approved version yet. Its files:` AND SHALL then show every file of the approval set, as a difference from nothing.

`devenv container trust` MUST show the difference as `git diff --no-index` does, with each file's path as `approved/<key>` on the old side and `current/<key>` on the new.

#### 4.6.6. Paging the review

`devenv container trust` SHALL page the review of §4.6.5, its heading line and the difference, as RFC-0001 §4.12 specifies.

#### 4.6.7. No terminal

WHILE the config contains no sandbox escape, its content isn't approved, and there's no terminal to ask on (RFC-0001 §4.11), `devenv container trust` SHALL fail (RFC-0001 §4.3) before showing the config. Its error message MUST say that approving a config needs a terminal.

#### 4.6.8. Asking

WHILE the config contains no sandbox escape and its content isn't approved, `devenv container trust` SHALL ask `Approve this version of <name>, for every worktree that uses exactly these files? [y/N]` after showing the config, and after its pager closes when it paged the review, AND SHALL write the question and read its answer as RFC-0001 §4.11 specifies.

#### 4.6.9. Approving

WHEN the answer is `y` or `yes`, in any letter case, `devenv container trust` SHALL copy each file of the approval set it showed to `trust/<content hash>/<key>`, AND SHALL record that hash as the name's last approved version, AND SHALL print `Approved.`.

`devenv container trust` MUST write each copy from the contents it read before showing them, never by reading the files again.

> [!NOTE]
> So what's approved is exactly what was shown, even if a file changes between being shown and the answer.

`devenv container trust` MUST make the folder `trust/<content hash>/` appear only once every file of the approval set is copied into it, AND MUST record the name's last approved version only after that.

> [!NOTE]
> So an interrupted approval leaves nothing, instead of a folder holding some of the files, which §4.1.1 would treat as the content being approved.

#### 4.6.10. Declining

WHEN the answer is anything else, `devenv container trust` SHALL NOT approve anything, AND SHALL print `Not approved.`, AND SHALL exit with the status for a cancelled command (RFC-0001 §3.3).

#### 4.6.11. Its picker

WHEN `<repo>` and `<branch>` are omitted, `devenv container trust` SHALL offer every worktree of every repository in its picker (RFC-0002 §4.4.3).

## 5. Examples

### 5.1. A first approval

Setup: `worktrees/app/main` has `.devcontainer/devcontainer.json` and `.devcontainer/docker-compose.yml`, never approved.

Call: `devenv container trust app main`, answering `y`.

Result: stdout shows `app:.devcontainer/devcontainer.json has no approved version yet. Its files:`, then both files as new files under `current/`, then the question, then `Approved.`. The store gains `trust/<content hash>/.devcontainer/devcontainer.json` and `…/docker-compose.yml`, and a `names/` entry recording that hash for `app:.devcontainer/devcontainer.json`.

### 5.2. Another branch with the same config

Setup: §5.1 is done, and `worktrees/app/feature-x` carries exactly the same `.devcontainer/` files.

Call: `devenv container trust app feature-x`

Result: `This version of app:.devcontainer/devcontainer.json is already approved.`, exit status `0`, and no question. `devenv container up app feature-x` can create its sandbox.

### 5.3. A changed config

Setup: on `feature-x`, an agent adds a `RUN` step to `.devcontainer/Dockerfile`.

Call: `devenv container trust app feature-x`

Result: `app:.devcontainer/devcontainer.json has changed since it was last approved:`, then the diff from `approved/.devcontainer/Dockerfile` to `current/.devcontainer/Dockerfile` showing the new `RUN` step, then the question.

## 6. Out of scope

- Whether a sandbox may be built from an unapproved config, and what `up` does about one. Specified in RFC-0007 (§4.3.6, §4.3.7).
- Resolving the worktree and the config, and validating the config. Specified in RFC-0002, RFC-0003 and RFC-0004.
- Files a build uses that devenv can't identify: a build context outside the config's folder, and images pulled by a tag that can later move ([ADR-0005](../adrs/0005-approve-every-dev-container-configs-exact-content-before-building-from-it.md)).
- Approving separately from reviewing [future], such as a review that prints the content hash and a `devenv container trust --approve <hash>` that approves only while the config's content hash still matches, as `terraform plan -out` and `terraform apply` split a plan from applying it. §4.6.9's rule that only what was shown is approved is what that would preserve.
- Revoking or listing approvals [future]. Approvals are directories in the store (§3.2), so a revoke would remove one and its `names/` entries.
- Cleaning up approvals no config uses any longer [future]. Nothing removes an approval on its own, so the files of a config's earlier version stay in the store (§3.2) and keep that exact content approved.
- Moving a name's last approved version when its config returns to an approved version [future]. §4.6.4 writes nothing, so after a name's config goes back to a version approved earlier, its last approved version is still the one approved after that, and its next change is shown against that one instead.

