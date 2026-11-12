---
name: create-adr
description: Author ADRs (architectural decision records) for project-specific decisions, including superseding an Accepted decision, applying acceptance to a Proposed one, deprecating one, and editing an existing ADR. Use proactively when a conversation settles an architectural choice that isn't recorded, or when RFC work surfaces a decision the RFC would otherwise be making. Not for RFCs (use create-rfc), cross-project standards, or CLAUDE.md content.
---

# create-adr

This skill produces ADRs in a fixed format. An ADR records one decision made for this project: what was decided, the forces behind it, why the chosen option won, what was rejected, and which artifacts enforce it. ADRs are the source of truth for project-level decisions; RFCs inherit them (via `see_also`), and `CLAUDE.md` may distill them but never replaces them.

An ADR is a point-in-time record. Once Accepted, its decision is never changed by editing it — a changed decision is a new ADR that supersedes the old one. See `format-rules.md` § "Lifecycle and editing".

## When to use this skill

Trigger when:

- The user asks to write, draft, create, or record an ADR or decision record.
- The user wants to change or reverse an Accepted decision. This is a new ADR that supersedes it — never an edit to the old one.
- A conversation settles an architectural choice for the project and nothing records it. Suggest drafting an ADR.
- RFC drafting (`create-rfc`, `revise-rfc`) surfaces a decision the RFC would otherwise be making. Stop the RFC work, record the decision here, then resume the RFC with a `see_also` link.
- The user accepts a Proposed ADR (step 6) or deprecates an ADR (step 7).
- An existing ADR is about to be edited, for any reason. Read `format-rules.md` § "Lifecycle and editing" first and apply its compliance test. An edit that passes (typos, wording, Confirmation updates) is made directly, with no further workflow; one that fails is a superseding ADR.

Lean toward recording. Following an existing standard or the conventional approach is still a decision, and a short ADR whose rationale is "this is the standard approach" (with a link) is worth having: it dates the choice and gives a later change something to supersede.

Do not use this skill for:

- **RFCs** — feature behavior and interface contracts. Use `create-rfc`.
- **Cross-project standards and conventions** — defining one is out of scope. Adopting one *in this project* is an ADR.
- **CLAUDE.md content** — a distillation, never a source of truth.

## Workflow

### 1. Determine the next ADR number

List `docs/adrs/` and find the highest existing ADR number. The new ADR takes the next number, zero-padded to four digits. If `docs/adrs/` doesn't exist yet, start at `0001`.

### 2. Check for an existing decision on the same surface

Skim the titles in `docs/adrs/` (the generated `README.md` lists every Accepted ADR; also check any Proposed files, which it omits) for a decision covering the same ground. If one exists and the new decision contradicts or replaces any part of it, this ADR supersedes it — in full. Confirm that with the user, then list it under `supersedes`. Do not edit the old ADR now; supersession takes effect at acceptance (step 6).

If the new decision only *adds* to an existing one without contradicting it, it's an independent ADR with a `see_also` link, not a supersession.

### 3. Confirm scope with the user before drafting

Establish the following, taking what the conversation already settled and asking only for what's missing:

- **The decision**, stated as a rule the codebase follows — and its scope. Where does it apply, and where doesn't it? (Does "components" include composables and stores?) Scope ambiguity is the most common ADR defect; it surfaces at enforcement time if not here.
- **The forces**: the problem or constraint that made a decision necessary.
- **The alternatives actually considered**, and the decisive reason each lost. Record only options that were genuinely on the table. Never invent strawman alternatives to fill the section; if only one option was considered, say so.
- **Enforcement**: what artifacts (lint rules, tests, types, scaffolding, code) enforce or embody the decision, whether they exist yet, and what isn't covered.

One decision per ADR. If one clause could plausibly be reversed later for different reasons than the others, it's a separate ADR — supersession is always total, so bundled decisions can't be changed independently.

Don't extract everything upfront — the draft is the conversation.

### 4. Draft the ADR

Read `format-rules.md` before drafting. The Decision and Confirmation sections have the most non-obvious conventions.

Create `docs/adrs/<NNNN>-<kebab-title>.md`. Follow `template.md` exactly and `format-rules.md` for section content. Default `status: Proposed` and `date` to today. Never set `Accepted` — that promotion is the human's.

When superseding, start from the old ADR's Decision and restate every clause that still holds. Anything not restated is no longer in force.

### 5. Review with the user

Walk through the draft and ask specifically:

- "Is each Decision clause graded right?" — MUST means deviating requires a superseding ADR; SHOULD means a justified deviation is allowed without one. Getting this wrong makes the ADR either brittle or toothless.
- "Does the Decision answer the edge cases of its own scope?" Use the Confirmation draft as the probe: if a lint rule's file glob or a test's boundary can't be written without guessing, the Decision is underspecified.
- "Is the Context option-neutral?" It should read as true no matter which option had been chosen.
- "Does Confirmation name artifacts only?" No review, approval, or process items. Are known gaps listed under "Not covered"?

When the review raises nothing further and no questions remain open, ask whether to accept the ADR now. If yes, continue to step 6.

### 6. Acceptance (only when the user says the ADR is accepted)

When the user accepts a Proposed ADR, apply all of these in one change:

1. Set its `status: Accepted` and `date` to the acceptance date.
2. Retire each ADR in its `supersedes` (step 7).
3. Regenerate the index: `~/.claude/skills/create-adr/build-index.sh docs/adrs` (the path resolves in containers too).
4. Check `CLAUDE.md` for distilled content that the accepted or superseded ADRs affect, and propose updates to the user.

If the user declines a Proposed ADR, delete it — there is no Rejected status. If the "no" is itself worth recording ("we will not adopt X"), that's a new ADR with that decision.

### 7. Retiring an ADR (superseded or deprecated)

An ADR is retired in one of two ways: a superseding ADR is accepted (step 6), or the user deprecates it because it no longer applies and nothing replaces it. Supersession never happens on its own — it is always part of accepting the replacement.

1. Set its `status: Superseded` and add `superseded_by: ADR-NNNN`, or set `status: Deprecated`. Change nothing else in it.
2. Walk its Confirmation list. Each artifact is removed, rewritten, or (when superseded) carried forward into the new ADR's Confirmation. Confirm with the user before removing enforcement.
3. Search the codebase for citations of the retired ADR (`ADR-NNNN` comments at enforcement sites). Re-point them to the superseding ADR, or remove them.
4. Search `docs/rfcs/` for references to the retired ADR and report them to the user as `revise-rfc` work. Don't edit RFCs here.
5. When deprecating, also regenerate the index and check `CLAUDE.md`, as in step 6.

## Reference files

- `template.md` — The exact ADR scaffold. Start every new ADR from it.
- `format-rules.md` — Frontmatter, lifecycle and editing rules, section-by-section content conventions, and a complete example. Read before drafting.
- `build-index.sh` — Regenerates `docs/adrs/README.md` from the frontmatter of every Accepted ADR. Run on acceptance, deprecation, or any change to an ADR's title or status; safe to run any time.
