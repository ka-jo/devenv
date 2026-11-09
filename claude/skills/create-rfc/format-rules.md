# RFC Format Rules

This file captures the conventions for writing RFCs in this format. Read it before drafting the Interface and Behavior sections of any RFC.

## Tense and temporal framing

An RFC describes the current behavior of the system, even when written months before implementation and read months after. To maintain this timelessness:

- **Motivation (§2)**: Use past tense when describing what the RFC *changes*. Frame changes as "Prior to this RFC, X did Y" rather than "Currently, X does Y." This clearly marks historical context. The rationale or problem can be present tense ("This is inefficient because..."), but the specific prior behavior must be marked as historical.
- **Interface (§3) and Behavior (§4)**: Write in present tense describing the desired/actual behavior. These sections define what the system SHALL do. After implementation, they accurately describe what the system does. Do not say "will add" or "will support" — say "adds" and "supports."
- **Examples (§5)**: Present tense, describing observed outcomes of the system as it is.

This discipline ensures that a reader opening an Implemented RFC six months after ship understands it as a description of the current system, not an outdated specification. Historical context belongs in Motivation, marked with "Prior to this RFC"; everything else describes the system as it is.

## Frontmatter

Four fields, no more:

```yaml
---
rfc: NNNN
title: [Short, specific title]
status: Draft | Ready | Implemented
see_also:
  - RFC-XXXX
  - ADR-XXXX
---
```

- **rfc**: Four-digit zero-padded number, matching the filename prefix.
- **title**: Short and specific. Mirrors the H1 heading.
- **status**: `Draft` while authoring. `Ready` once the author has reviewed it and judged it stable enough to implement. `Implemented` once the RFC has shipped. See "Status lifecycle and amendments" below for the meaning of each status and how RFCs change over time. This skill never sets `Ready` or `Implemented` — those promotions are human decisions.
- **see_also**: Junk-drawer field for RFCs, ADRs, or other documents a reader might find useful. No claim about the nature of the relationship — precise relationships (e.g., "extends RFC-0007 §3.3") live in the body of the document where they belong.

Do not add `created`, `updated`, `supersedes`, `superseded_by`, `amends`, or `amended_by`. Git tracks history; these fields would duplicate or drift from it.

## Status lifecycle and amendments

RFCs move through three statuses over their lifetime. No status is immutable — Ready and Implemented RFCs can still be edited. What changes is _how_ edits happen.

**Draft**: The RFC is being authored or actively under review. Open questions may exist. Edits happen freely. Direct edits, no amendment trace required.

**Ready**: The author has settled the shape and direction of this work and the document is consumable for implementation. Open questions are resolved. Edits during this status come in two flavors:

- **Direct edits** for changes that clarify, narrow, or fill gaps in the existing contract without contradicting it. No amendment entry required. The implementation PR can include these.
- **Amendments** for changes that contradict the existing contract — removing commitments, changing the meaning of an existing behavior, or substantially changing scope. These require an entry in the Amendments section (see below).

The test for which applies: would a reader of the original RFC be surprised by the change? Gap-filling shouldn't surprise them. Contradictions should.

**Implemented**: The RFC has shipped. The document now describes a built system, so the bar for what counts as "clarification" is higher than during Ready — even seemingly small wording changes can effectively change the meaning of what was built. Edits during this status:

- **Direct edits** for pure documentation hygiene only: typos, broken links, formatting fixes.
- **Amendments** for any edit that touches behavior, interface, or scope, regardless of whether it contradicts the original contract. The historical record of a shipped feature deserves a trace for substantive changes.

### Amendments section

When an RFC has its first amendment, add an `Amendments` section at the very end of the document (after all numbered sections). Do not include this section in Drafts or in Ready RFCs that haven't been amended — its presence in the table of contents is the signal that amendments exist.

The section is not numbered. Entries are listed in reverse chronological order (newest first):

```markdown
## Amendments

- 2026-06-03: Removed `legacyId` parameter from §3.3 findById signature.
  Determined during implementation that legacy ID support requires a
  separate compatibility layer; deferred to RFC-0019.
- 2026-05-20: Added §4.2.4 to clarify cache invalidation behavior on
  user updates. Discovered during implementation when the original
  spec was ambiguous about whether cache entries should be invalidated
  proactively or expire via TTL.
```

Each entry is a date, a short description of what changed (with section references), and the reasoning behind the change. Keep entries factual and concise; the full body of the document carries the current contract, and the Amendments section is just the lineage.

