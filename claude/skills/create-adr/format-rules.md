# ADR Format Rules

Conventions for writing ADRs in this format. Read before drafting, particularly the Decision and Confirmation sections.

## Shape and reading order

Sections run Decision → Context → Rationale → Alternatives → Consequences → Confirmation. The order serves how ADRs are read: after acceptance, almost every read is a lookup ("what did we decide about X?", "am I allowed to do Y?"), and an agent loading an ADR as a constraint for RFC or implementation work needs the binding rule first. Context exists for the rarer reader who is questioning the decision or checking whether it applies.

Each fact lives in exactly one section. The sections are divided to prevent the repetition that makes option-comparison formats verbose:

| Section | Holds | Must not hold |
|---|---|---|
| Decision | The binding rule and its scope | Justification |
| Context | Forces, constraints, facts | The chosen option |
| Rationale | Why the chosen option wins | Arguments against alternatives |
| Alternatives | Each rejected option + decisive reason | Pros of the chosen option |
| Consequences | Costs, constraints, follow-up work | Benefits already in Rationale |
| Confirmation | Artifacts that enforce the decision | Process |

## Frontmatter

```yaml
---
adr: NNNN
title: [Decision stated as a rule]
status: Proposed | Accepted | Superseded | Deprecated
date: YYYY-MM-DD
supersedes:          # conditional
  - ADR-XXXX
superseded_by: ADR-XXXX   # conditional
see_also:            # optional
  - ADR-XXXX
  - RFC-XXXX
  - docs/path.md     # or a URL
---
```

- **adr**: Four-digit zero-padded number, matching the filename prefix.
- **title**: The decision itself, phrased as a rule ("Route all data access through the service layer"), not a topic ("Data access"). The generated index lists titles only, so the title must carry the decision on its own. Mirrors the H1. Single-line; quote it if it contains `: ` or ` #`.
- **status**: See "Lifecycle and editing".
- **date**: The decision date — when the ADR was accepted. While Proposed, the date drafted. Unlike RFCs, an ADR is a point-in-time record, so the date belongs in the document rather than only in git.
- **supersedes**: ADRs this one replaces in full. Present only when non-empty.
- **superseded_by**: Added to an ADR when a superseding ADR is accepted. Present only on Superseded ADRs.
- **see_also**: Related ADRs (`ADR-NNNN`), RFCs (`RFC-NNNN`), standards, or documents (repo-relative path or URL) with no claim about the relationship. Explain any precise relationship in the body.

No other fields. Authorship and edit history live in git.

## Lifecycle and editing

**Proposed**: Being drafted or under discussion. Edited freely. If declined, delete it. There is no Rejected status. A deliberate "we will not do X" is a decision of its own and gets its own ADR.

**Accepted**: The decision is in force. From here, the decision is fixed. Edits are allowed only when they don't change what counts as compliance:

> **Compliance test:** if someone who followed the old text would be out of compliance under the new text, or the reverse, the edit changes the decision. Write a superseding ADR instead.

In practice:

- **Always allowed**: typos, wording clarifications that don't shift meaning, broken links, formatting, and status/`superseded_by` metadata. Clarifying an ambiguous clause toward the reading every artifact in Confirmation already enforces counts as a clarification.
- **Allowed and expected**: updating Confirmation as enforcement is added, moved, or removed (including dropping a `(planned)` marker when the artifact lands). Enforcement changes don't change the decision.
- **Never allowed**: changing Decision clauses or their RFC 2119 grading, narrowing or widening scope, adding exceptions, or resolving an ambiguity in a way that makes any reasonable reading of the old text non-compliant. That last one is a scope change, however small it looks.

Separately, because an ADR is a point-in-time record, Context and Rationale are never rewritten to reflect circumstances after the decision date. Context describes the world when the decision was made. If the world changed enough to matter, that's the Context of a superseding ADR.

**Superseded**: Replaced in full by the ADR in `superseded_by`. Kept as history and excluded from the index. Frozen: no further edits, Confirmation included. Supersession is always total. There is no partial "amends" relationship. To change one clause, the new ADR restates the whole decision as it now stands, so every Accepted ADR is self-contained.

