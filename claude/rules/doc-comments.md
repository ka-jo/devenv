---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.cjs"
---
# Documentation Comments

Use TSDoc (`/** */`) for all exported functions, classes, methods, type aliases, and public members.

## Core rule

A doc comment describes the **contract**: what the symbol does and how to call it correctly. It is written for the *consumer*, not the maintainer.

**How, not why**
Every doc comment should be written with the purpose of helping the _consumer_ use the code correctly . Implementaiton rationale, algorithm justification, and history belong in inline comments next to the code it explains, _not_ as doc comments.


- Summary is the first paragraph, no tag: present tense, one or two sentences, what it *does* not how.
- Never restate the TypeScript type in prose. Keep every part terse.
- `@remarks` is optional, for caller-relevant contract info only (side effects, invariants, reactivity/subscription behavior). Not for essays or rationale.

## Functions & methods

Order: summary → `@typeParam` → `@param` (every parameter) → `@returns` (unless `void`) → `@remarks`.

- `@param name - description` (hyphen required), one per parameter in signature order. Document *every* parameter; if there's nothing to add beyond the name, one short clause — do not pad.
- `@returns`: what the caller gets and when. For booleans, what `true` means; for nullable/unions, when each case occurs.

```typescript
/**
 * Resolves a binding expression against a view model and returns its
 * current value.
 *
 * @param expression - The parsed binding path. Must be well-formed;
 * malformed paths throw during parsing, not here.
 * @param viewModel - The source to resolve against. May be null, in
 * which case resolution short-circuits.
 * @returns The resolved value, or `undefined` if any path segment is
 * null or missing.
 *
 * @remarks
 * Resolution is shallow and does not subscribe to reactive dependencies;
 * call {@link track} first if you need change notification.
 */
```

## Classes

Order: summary → `@typeParam` → `@remarks`. Summary describes the type's role — don't enumerate methods (document those on the methods). Constructor params go on the **constructor**, not the class. Class-level `@remarks` covers contract info owned by no single member: lifecycle, when to subclass, ordering guarantees.

```typescript
/**
 * Tracks reactive dependencies accessed during a computation and
 * notifies subscribers when any of them change.
 *
 * @typeParam T - The value type produced by the tracked computation.
 *
 * @remarks
 * Single-use: once {@link dispose} is called it cannot be restarted.
 */
class Tracker<T> {
  /**
   * @param compute - The computation to run and track.
   * @param scheduler - Controls when notifications flush. Defaults to
   * synchronous flushing.
   */
  constructor(compute: () => T, scheduler?: Scheduler) { /* ... */ }
}
```

## Type aliases & interfaces

Order: Summary → `@typeParam` → per-member docs. Document each member with its own comment, same rules. Function-shaped members are documented like methods.

```typescript
/**
 * A parsed binding, ready to be resolved against a view model.
 *
 * @typeParam TValue - The type this binding resolves to.
 */
interface Binding<TValue> {
  /** The dotted source path, e.g. `user.name`. */
  path: string;

  /**
   * Whether resolution failures are silent instead of throwing.
   *
   * @defaultValue `false`
   */
  lenient?: boolean;
}
```

## Generics, optionals & defaults

- `@typeParam Name - description`, one per type parameter in declaration order. Describe what it *represents*; don't restate the `extends` constraint.
- Optional params: never write `(optional)` — the `?` already says it. Document a default at the end of the description as `Defaults to X.` (TSDoc has no param-default tag; prose is the convention).
- Property/field defaults use the `@defaultValue` block tag (class/interface members only), as shown in the interface example above.

## Private & internal symbols

Audience is the maintainer, so document *motivation*, not contract.

- One-line summary: what it is and, where non-obvious, why it exists.
- No full `@param`/`@returns`/`@typeParam` blocks — the signature is the contract.
- Add a tag only for a real gotcha (invariant, footgun, ordering dependency).

```typescript
/** Memoizes resolved paths so repeated resolution avoids re-parsing. */
private readonly pathCache = new Map<string, ResolvedPath>();

/**
 * Flushes pending notifications. Separated from `notify` so the scheduler
 * can batch calls — do not invoke directly during a computation.
 */
private flush(): void { /* ... */ }
```

## Cross-references

Use `{@link Symbol}` (or `{@link Symbol | label}`) wherever a comment names another symbol in the codebase. Bare names produce dead references and are a lint failure. External types (`HTMLElement`, `Map`) are exempt.

## Anti-pattern

**Bad** — rationale buried in the doc comment, obscuring the contract:

```typescript
/**
 * Resolves a binding. Was recursive but that blew the stack on deep
 * paths so it's iterative now; cache is full-expression-keyed because
 * per-segment caused stale reads. Returns the value.
 * @param expression - the expression
 */
```

**Good** — contract in the doc comment, rationale inline where the code is:

```typescript
/**
 * Resolves a binding expression against a view model and returns its
 * current value.
 *
 * @param expression - The parsed binding path. Must be well-formed.
 * @returns The resolved value, or `undefined` if any segment is missing.
 */
function resolve(expression: BindingPath, viewModel: object | null): unknown {
  // Iterative, not recursive: deep paths overflowed the stack.
  // Cache is keyed on the full expression — per-segment caused stale
  // reads when the view model mutated mid-resolution.
  // ...
}
```