### What this means for the Ready review

The Ready promotion remains meaningful even though the document can change afterward. Promoting to Ready commits to _the shape and direction_ of the work. The gap-fill vs. contradiction rule preserves that meaning: clarifications stay within the shape that was agreed to; contradictions require explicit amendment entries that surface the change. The Amendments section is the receipt — anyone reading the RFC later sees both the current contract and the trail of substantive changes.

This skill creates new RFCs. Changes to existing RFCs — direct edits and amendments alike — are handled by the `revise-rfc` skill.

## Section numbering

All top-level sections are numbered. Subsections inherit numbering from their parent. Use the numbers as anchors — PRs, tests, code comments, and other RFCs will reference sections by number (e.g., `§4.2.1`), so the numbers are part of the contract.

## Section 3: Interface

### Group by type, not by kind

Each subsection in the Interface section is a single type, class, or interface. Do NOT split into "Types" and "Operations" subsections — that's an artificial grouping that scatters related members.

Order subsections: data types first, then error types, then the service/interface types that compose them. This mirrors how the code is read.

### Syntax highlighting

Use TypeScript code fences for new interface definitions:

````
```typescript
interface UserService {
  findById(id: string, signal?: AbortSignal):
    Promise<Result<User, UserError>>;
}
```
````

### Augmenting existing interfaces

When an RFC modifies an interface defined in a prior RFC, the Interface subsection follows this pattern:

1. Section header indicates the relationship: `### 3.1. UserService (extends RFC-0012 §3.3)`. Always reference the most recent RFC that modified the interface, not the original. The chain back-links itself.
2. Use a `diff` code fence to show the change with red/green highlighting, OR use Shiki diff annotations (`// [!code ++]`, `// [!code --]`) inside a `typescript` code fence to get both syntax highlighting AND diff visualization. The Shiki form is preferred when the docs site supports it (e.g., VitePress).
3. End with: `Members not listed above are unchanged from RFC-XXXX §X.Y.` This is the load-bearing claim — it tells the reader exactly how to interpret the partial definition.

Member removals are awkward to show in code form. Mention them explicitly in section prose before or after the code block: `Removes \`findByLegacyId\` (deprecated in RFC-0009).`

Example using Shiki annotations:

````
### 3.1. UserService (extends RFC-0012 §3.3)

```typescript
interface UserService {
  findById(id: string): Promise<Result<User, UserError>>;  // [!code --]
  findById(id: string, signal?: AbortSignal):              // [!code ++]
    Promise<Result<User, UserError>>;                       // [!code ++]
  bulkFindByIds(ids: string[], signal?: AbortSignal):       // [!code ++]
    Promise<Result<User[], UserError>>;                     // [!code ++]
}
```

Members not listed above are unchanged from RFC-0012 §3.3.
````

### Component interfaces

A UI component's inputs/outputs (props, emits, or the framework's equivalent) are a typed code fence like any other §3 member, not a prose sentence — even when empty:

```typescript
interface ExampleViewProps {
  id: string;
}
interface ExampleViewEmits {} // none
```

Keep both interfaces under one component subsection (group by type, not by kind); non-interface facts (route name, what it renders) stay in the subsection's prose.

## Section 4: Behavior

This is the most important section. It contains the behavioral contract that agents implement against.

### EARS notation

Use EARS (Easy Approach to Requirements Syntax) for individual requirements. The five patterns:

1. **Ubiquitous** (always true): `THE SYSTEM SHALL <response>`
2. **Event-driven**: `WHEN <trigger> THE SYSTEM SHALL <response>`
3. **State-driven**: `WHILE <state> THE SYSTEM SHALL <response>`
4. **Unwanted behavior**: `IF <unwanted condition> THEN THE SYSTEM SHALL <response>`
5. **Optional feature**: `WHERE <feature is included> THE SYSTEM SHALL <response>`

Patterns can be compounded: `WHILE <state>, WHEN <trigger>, THE SYSTEM SHALL <response>`.

The point of EARS is to force explicit triggering conditions. "The system validates input" is uselessly vague. "WHEN `findById` receives a malformed UUID, `UserService` SHALL reject it with a `ValidationError` before any network call" is testable.

### Name the subject; reserve `THE SYSTEM` for whole-feature behavior

`THE SYSTEM` in the patterns above is a placeholder for the _system of interest_ — EARS does not require that literal phrase, and a descriptive subject reads better and tests better. The discipline is to use a name that **already exists** rather than coining one:

- **Default to the §3 element that owns the behavior**, named exactly as §3 declares it (e.g., `defineService`, `UserService`, `ServiceQuery`). Drop the article — write `` `UserService` SHALL reject ``, not "THE `UserService` SHALL". The subject is then a real, grep-able artifact.
- **Reuse names across RFCs.** When the subject is a component another RFC defined, use that RFC's name for it — the same continuity the interface-augmentation pattern enforces for §3. Architectural-level actors use the term established in the relevant recorded decision or `CLAUDE.md`.
- **Don't invent a name to satisfy this rule.** If no existing name fits the subject, that's a signal, not a naming task: usually §3 is missing a type (an RFC gap to surface), or the requirement is over-decomposed. A brand-new label coined in §4 is exactly the arbitrariness to avoid.
- **`THE SYSTEM` stays valid** only when the behavior is genuinely about the feature as an undifferentiated whole and no single §3 element owns it. Cross-cutting invariants that span every operation are the typical case. For a single-component RFC, the named subject usually collapses to one consistent name throughout §4.

### RFC 2119 keywords for secondary obligations

Within a single EARS requirement, use RFC 2119 keywords (MUST, MUST NOT, SHOULD, SHOULD NOT, MAY, REQUIRED, RECOMMENDED, OPTIONAL) in caps to mark obligation strength on secondary claims:

> WHEN `findById` is called with a malformed UUID, `UserService` SHALL reject with a `ValidationError` before any network call. The error message MUST include the offending field name. The error MAY include a suggestion for the correct format.

EARS structures the requirement; RFC 2119 grades the strength of secondary obligations within it.

### Notes and admonitions

Use a note sparingly, for two cases only: a clarifying implication of an existing requirement that's easy to miss, or the rationale behind a pinned value or design choice. Never to restate what a `SHALL` already says.

**Hard rule**: a note MUST NEVER be the sole place a requirement lives. If removing it would silently drop a testable obligation, express that as a `SHALL`/`SHOULD` instead — notes explain, they don't obligate.

Use the docs site's admonition/container syntax (VitePress shown here) instead of inline "Note: ..." prose, so asides stay visually distinct from the EARS contract:

```markdown
::: info
150ms is Vuetify's `dialog-transition-leave-active` duration (125ms, per
ADR-0006) plus a small scheduling margin.
:::
```