**Deprecated**: No longer applies, with no replacement. For example, the subsystem it governed was removed. Excluded from the index, and frozen like a Superseded ADR.

This differs from RFCs on purpose. An RFC describes the current system and is amended in place. An ADR records a decision made at a point in time and is replaced, not amended.

## Decision

Write the rule, not the story. Use present tense and normative wording, graded with RFC 2119 keywords in caps:

- **MUST / MUST NOT**: a hard boundary. Deviating requires a superseding ADR.
- **SHOULD / SHOULD NOT**: the default. A deviation with a stated reason (e.g. a code comment citing the ADR) is allowed without superseding. Use this when exceptions are expected, so they don't become a reason to supersede or to quietly ignore the ADR.
- **MAY**: explicit permission for something a reader might otherwise assume is forbidden. Use it to head off over-cautious readings, by agents in particular.

Name the subject concretely (paths, layers, module names), and state the scope. "Components MUST…" leaves composables and stores ambiguous. Either name them or say they're excluded.

Violations that predate the ADR are migration debt, not deviations. List them in Consequences and track each with a suppression citing the ADR (e.g. a per-line lint disable). New code gets no such allowance.

When there are several clauses, use a numbered list, one rule per item. When the decision is a single choice with no graded strength (e.g. "Use Bun as the workspace runtime and package manager"), one plain sentence is fine. Don't force keywords where they add nothing.

Keep RFC 2119 keywords out of every other section. Context, Rationale, Alternatives, and Consequences describe; they don't oblige.

## Context

The forces: what problem or constraint made a decision necessary, as of the decision date. Specific facts beat general claims ("auth header injection was reimplemented in 40+ call sites" over "the code was inconsistent").

**Option-neutral rule**: Context reads as true whichever option had been chosen. If a sentence only makes sense given the chosen option, it belongs in Rationale.

When superseding, name the superseded ADR and what changed since it was accepted. That's the Context of the new decision.

## Rationale

Why the chosen option wins against the forces in Context. Tie claims back to those forces. Don't argue against alternatives here. Each alternative's rejection lives with that alternative.

If the rationale really is "this is the standard approach", say so and link the standard. Brief is fine; empty is not.

## Alternatives

Only options that were actually considered. Never invent strawmen. If only one option was considered, write one sentence saying so and why (e.g. "No alternatives considered; this adopts the standard X"), with no subheadings.

Each alternative gets its own `###` subheading naming the option, followed by exactly two paragraphs:

1. One line on what the option is.
2. **Rejected because** the **decisive** reason it lost.

```markdown
### Shared HTTP client wrapper only

Call sites use a typed `http.get` that handles auth and errors.

**Rejected because** it centralizes transport but not resource knowledge; URLs and response mapping stay scattered.
```

The subheadings put the options considered in the document outline and give each one a linkable anchor. Keep to the two paragraphs: no pros/cons lists, no comparison tables, no secondary reasons. The fixed shape is what keeps this section from growing into a symmetric option-by-option comparison.

An alternative that remains compatible with the decision (e.g. a caching library that could later sit on top of the chosen layer) should say so in its Rejected-because paragraph. That stops a future reader from treating it as forbidden.

## Consequences

What the decision causes going forward:

- Costs and friction accepted.
- What it rules out.
- Follow-up work it creates, such as migrations or enforcement still to be built.

Don't restate benefits that Rationale already argued. A consequence worth listing is one a reader wouldn't infer from Rationale.

## Confirmation

The artifacts that enforce or embody the decision. ADRs rarely stand alone: they ship alongside lint rules, tests, types, scaffolding, and code. This section is the map from the decision to those artifacts.

Rules:

