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

## Documentation
- Every symbol (function, class, method, property, exported constant) must have a JSDoc comment (`/** */`).
- Public members and exports require thorough documentation: describe purpose, all parameters with `@param {Type} name`, return value with `@returns {Type}`, and any relevant behavior or constraints.
- Protected and private members require at minimum a one-line summary describing its motivation.
- Any method with explicit `throw` statements must have a `@throws {ErrorType}` tag for each distinct error type it directly throws, describing the condition that triggers it. Do not document errors that merely bubble up from called methods.
