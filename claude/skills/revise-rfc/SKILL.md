---
name: revise-rfc
description: Make changes to an existing RFC of any status — fluid edits to Drafts, gap-fills and clarifications to Ready RFCs, and formal amendments when a change contradicts a Ready or Implemented contract. Use this skill whenever the user asks to revise, amend, update, edit, correct, or change an existing RFC, when a gap is surfaced during implementation (an ambiguous, contradictory, or missing requirement found during implementation), when resolving an RFC's open questions, or when new work overlaps the surface of an existing Ready or Implemented RFC. The skill branches its workflow on the RFC's status: Drafts are revised freely under the authoring format rules; Ready and Implemented RFCs get each change classified as a direct edit or a formal amendment, with the Amendments section maintained as the trail. Do not use this skill for authoring new RFCs (use create-rfc) or for architectural decision records.
---

# revise-rfc

This skill is the single entry point for changing an existing RFC, whatever its status. The body of an RFC is always the current contract; what varies by status is how freely the body can change and what trail a change must leave. Drafts change fluidly with no ceremony. Ready and Implemented RFCs change through classified edits, with formal amendments recorded when a change contradicts what was settled at `Ready`.

The authoritative rules for the status lifecycle, the direct-edit vs. amendment distinction, and the Amendments section format live in `../create-rfc/format-rules.md` under "Status lifecycle and amendments". Read that section before making any change.

## When to use this skill

Trigger when:

- The user asks to revise, amend, update, edit, or correct an existing RFC — at any status.
- Implementation work surfaced an RFC gap: an ambiguous requirement, a contradiction between requirements, an example not pinned by any §4 requirement, or a §3 interface missing a type that §4 assumes.
- A bug was found in a surface an existing RFC specifies, and triage points at the RFC rather than the code. Two cases route here: the RFC specified the wrong behavior (the code faithfully implements it), or the code diverged from the RFC because a requirement was missing or too weak to catch the bug — the missing requirement is itself a gap to fill. A plain implementation bug, where a correct requirement was simply implemented wrong, is _not_ a revise-rfc task: fix the code and strengthen the test, and do not amend the RFC to match the broken behavior.
- The user wants to resolve (or record) open questions on an RFC.
- New work overlaps the surface of an existing `Ready` or `Implemented` RFC (redirected here by `create-rfc`).

Do not use this skill for:

- **New RFCs.** If the change is really a new surface rather than a change to an existing contract, use `create-rfc`. Rule of thumb: if the change would mostly add new sections rather than touch existing ones, it may deserve its own RFC with a `see_also` back-link — raise this with the user.
- **Architectural decisions** — those belong in a decision record, not an RFC.

## Workflow

### 1. Read the target RFC and the format rules

Read the RFC end-to-end, including its frontmatter status and any existing Amendments section. Read `../create-rfc/format-rules.md` — particularly "Status lifecycle and amendments" and the rules for the sections you'll touch (EARS and hierarchy for §4, interface augmentation for §3).

### 2. Capture the change and the reasoning

Establish with the user:

- **What** changes — which sections, what the new contract says.
- **Why** — what was learned (during review, implementation, demo, use) that motivates the change. For Ready and Implemented RFCs the reasoning is a required part of any amendment entry, so get it before editing, not after.

### 3. Branch on the RFC's status

#### Draft — revise freely

The contract is not yet stable; revision churn is the point of the Draft phase. No classification, and never an Amendments section — its absence is part of what `Draft` means.

- Edit directly, following the same format rules as authoring (EARS notation, hierarchy heuristics, invariant scoping, the `[future]` tag).
- Restructuring and renumbering are fine — section numbers only become anchors once the RFC is promoted to `Ready`. Still grep for stray citations of the RFC's sections if you renumber; early cross-references are rare but cheap to fix now.
- Open questions move in both directions: resolve them when the user decides, and _add_ to §7 when a revision uncovers a new unknown rather than guessing an answer into the body.

