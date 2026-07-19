---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.cjs"
---

# Export Naming

## Named over default

Always use named exports — never `export default`. Named exports are greppable, autocomplete predictably, and can't be silently renamed on import, unlike default exports.

## Name for the consumer, not the module

An exported symbol's name must carry its own context — readable from an import list, a grep result, or an autocomplete popup, without opening the file or tracing its import path.

- Avoid generic names such as `getState`, `subscribe`, `data`, `handle`, `process`, `Item`, or `Config` — they only make sense beside their defining module, reading fine inside the file that owns them but turning ambiguous or collision-prone once imported.
- Fold in the module's concept instead: `getDashboardState`/`subscribeToDashboardState`, not `getState`/`subscribe`; `parseContainerInfo`, not `parse`.
- Matters most for singletons, stores, and services — exactly where a generic name is most likely already taken elsewhere.

**Examples:**
```ts
// Bad — reads fine inside dashboardStore.ts, ambiguous everywhere it's imported
export function getState(): DashboardState { /* ... */ }
export function subscribe(listener: () => void): () => void { /* ... */ }

// Good — self-documenting at the call site, regardless of import path
export function getDashboardState(): DashboardState { /* ... */ }
export function subscribeToDashboardState(listener: () => void): () => void { /* ... */ }
```

**Why:** A default export can be renamed arbitrarily on import, losing any stable, greppable name. A generic named export has the same problem in disguise — the name is stable, but uninformative, so every call site still has to be traced back to its import path just to know what it refers to.