Use an info-level container for clarifying context and a warning-level one for an easy-to-miss consequence. (VitePress's `::: tip`/`::: danger` also exist but are rarely needed here.)

**Smell to watch for**: a note that, if deleted, would leave a testable obligation nowhere else in the document — that's a requirement wearing a note as a disguise.

### Hierarchy

Hierarchy in Behavior is doing actual cognitive work — it encodes design judgment about what concepts are parallel and what generalizes. The structure of §4 is independent of the structure of §3: behavior is grouped by whatever mental model best communicates the system, not by interface shape. For simple service-shaped RFCs, the two may end up similar; for state machines, workflows, or event-driven systems, they often won't.

Use these heuristics:

- **Rule of three**: Don't introduce a subsection until you have three siblings to put in it. Two operations don't need a `§4.2 Read operations` wrapper; three or more do.
- **Group by mental model**: For services and workflows, often by operation lifecycle. For CRUD-style APIs, often by resource. For state machines, often by state. For event-driven systems, often by event type or guarantee. For UI-driven features, often by user-facing action. Pick the axis that best communicates how someone would reason about the system, and apply it consistently — don't mix axes within a single grouping level.
- **EARS requirements are leaves**: Don't nest EARS statements inside other EARS statements. If you want to express a compound condition, use a compound EARS pattern (e.g., `WHILE ... WHEN ...`) at a single level.
- **Internal nodes describe scope**: Section headers like `§4.2 Read operations` get a brief prose intro describing what's covered; the actual EARS requirements live in the leaf subsections.

When the natural grouping is ambiguous, ask the user. Grouping is a design judgment that the user is better positioned to make than this skill.

**Smell to watch for**: If §4's structure diverges wildly from §3's structure — e.g., the interface has six clean methods but Behavior is organized around four cross-cutting concerns that don't map to any of them — surface this to the user. The interface may be missing structure, the behavior grouping may be contrived, or there may be a real mismatch worth examining (and possibly mentioning in Motivation). Significant divergence isn't forbidden, but it's worth a conversation.

### Leaf granularity — one requirement per leaf

Tests and coverage reports cite leaves by number (`§4.2.3`), so a leaf holding several unrelated `SHALL`s lets one checkmark hide an untested one. Default to one `SHALL` per leaf, split by trigger or response. Multiple _tests_ per leaf is fine and expected; multiple _unrelated_ `SHALL`s per leaf is the problem.

Two exceptions where a leaf can hold more than one `SHALL`:

- **One requirement, multiple effects that only make sense together** — join the effects with `AND SHALL` instead of a bare "and," so each effect still carries its own `SHALL` and stays visible when scanning for coverage: "WHEN the request settles, `Deferred` SHALL resolve with `value` AND SHALL set `isOpen` to `false`." Splitting into separate leaves would wrongly suggest the two effects can happen independently — treat this as one leaf, but list both effects in the coverage report.
- **A small set of `SHALL`s that together cover every value of one input** — e.g. what happens for `timeout > 0` vs. `timeout = 0`. Keep these together so a missing case (like negative `timeout`) is easy to spot. Add a one-line intro naming what's being covered:

  ```
  §4.2.3 Notification timeout — behavior depends on the `timeout` field:
  WHEN `timeout` > 0, THE SYSTEM SHALL auto-dismiss after that many ms.
  WHEN `timeout` = 0, THE SYSTEM SHALL persist until dismissed explicitly.
  ```

If two `SHALL`s just happen to sit near each other but answer different questions, split them — e.g. "SHALL display the head of the queue" and "SHALL auto-dismiss after `timeout`" are unrelated and belong in separate leaves. And don't nest a two-case group into its own `§x.y.z.1`/`.2` subsections — two cases can stay inline in one leaf.

### Invariants subsections

When three or more sibling subsections within a grouping share a requirement, lift it into an `Invariants` subsection rather than repeating it. State once, apply within the scope.

**Placement and scope**:

- Invariants subsections can appear at any grouping level — at the top of §4, or inside any subgrouping like §4.2.
- By convention, an Invariants subsection is the first subsection within its parent grouping, taking the lowest number (e.g., `§4.1 Invariants`, `§4.2.1 Invariants`).
- By convention, Invariants apply to the operations described in the same grouping. The placement carries this meaning at a glance.
- The Invariants subsection MUST begin with a one-line prose scope statement that names the subsections it applies to, by section number. The placement convention communicates scope visually; the scope statement makes it explicit and unambiguous.

Scope is bounded to the current RFC. Invariants do NOT extend automatically to operations added in future augmenting RFCs, and do NOT scope to TypeScript types — the reach of an invariant is exactly the subsections enumerated in its scope statement, and nothing else. A future RFC adding operations is responsible for restating any invariants that should apply.

**Every invariant must produce testable behavior**, including invariants stated as assumptions. An assumption like "callers are authenticated upstream" can be expressed as a real invariant if it produces verifiable behavior:

```
§4.1 Invariants

These requirements apply to every operation described in §4.2 and §4.3.

§4.1.1 Authentication
   WHEN any operation in §4.2 or §4.3 is called by an unauthenticated
   caller, THE SYSTEM SHALL behave as if the caller were authenticated.
   Authentication is enforced upstream (see §2).
```

This is testable — a test can verify the operation does not throw an auth error. The assumption is doing real work as part of the contract.

If you find yourself wanting to write something like "THE SYSTEM SHALL assume X is handled upstream," stop. That's not a requirement; it's a comment dressed up as EARS. Move it to Motivation (§2) or Out of scope (§6) as prose.

**Smell to watch for**: An RFC where §4 contains only an Invariants subsection and no per-operation behavior is a smell. Either the operations don't need per-operation behavior (the invariants cover everything) and the structure is fine, or per-operation behavior was skipped and should be added. Flag this for the user.

### Coverage, not structural mirror

Every EARS requirement in §4 should be exercised by at least one test, but the test structure does not need to mirror the Behavior section structure.

The discipline is to verify coverage — that each requirement has corresponding tests — not to enforce structural correspondence between the spec and the tests. Tests cite the requirement they verify with a comment above the test (e.g., `// RFC-0001 §4.1.1`) and keep section numbers out of test names, since numbers can shift across amendments. The spec is a design artifact; tests are a verification artifact; they're allowed to have different shapes.

## Section 5: Examples

Examples are highly recommended. They carry the textured detail that EARS describes abstractly — concrete fixture data, specific input values, observed side effects. EARS gives the rule; examples show what the rule looks like in practice.

Examples are most valuable when:

- Operations are stateful and the EARS requirements use compound state-driven conditions (e.g., `WHILE ... WHEN ...`).
- Requirements describe relationships between multiple operations (e.g., "subsequent calls SHALL return cached values").
- Concrete fixture data clarifies behavior that EARS describes abstractly.
- The interface involves data transformations where the input/output shape is non-obvious from the type signatures alone.

Examples are usually unnecessary for simple, stateless request/response operations with self-explanatory signatures. Don't include filler examples — an empty or rote Examples section is worse than no section at all.

When examples are included, format each scenario with explicit setup, the call being made, and the observed result. Include side-effect observations (network calls, cache state, emitted events) when they're part of the contract:

```
### 5.1. Cached lookup

Setup: cache contains { "abc-123": User { id: "abc-123", email: "..." } }
Call: userService.findById("abc-123")
Result: Result.ok(User { id: "abc-123", ... })
Network calls observed: 0
```

## Section 6: Out of scope

Single flat list of things this RFC deliberately does not address. Each item should explain _why_ it's out of scope — delegation upstream, principled rejection, or deferred to future work.

For items that are deferred but actively shape the current design (i.e., the design must accommodate them without breaking changes), append `[future]` to the item. This tags forward-looking commitments without requiring subsection structure.

Example:

```markdown
- Authentication. Handled upstream by AuthService.
- Write-through caching. Conflicts with optimistic UI patterns (ADR-0004).
- Bulk operations [future]. Deferred; the single-record interface in §3.3
  is designed to compose into bulk operations without breaking changes.
```

Out of scope items are fences against agent over-building. Agents tend to add adjacent features unless explicitly told not to. A specific, well-fenced Out of Scope section is one of the highest-leverage parts of an RFC.

## Section 7: Open questions

Allowed in `Draft` status. Required to be empty (or section deleted) for `Ready` status — the human promoting to `Ready` is responsible for this rule.

If there are no open questions during drafting, delete the section entirely rather than including an empty one.

## What not to put in an RFC

- **Style and patterns**: Conventions about file layout, naming, library choices, formatting — these belong in `CLAUDE.md`, `AGENTS.md`, or ADRs. Specs pin behavior, not style.
- **Implementation tasks**: An RFC says what the system must do, not the sequence of steps to build it. Tasks (if needed) belong in the PR description or a separate tasks file for large features.
- **Plans for future RFCs**: A wish list of "things we might do" is noise. Only include forward-looking items in Out of Scope when they shape the current design.

## Common failure modes to avoid

- **Conversational prose where EARS would do**: If the Behavior section reads like an essay, it's not specific enough. Convert paragraphs into WHEN/SHALL statements.
- **Premature hierarchy**: A single subsection under a Behavior heading is a smell. Either inline the requirements or add siblings.
- **Style requirements masquerading as behavior**: "Components SHALL use Tailwind classes" is a style rule, not a behavior. It does not belong in an RFC.
- **Vague triggering conditions**: "When the user does something wrong" is not an EARS condition. Name the specific event or state.
- **Implicit scope**: If a reader can't tell whether feature X is in or out of scope, the RFC has failed. Out of Scope should be specific enough to fence agent behavior.
- **Non-requirements as EARS**: A statement like "THE SYSTEM SHALL assume X is handled upstream" is not a real requirement — nothing can be tested. If an "invariant" can't be expressed as verifiable behavior, it belongs in Motivation or Out of scope as prose.
- **Invariant-only Behavior sections**: An §4 that contains only an Invariants subsection and no per-operation behavior is usually a sign that per-operation requirements were skipped. Surface this for the user to confirm.
- **Multiple unrelated `SHALL`s under one anchor**: a subsection bundling distinct triggers or responses lets a per-section coverage mark hide untested behaviors. Default to one `SHALL` per leaf; the only exceptions are effects that only make sense together, or a small set of `SHALL`s covering every value of one input (kept together on purpose).
- **Behavior grouping forced to mirror Interface**: §4 organizes by mental model, not by interface shape. Don't force a per-operation grouping if the natural mental model is by state, phase, or concern. Significant divergence from §3 structure is worth examining but isn't forbidden.
- **Bare "Note: ..." prose instead of an admonition container**: a plain paragraph starting with "Note:" sitting inline next to EARS statements is easy to mistake for normative text, or can accidentally hide normative content that should have been a `SHALL`. Use an admonition container (e.g., `::: info` / `::: warning`) instead.
