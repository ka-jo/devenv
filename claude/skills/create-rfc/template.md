# RFC Template

Copy this scaffold for every new RFC. Replace bracketed placeholders. Delete sections that are genuinely empty (e.g., remove `## Open questions` entirely if there are none) — empty sections are noise.

````markdown
---
rfc: NNNN
title: [Short, specific title]
status: Draft
see_also:
  - RFC-XXXX
  - ADR-XXXX
---

# RFC NNNN: [Title]

## 1. Summary

One paragraph. What this RFC specifies, at the level someone unfamiliar with the work would need to understand the scope.

## 2. Motivation

Why this work exists. What problem it solves. What constraints it operates under. Link to the recorded architectural decisions (ADRs or equivalent) this RFC inherits.

When describing behavior that this RFC changes, use past tense: "Prior to this RFC, X did Y." This ensures the RFC remains a description of the current system even after implementation. See `format-rules.md` § "Tense and temporal framing."

## 3. Interface

Type definitions, function signatures, schemas. One subsection per type or class. Order: data types first, then error types, then the service/interface types that consume them.

### 3.1. [TypeName]

```typescript
// type definition
```

### 3.2. [TypeName]

```typescript
// type definition
```

## 4. Behavior

The behavioral contract. EARS-formatted requirements grouped hierarchically. Name each requirement's subject after the §3 element that owns the behavior (e.g., `UserService` SHALL …); reserve `THE SYSTEM` for whole-feature behavior that no single §3 element owns. See `format-rules.md` for guidance on hierarchy, EARS, Invariants, and subject naming.

### 4.1. Invariants

Optional. When present, Invariants is the first subsection within its parent grouping (here, §4 itself). Can also appear inside any deeper grouping (e.g., `§4.2.1 Invariants` for invariants that apply only within §4.2). Omit entirely if no invariants apply.

These requirements apply to every operation described in §4.2 [and §4.3, etc.].

#### 4.1.1. [Invariant name]

WHEN [condition] THE SYSTEM SHALL [response].

### 4.2. [Operation group]

#### 4.2.1. [Specific operation]

WHEN [condition] [§3 subject] SHALL [response].

IF [unwanted condition] THEN [§3 subject] SHALL [response].

## 5. Examples

Concrete input/output pairs. One subsection per scenario when there are several.

### 5.1. [Scenario name]

Input: ...
Output: ...

## 6. Out of scope

Bulleted list of things this RFC deliberately does not address. See `format-rules.md` for the `[future]` tag convention when an item is deferred-but-design-influencing.

- [Thing not addressed]. [Brief reason.]
- [Thing not addressed] [future]. [Reason and how the current design accommodates it.]

## 7. Open questions

Things to resolve before this RFC can be promoted to `Ready`. Delete this section entirely if there are none.

- [Question that needs resolution]
````

A new RFC has no Amendments section. The section is added at the very end of the document (after §7) when the first amendment lands. See `format-rules.md` for the amendment process.
