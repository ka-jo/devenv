# EARS guide

How to write the requirements in an RFC's Behavior section (§4). Part 1 condenses EARS as its authors define it. Part 2 is how RFCs in this format apply it: where EARS leaves a choice open, Part 2 makes it, and an RFC follows Part 2.

## Part 1: EARS

EARS (Easy Approach to Requirements Syntax) was developed by Alistair Mavin and colleagues at Rolls-Royce while analysing the airworthiness regulations for a jet engine's control system, and first published in 2009 (A. Mavin, P. Wilkinson, A. Harwood and M. Novak, "Easy Approach to Requirements Syntax (EARS)", 17th IEEE International Requirements Engineering Conference, 2009). Its reference is <https://alistairmavin.com/ears/>.

Natural-language requirements are imprecise, and the problems that causes spread into everything built from them. EARS constrains requirements to a small set of patterns, with keywords that read as ordinary English, so they come out consistent and unambiguous without special training or tools.

### Generic syntax

> While \<optional pre-condition\>, when \<optional trigger\>, the \<system name\> shall \<system response\>

The clauses always appear in that order, which follows the order in which things happen. Every requirement has:

- **zero or many preconditions**;
- **zero or one trigger**;
- **one system name**;
- **one or many system responses**.

### The patterns

| Pattern | Keyword | Template | Use for |
|---|---|---|---|
| Ubiquitous | none | The \<system name\> shall \<system response\> | Behavior that is always active. |
| State-driven | While | While \<precondition(s)\>, the \<system name\> shall \<system response\> | Behavior active as long as a state holds. |
| Event-driven | When | When \<trigger\>, the \<system name\> shall \<system response\> | The response to a triggering event. |
| Optional feature | Where | Where \<feature is included\>, the \<system name\> shall \<system response\> | Behavior of products or systems that include a given feature. |
| Unwanted behavior | If … then | If \<trigger\>, then the \<system name\> shall \<system response\> | The required response to an undesired situation. |
| Complex | several | While \<precondition(s)\>, when \<trigger\>, the \<system name\> shall \<system response\> | Behavior that needs more than one keyword. |

The examples EARS gives:

- Ubiquitous: "The mobile phone shall have a mass of less than XX grams."
- State-driven: "While there is no card in the ATM, the ATM shall display 'insert card to begin'."
- Event-driven: "When 'mute' is selected, the laptop shall suppress all audio output."
- Optional feature: "Where the car has a sunroof, the car shall have a sunroof control panel on the driver door."
- Unwanted behavior: "If an invalid credit card number is entered, then the website shall display 'please re-enter credit card details'."
- Complex: "While the aircraft is on ground, when reverse thrust is commanded, the engine control system shall enable reverse thrust."

The patterns are building blocks: a complex requirement combines them, and a complex requirement for unwanted behavior uses `If … then` in place of `when`.

## Part 2: How RFCs apply EARS

### Notation

Keywords are written in capitals (`WHILE`, `WHEN`, `IF … THEN`, `WHERE`, `SHALL`) so they stand out from the prose around them. The system name is the §3 element that owns the behavior; see `format-rules.md` § "Name the subject". Requirements are grouped into leaves as `format-rules.md` describes.

### The system name is never its own trigger

A trigger is an event the system responds to, and it comes from outside the system: something an actor does, an input arriving, a signal from another component, time passing. The system starting, running or doing its job is not a trigger. A command or a function is always being invoked when its requirements apply, so its invocation is the implicit context of every requirement written about it, and restating it adds nothing.

- ✗ WHEN `devenv clone` runs, it SHALL clone the repository as a bare repository.
- ✓ `devenv clone` SHALL clone the repository as a bare repository.

A requirement with no condition that sets it apart from the others is ubiquitous.

### What each keyword is for

**`WHEN`: what the actor does on this invocation.** The arguments given or omitted, an option passed, a choice made in a prompt.

- ✓ WHEN `<name>` is omitted, `devenv clone` SHALL use the last segment of `<url>`'s path as the repository's name.
- ✓ WHEN `--force` is given, `devenv worktree rm` SHALL remove the worktree even while its sandbox is running.