1. **Each entry names an artifact**, such as a file, lint rule, test, script, or type, **and the violation it catches** or what it makes the default. Format: `` `path` (mechanism): what it enforces; what it catches ``. Leading with the path makes the list scannable by artifact, which is how it's used when superseding.
2. **No process.** "Reviewed in PR", "the team will follow this", and approval steps are not confirmation. If you can't name an artifact, the item doesn't belong here.
3. **"Not covered" is required.** List known gaps: what the artifacts miss, or what no mechanical check can judge. "Enforced by convention only" is a valid and useful answer; it tells a future reader the decision may have drifted.
4. **Underspecified Decision → fix the Decision.** If an entry can't be written without guessing scope (which glob does the lint override use? does the boundary rule cover stores?), the Decision is incomplete. Resolve the scope there. Don't write vague confirmation to cover it.
5. **Planned artifacts are marked `(planned)`**, and the marker is dropped when the artifact lands. Prefer shipping the ADR together with its enforcement.
6. **Include both kinds of confirmation**: whether the codebase *adopts* the decision (lint bans, boundary rules) and whether the decision's *premises* hold (e.g. a spec verifying the chosen abstraction does what the Rationale claimed). Prefix entries of the second kind with `Premise:`. They are easy to forget and are what a future superseder needs most.

Enforcement sites cite the ADR in a comment (e.g. `// ADR-0007` on the lint rule), so the link runs both ways. When an ADR is superseded, its Confirmation list is the checklist of artifacts to remove or rewrite.

## Index

`docs/adrs/README.md` is generated by `build-index.sh` from frontmatter, and lists Accepted ADRs only. Never edit it by hand. Regenerate it on every acceptance, supersession, or deprecation, and after any edit to an ADR's title.

## Example

```markdown
---
adr: 0007
title: Route all data access through the service layer
status: Accepted
date: 2026-03-14
see_also:
  - ADR-0004
---

# ADR 0007: Route all data access through the service layer

## Decision

1. Components, composables, and stores MUST obtain remote resources only by calling a service in `src/domains/*/services/`.
2. Code outside `src/domains/*/services/` and `src/lib/http/` MUST NOT issue HTTP requests directly: no `fetch`, no HTTP client imports, no `useFetch`.
3. Services MUST return domain types. Transport types (`Response`, `AxiosResponse`) MUST NOT cross the service boundary.
4. A service MAY call another domain's service through that domain's public `index.ts` (ADR-0004).

## Context

Components fetched data three ways: raw `fetch`, a shared axios instance, and VueUse's `useFetch`. Auth header injection and error mapping were reimplemented at each call site, and the token-refresh change in January touched 43 files. Component tests mocked `fetch` globally, so a test passing said nothing about which endpoint a component called. Stores accounted for roughly half of the direct requests.

## Rationale

One boundary per domain puts auth, error mapping, and response typing in one place, and gives component and store tests a mock seam that reflects intent (`ordersService.list`) rather than transport. Stores are included because they were the largest source of direct requests; exempting them would have left most of the problem in place.

## Alternatives

### Shared HTTP client wrapper only

Call sites use a typed `http.get` that handles auth and errors.

**Rejected because** it centralizes transport but not resource knowledge; URLs and response mapping stay scattered across components.

### Component-level data-fetching library (TanStack Query)

Components fetch through query hooks that own caching and request state.

**Rejected because** it addresses caching and request state, not where resource knowledge lives. It remains compatible as a layer on top of services.

## Consequences

- Every new endpoint needs a service function before any component can use it, even for one-off screens.
- 43 existing call sites must migrate. Until they do, they carry per-line lint disables citing this ADR.
- Component tests mock services, not HTTP. HTTP-level tests live with the services.

## Confirmation

- `eslint.config.ts` (`no-restricted-globals`, `no-restricted-imports`): bans `fetch`, `axios`, `ofetch`, and `@vueuse/core#useFetch` outside `src/domains/*/services/**` and `src/lib/http/**`; catches hand-rolled requests in components, composables, and stores.
- `eslint.config.ts` (`eslint-plugin-boundaries`): `components`, `composables`, and `stores` may import `services`, never `lib/http`; catches bypassing services through the HTTP layer.
- `src/lib/http/index.ts` (public exports): transport types aren't exported; makes domain return types the default for services.
- `scripts/check-service-returns.ts` (type-level check): fails when a service's exported return type references `Response` or `AxiosResponse`; catches transport types leaking through explicit annotations. (planned)
- Premise: `src/lib/http/auth.spec.ts` (spec): a 401 from any service call triggers exactly one token refresh and retry; verifies auth handling lives in one place, as Rationale claims.
- Not covered: HTTP-capable libraries not on the restricted list, and services that leak transport shapes through loosely typed domain types.
```
