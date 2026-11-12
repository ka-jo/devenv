# ADR Template

Copy this scaffold for every new ADR. Replace bracketed placeholders. All six sections are required; the only optional content is the frontmatter fields marked as conditional.

````markdown
---
adr: NNNN
title: [The decision, stated as a rule — e.g. "Route all data access through the service layer"]
status: Proposed
date: YYYY-MM-DD
supersedes:        # only when this ADR supersedes others; delete otherwise
  - ADR-XXXX
see_also:          # delete if empty
  - ADR-XXXX
  - RFC-XXXX
  - docs/path.md   # or a URL
---

# ADR NNNN: [Title]

## Decision

1. [Subject] MUST [rule].
2. [Subject] MUST NOT [rule].
3. [Subject] SHOULD [default]. [When deviation is acceptable.]
4. [Subject] MAY [explicitly permitted thing a reader might otherwise assume is forbidden].

## Context

[The forces as of the decision date, option-neutral. If superseding, name the ADR and what changed.]

## Rationale

[Why the chosen option wins against those forces.]

## Alternatives

### [Option name]

[One line on what it is.]

**Rejected because** [the decisive reason].

### [Option name]

[...]

**Rejected because** [...].

## Consequences

- [Cost accepted, thing ruled out, or follow-up work created.]

## Confirmation

- `[artifact path]` ([rule/test/mechanism]): [what it enforces]; catches [the violation], or makes [the right thing] the default.
- `[artifact path]` ([...]): [...] (planned)
- Premise: `[artifact path]` ([...]): [the Rationale claim it verifies].
- Not covered: [known gaps, or "Enforced by convention only."]
````
