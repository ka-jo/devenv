---
rfc: 0001
title: CLI conventions
status: Draft
see_also:
  - RFC-0002
  - RFC-0004
  - RFC-0007
  - https://no-color.org
  - https://force-color.org
---

# RFC 0001: CLI conventions

## 1. Summary

This RFC specifies the conventions every devenv command follows in dealing with whoever runs it: which stream its output goes to, the messages it prints and their prefixes, its exit statuses, when and how its messages are colored, and where it reads interactive answers from. Each command's own RFC specifies only what's particular to it: its results, and when it fails or warns.

This RFC holds conventions of that kind, the ones any well-behaved command line follows, and grows as more are adopted. Behavior particular to devenv that many commands share, such as resolving a worktree (RFC-0002) or a config (RFC-0003), has RFCs of its own.

## 2. Motivation

Every devenv command reports failures, usage mistakes and advisory messages, and a person reading them, or a script running them, should be able to rely on one convention for all of them, whichever command printed them. Writing that convention once means each command's RFC can say "SHALL fail" or "SHALL print a `warning:` line" and mean exactly the same thing.

Prior to this RFC, devenv's commands differed from what is specified here:

- Several commands printed their errors and usage lines on stdout (§4.2).
- A command run with the wrong arguments exited with status `1`, the same as a failure (§4.4).
- `error:` lines weren't colored; only `note:` and `warning:` lines were (§4.8).
- `devenv container trust` printed its `warning:` lines on stdout, uncolored (§4.2, §4.8).
- Nothing turned color on when stderr wasn't a terminal (§4.7).

## 3. Interface

### 3.1. Streams

- **stdout**: a command's results, the output a script would capture or pipe, such as `devenv worktree list`'s lines or `valid: <config>`.
- **stderr**: diagnostics: the messages of §3.2, and output passed through from other tools such as git or the devcontainer CLI.

### 3.2. Messages

```text
error: <message>
warning: <message>
note: <message>
usage: devenv <command> <synopsis>
```

- `error:` reports why a command failed.
- `warning:` reports something the person should act on or know about, without stopping the command.
- `note:` reports something devenv did on the person's behalf, such as a change it made to a config.
- `usage:` gives a command's synopsis, in the form its RFC's §3 gives it.

A message may run over several lines. Its first line carries the prefix; the lines after it are continuation lines, indented with two spaces and without a prefix.

### 3.3. Exit statuses

| Status | Meaning |
|---|---|
| `0` | The command completed. |
| `1` | The command failed, or the person cancelled an interactive picker or prompt. |
| `2` | The command was run with arguments it doesn't accept, or without ones it requires. |

### 3.4. Colors

| Message | Color | SGR sequence |
|---|---|---|
| `error:` | red | `ESC[31m` |
| `warning:` | bold yellow | `ESC[1;33m` |
| `note:` | cyan | `ESC[36m` |
| `usage:` | none | |

Each colored message ends with `ESC[0m`.

### 3.5. Environment

