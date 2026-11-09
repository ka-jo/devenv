---
name: create-rfc
description: Author RFCs (Request for Comments) as specifications for feature work in repositories that use the RFC-driven development workflow. Use this skill whenever the user asks to write, draft, create, or author an RFC, spec, or specification. Also use it proactively when the user is describing a feature, work item, interface change, or non-trivial piece of behavior that an agent is expected to implement — an RFC is the input format for agent-implemented work, so describing such work without one is a signal an RFC should be drafted first. Do not use this skill for ADRs (architectural decision records), READMEs, or general documentation — those have different formats and purposes.
---

# create-rfc

This skill produces RFCs in a fixed format. RFCs are the input contract for agent-implemented feature work: well-formed RFCs reduce variance in agent output by pinning behavior precisely. Recorded architectural decisions (ADRs or equivalent) capture durable choices; RFCs specify feature-level work that lives within them.

## When to use this skill

Trigger when the user:

- Explicitly asks to write, draft, create, or author an RFC.
- Describes a feature, work item, or interface change at enough detail that an agent will be expected to implement it. In this case, suggest drafting an RFC before implementation rather than implementing directly. Be a bit pushy about creating RFCs — under-specified work can lead to inconsistent agent output, and the RFC is the fix.

Before pushing for an RFC, check `docs/rfcs/` for an existing RFC that covers the same surface. If one exists, direct the user to use the `revise-rfc` skill. It can handle making changes to an RFC in any status.

Do not use this skill for:

- Architectural decision records — those capture a decision and its rationale, not feature behavior.
- READMEs, runbooks, postmortems, or general documentation.
- Implementation-level task lists or PR descriptions.

## Workflow

### 1. Determine the next RFC number

List `docs/rfcs/` and find the highest existing RFC number. The new RFC takes the next number, zero-padded to four digits (e.g., `0007`, `0023`). If `docs/rfcs/` doesn't exist yet, start at `0001`.

### 2. Confirm scope with the user before drafting

Ask the user briefly about:

- What the feature does (one-paragraph summary).
- What existing interfaces or RFCs it touches or extends.
- What's explicitly out of scope.
- Which architectural decisions the work operates within — the recorded decisions (ADRs or equivalent) and `CLAUDE.md` conventions it inherits. Capture these in the `see_also` frontmatter and reference them in Motivation (§2). The RFC inherits these decisions; it does not restate them. This is the thread an implementer follows to load the right constraints.

Don't try to extract everything upfront — the draft itself is the conversation. But these questions prevent drafting in the wrong direction.

### 3. Draft the RFC

Create the file at `docs/rfcs/<NNNN>-<kebab-title>.md` (e.g., `docs/rfcs/0007-user-service.md`).

Follow the structure in `template.md` exactly. Default `status:` to `Draft`. Do not set status to `Ready` — the human is responsible for that promotion.

While drafting, consult `format-rules.md` for the conventions on EARS, RFC 2119 keywords, hierarchy, interface augmentation, and section content. Read it before writing the Behavior section in particular — that section has the most non-obvious conventions.

### 4. Review with the user

After drafting, walk the user through the major sections and ask specifically:

- "Is the Behavior section grouped the way the system actually works, or is the grouping arbitrary?" (Grouping is a design judgment; ask explicitly.)
- "Are there requirements in here that are actually about style or patterns rather than behavior?" (Style belongs in `CLAUDE.md` / `AGENTS.md`, not RFCs.)
- "Are there open questions that should be resolved before this RFC is consumable?"
- "Does this RFC depend on an architectural decision, or try to _make_ one?" An RFC may operate within recorded decisions (link them); it must not establish or change one. If the work requires a new architectural decision or a change to an existing one, that belongs in a decision record, not an RFC — stop and have the user settle and record the decision first, then build the RFC on it.
- **Tense check**: "Does the Motivation section mark historical behavior with 'Prior to this RFC'? Are Interface and Behavior sections written in present tense as if describing the system as it is?" (An Implemented RFC should always read as a description of the current system. See `format-rules.md` § "Tense and temporal framing.")

Open Questions section content is fine in `Draft` status. The user (not this skill) will decide when to promote to `Ready`, and they know the rule: `Ready` requires Open Questions to be empty.

### 5. Do not implement from the RFC in this session

This skill produces the spec. It does not implement against it. If the user asks to implement after drafting, that's a separate task that requires the RFC to be in `Ready` status first.

## Reference files

- `template.md` — The exact RFC scaffold (frontmatter + section structure). Use this as the starting point for every new RFC.
- `format-rules.md` — Conventions for EARS notation, RFC 2119 keyword usage, hierarchy heuristics, interface augmentation patterns, and what content belongs in each section. Read this before drafting the Interface and Behavior sections.

## A note on examples

Examples of well-written RFCs are the most effective guidance for this skill. As RFCs are written, the best ones should be referenced from `format-rules.md` by number and section, so future drafts can pattern-match against them. This skill will improve as the corpus grows.