Apply the change per step 4 (the anchor-preservation rule there doesn't bind Drafts), skip step 5, and finish with steps 6–7.

#### Ready / Implemented — classify, then change

Every change is classified as a **direct edit** or an **amendment**:

| Status        | Direct edit                                                          | Amendment                                                                                                     |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Ready`       | Clarifies, narrows, or fills gaps without contradicting the contract | Contradicts the contract: removes commitments, changes the meaning of a behavior, substantially changes scope |
| `Implemented` | Pure documentation hygiene: typos, broken links, formatting          | Anything touching behavior, interface, or scope — even if it doesn't contradict the original                  |

The test for `Ready`: **would a reader of the original RFC be surprised by the change?** Gap-fills shouldn't surprise them; contradictions should. When the classification is genuinely borderline, state your reasoning and confirm with the user — an unnecessary amendment entry is noise, but a missing one silently breaks the Ready promotion's meaning.

### 4. Apply the change to the body

The body is the current contract — edit it so that it reads true on its own. The Amendments section is lineage, not a patch layer; never leave the body stale and describe the change only in an amendment entry.

While editing, follow the `create-rfc` format rules:

- New or changed §4 requirements use EARS notation with RFC 2119 keywords for secondary obligations.
- Changes to a §3 interface defined by a _prior_ RFC follow the interface-augmentation pattern (diff fences, "Members not listed above are unchanged" closer). Changes to this RFC's own interface are edited in place.
- If a change adds operations within the scope of an existing Invariants subsection, verify the invariant's scope statement still enumerates the right subsections.
- Moving something in or out of scope means updating §6 too, so the fences stay accurate.

**For Ready and Implemented RFCs, preserve section numbers — they are anchors.** PRs, tests, code comments, and other RFCs cite sections by number. Prefer appending new subsections at the end of their grouping over inserting mid-sequence. For a removed requirement, keep the number as a tombstone (e.g., `#### 4.3.2. Removed` with a one-line pointer to the amendment entry) rather than renumbering siblings. If renumbering is truly unavoidable, grep the repo for references to the affected RFC (`RFC-NNNN`, `§`) and update every citation in the same change.

### 5. Record the amendment (when classified as one)

Add or update the `## Amendments` section per the format in `../create-rfc/format-rules.md`: unnumbered, at the very end of the document, entries in reverse chronological order. Each entry is the current date (YYYY-MM-DD), a short description of what changed with section references, and the reasoning from step 2.

Do not add an Amendments section for direct edits — its presence is the signal that substantive changes exist.

### 6. Resolving open questions

To resolve a question: make the decision concrete in the body (interface, behavior, or out-of-scope entry as appropriate), then delete the question from §7 — and delete §7 entirely when it empties.

- **Draft**: resolve freely; this is the normal path toward `Ready`, which requires §7 to be empty.
- **Ready**: a nominally `Ready` RFC with unresolved §7 items is not actually consumable (implementation shouldn't start from it). Classify the resolution like any other change: one that fills a gap is a direct edit; one that contradicts the existing body is an amendment.

### 7. Surface downstream impact

After editing, check and report to the user:

- **Cross-RFC references**: grep `docs/rfcs/` and wherever the project records architectural decisions for citations of the changed sections. A change that invalidates another document's claim must be surfaced, not silently absorbed. (For Drafts this check is usually empty, but it's cheap.)
- **`see_also`**: if the change introduces a dependency on another RFC or ADR, add it.
- **Code and tests** (for `Implemented` RFCs, or `Ready` RFCs mid-implementation): an amended contract means the implementation no longer matches the spec. Locate the tests that cite the changed sections (`// RFC-NNNN §x.y.z` comments) and tell the user which ones the change affects. Bringing code in line is implementation work — whether resumed in the current implementation session or done as follow-up.

## Guardrails

- **Never change the `status` frontmatter.** Promotions and demotions are human decisions, in this skill as in `create-rfc`.
- **Never add `amends`, `amended_by`, `created`, or `updated` frontmatter fields.** Git tracks history; the format rules forbid these.
- **Never add an Amendments section to a Draft.** The section's presence signals substantive post-Ready change; a Draft with one is lying about its history.
- **One amendment entry per substantive change**, not one giant entry batching unrelated changes. Each entry should be independently understandable.
- **Don't re-litigate the design of Ready or Implemented RFCs.** This skill records a change the author has decided on (or that implementation has proven necessary). If the user is still exploring whether to change a stable contract, that's a design conversation to have before invoking the amendment machinery. Drafts are the opposite: exploration there is the work.
- **Don't amend an RFC to match buggy code.** If implementation diverged from the spec, the question is which one is right — surface it. Amendments record learning, not drift.

## Relationship to other skills

- **`create-rfc`** authors new RFCs and owns `format-rules.md`, the single source of truth for RFC formatting and the amendment rules this skill applies. The boundary on Drafts: `create-rfc` owns the initial authoring session; subsequent revision passes belong here. Both follow the same format rules, so the boundary is low-stakes. When a change is really a new surface, hand off there.
- **Recorded architectural decisions** (ADRs or equivalent) own durable decisions. If a change to an RFC reflects a reversal of one, the record needs updating too — flag it.
