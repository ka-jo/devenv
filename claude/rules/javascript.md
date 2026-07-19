---
paths:
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.cjs"
---

# JavaScript Rules

## General
- Prefer TypeScript for new files. Only write plain JavaScript when working in an existing `.js` file or a config context that does not support TypeScript (e.g. `vite.config.js`, `.eslintrc.js`).

## Patterns to Avoid
- Do not use `var` — use `const` by default, `let` only when reassignment is required.
- Do not use `arguments` — use rest parameters (`...args`).
- Do not mutate function parameters.
- Do not use loose equality (`==`, `!=`) — always use strict equality (`===`, `!==`).
- Do not use `with`.
- Avoid `eval` and `Function()` constructor.

## Style
- Use `const` for all values that are never reassigned, including objects and arrays (mutating their contents is fine; reassigning the binding is not).
- Prefer named exports over default exports.
- Use optional chaining (`?.`) and nullish coalescing (`??`) instead of manual null checks unless other behavior is triggered on a null value.

Doc comment rules live in [doc-comments.md](doc-comments.md).