- `NO_COLOR`: when set to a non-empty value, no message is colored ([no-color.org](https://no-color.org)).
- `FORCE_COLOR`: when set to a non-empty value, messages are colored even when stderr isn't a terminal ([force-color.org](https://force-color.org)). `NO_COLOR` wins when both are set.
- `PAGER`: the program that shows paged output (§4.12), when set to a non-empty value. `PAGER=cat` effectively turns paging off.

## 4. Behavior

These requirements apply to every devenv command, whichever RFC specifies it.

### 4.1. Results

devenv SHALL print a command's results on stdout AND SHALL NOT print anything else there.

### 4.2. Messages

devenv SHALL print every message of §3.2 on stderr.

### 4.3. Failure

Wherever an RFC says a command SHALL fail, the command SHALL print one `error:` message saying why, AND SHALL exit with status `1`.

### 4.4. Usage errors

IF a command is run with arguments it doesn't accept, or without arguments it requires, THEN the command SHALL print its `usage:` line, AND SHALL exit with status `2`, AND SHALL change nothing.

### 4.5. Completion

WHILE a command neither fails, nor is run with the wrong arguments, nor is cancelled, the command SHALL exit with status `0`.

### 4.6. Advisory messages

devenv SHALL NOT change a command's exit status because it printed a `warning:` or `note:` message.

### 4.7. When messages are colored

WHILE `NO_COLOR` is set to a non-empty value, devenv SHALL NOT write any color or other escape sequence to stderr.

WHILE `NO_COLOR` is unset or empty and stderr is a terminal, devenv SHALL color every `error:`, `warning:` and `note:` message.

WHILE `NO_COLOR` is unset or empty and `FORCE_COLOR` is set to a non-empty value, devenv SHALL color every `error:`, `warning:` and `note:` message, whether or not stderr is a terminal.

WHILE `NO_COLOR` and `FORCE_COLOR` are both unset or empty and stderr isn't a terminal, devenv SHALL NOT write any color or other escape sequence to stderr.

> [!NOTE]
> `NO_COLOR` is a preference the person set, so nothing overrides it, `FORCE_COLOR` included. `FORCE_COLOR` exists for logs that render color but aren't a terminal, such as CI's.

### 4.8. Colors

WHILE devenv colors messages, it SHALL color each message with its color from §3.4, across the whole message, continuation lines included, AND SHALL end the message with `ESC[0m`.

### 4.9. Color on stdout

WHILE `NO_COLOR` is set to a non-empty value, devenv SHALL NOT write any color or other escape sequence to stdout.

WHILE `NO_COLOR` and `FORCE_COLOR` are both unset or empty and stdout isn't a terminal, devenv SHALL NOT write any color or other escape sequence to stdout.

These apply to output passed through from other tools as well as devenv's own. A tool that doesn't read `NO_COLOR` or `FORCE_COLOR` itself MUST be told, such as `git diff` with `--color=never` while `NO_COLOR` is set and `--color=always` while `FORCE_COLOR` is.

> [!NOTE]
> Otherwise stdout MAY be colored, for output a person reads such as a diff. Results meant for scripts, such as `devenv worktree list`'s lines, are plain whatever stdout is, since §4.7 and §4.8 color only messages.

### 4.10. Uncolored usage

devenv SHALL NOT color `usage:` lines.

### 4.11. Interactive questions

devenv SHALL write every interactive question, such as a confirmation, to the terminal, AND SHALL read every interactive answer, such as a picker's choice or a confirmation, from the terminal, never from stdin.

> [!NOTE]
> Some commands use stdin for other input; `devenv container trust` hands its context to the generator on stdin, for one. Asking on the terminal keeps the two apart, keeps a question out of output that's captured or piped, and keeps a piped command from answering its own prompts.

### 4.12. Paging

WHERE a devenv command pages its output, WHILE stdout isn't a terminal, the command SHALL NOT page its output.

WHERE a devenv command pages its output, WHILE stdout is a terminal and `PAGER` is set to a non-empty value, the command SHALL page its output with the program `PAGER` names.

WHERE a devenv command pages its output, WHILE stdout is a terminal and `PAGER` is unset or empty, the command SHALL page its output with `less -FR`.

> [!NOTE]
> Whether a devenv command pages its output is the command's to decide, and a command that does must say so in its own RFC.

> [!NOTE]
> `-F` makes `less` quit at once when the output fits on one screen, and `-R` passes color through (§4.9). Without `-X`, `less` uses the terminal's alternate screen, so paged output doesn't stay in the terminal's scrollback after the pager is closed.

## 5. Examples

### 5.1. A usage error on a terminal

Setup: stderr is a terminal and `NO_COLOR` is unset.

Call: `devenv worktree add app`

Result: exit status `2`, and on stderr, all in the terminal's default color:

```text
usage: devenv worktree add <repo> <branch> [<base>]
```

### 5.2. Color turned off

Setup: stderr is a terminal and `NO_COLOR=1`.

Call: a command that fails.

Result: exit status `1`, and its `error:` message on stderr with no escape sequences.

### 5.3. Color in a CI log

Setup: stderr is a CI job's log, not a terminal, and the job sets `FORCE_COLOR=1`.

Call: `devenv container validate app main` on a config whose primary service is privileged.

Result: exit status `1`, and its `error:` message on stderr in red, which the CI log renders. With `NO_COLOR=1` set as well, the same message has no escape sequences.

## 6. Out of scope

- Each command's results and messages: what it prints, and when it fails or warns. Specified in that command's RFC.
- Machine-readable output, such as `--json` [future]. §4.1 keeps stdout free of anything but results, which a structured format would build on.
- Translated messages.
- `--help` for every command [future]. No command has it yet; when they do, it's specified here. Usage a person asks for is a command's output, not a diagnostic, so it would go to stdout with exit status `0`, unlike the `usage:` line of §4.4, which reports a mistake.