**`WHILE`: preconditions that hold before the requirement applies and persist while it does.** The contents of files and data, recorded state, what exists, what's running, the state of other components, and the system's own mode. A precondition is a state even when it's a bad one.

- ✓ WHILE the config contains a sandbox escape, `validateProjectConfig` SHALL report it.
- ✓ WHILE the worktree's recorded `sourceConfig` no longer exists, `devenv container up` SHALL fail without changing anything.

A mode is a phase the system itself is in, such as creating a resource rather than starting an existing one. Define the mode once in its grouping's intro prose ("`up` is _creating_ the sandbox while the worktree has no container or `--rebuild` is given"), then use it as a precondition:

- ✗ WHILE the config contains a sandbox escape, WHEN `up` creates the sandbox, `up` SHALL fail before building anything. (The system's own action used as the trigger.)
- ✓ WHILE `up` is creating the sandbox and the config contains a sandbox escape, `up` SHALL fail before building anything.

**`IF … THEN`: an undesired event.** Something that goes wrong as it happens: invalid input given on this invocation, a call to another component failing, a timeout expiring, the actor cancelling.

- ✓ IF `--config` names a path that doesn't exist, THEN `devenv container up` SHALL fail without changing anything.
- ✓ IF the devcontainer CLI fails to build the sandbox, THEN `devenv container up` SHALL fail.
- ✓ IF the picker is cancelled, THEN `devenv worktree rm` SHALL exit with status `1` AND SHALL change nothing.

The test for `IF` vs. `WHILE`: did the bad thing arrive with, or happen during, this invocation (`IF`), or was it already true of the environment before it began (`WHILE`)? A bad argument is `IF`; a bad file already on disk is `WHILE`.

**`WHERE`: a feature the system is configured or built with.** It holds for every invocation of that configuration, and is decided before any of them. Options and arguments are never `WHERE`; they're what the actor does on one invocation, so they're `WHEN`.

- ✓ WHERE per-sandbox egress policies are enabled, the approver SHALL …
- ✗ WHERE `<name>` is omitted, `devenv clone` SHALL …

### Combining conditions

Keep EARS's order and counts: preconditions first, then at most one trigger (`WHEN` or `IF`), then the system name, then its responses.

- Join several preconditions with "and": "WHILE `up` is creating the sandbox and the config's content isn't approved, …".
- A requirement has one trigger. Two triggers that each lead to the response are two requirements.
- When different conditions lead to different responses, give each its own requirement. Don't join them with "or".
- When several requirements apply at once, they describe one combined outcome, and no "or" is needed to say so.

### Responses and obligations

A requirement has one or more responses, and every obligation in it is stated, never implied:

- **A further response** of the same requirement joins with `AND SHALL`: "…`up` SHALL fail before building anything AND SHALL print every escape."
- **A property of a response**, such as what an error message contains, is its own `MUST` sentence after the requirement, naming exactly what's required: "Its error MUST name `devenv container trust <repo> <branch>` as the way to approve the config."
- **A trailing clause never carries an obligation.** "…SHALL fail, naming the existing worktree" and "…SHALL proceed: it stops the sandbox and deletes the branch" state obligations without grading them, and usually without pinning down what they require. Rewrite them as `AND SHALL` responses or `MUST` sentences.
- **A purpose clause is fine** when it only explains ("…AND SHALL fetch them, so the remote's branches are tracked"), because it can't fail a test.

### Checklist

Run over every requirement in §4:

1. Is the order WHILE → WHEN/IF → system → SHALL, with at most one trigger?
2. Is the trigger an event from outside the system, not the system running or acting?
3. Is each condition the right keyword: an argument or action this invocation `WHEN`, a persistent fact or mode `WHILE`, something going wrong `IF`, a configured feature `WHERE`?
4. Does each requirement name exactly one system, as §3 names it?
5. Is every clause that could fail a test introduced by `SHALL`, `AND SHALL`, or an RFC 2119 keyword?
6. Do different responses to different conditions live in separate requirements, with no "or" between conditions that respond differently?
7. Is there any lead-in prose ("what happens depends on…") standing in for a condition that the requirements themselves leave out?
