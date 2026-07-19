---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript Rules

## Type Safety
- Treat `any` as a code smell — reach for a proper type, generic, or conditional type first. Use `any` only when the type is genuinely unknowable (e.g. highly dynamic generic plumbing, interop boundaries in library code) and alternatives like `unknown`, a generic parameter, or `never` do not work.
- Treat `as` as a code smell — it is sometimes necessary, but exercise a strong preference to avoid. When it cannot be avoided, it should be the narrowest cast possible.
- Never use non-null assertion (`!`) unless the null case is structurally impossible and a comment explains why.
- Do not use `// @ts-ignore`. Instead use `// @ts-expect-error` with a comment explaining the suppression.

## Explicit Declarations
- All functions and methods must have explicit return types.
- All class members must have explicit access modifiers (`public`, `private`, `protected`).
- Avoid implicit `any` from untyped function parameters.

## Patterns to Avoid
- Do not use `Function` or `Object` as types — use specific signatures or `Record<>`.
- Avoid overloaded functions when a union type or generic achieves the same result more clearly.
- Do not use loose equality (`==`, `!=`) — always use strict equality (`===`, `!==`).
- Do not use `var`.

## Style
- Use `interface` for object shapes that may be extended; use `type` for unions, intersections, and aliases.
- Prefer `readonly` on properties that should not be mutated after construction.
- Type only imports should be clearly marked with `type` — it is ok to mix type imports with standard imports.
- Strongly prefer named exports over default exports.
- Default to using `const` — `let` should only be used when reassignment is necessary.
- Use optional chaining (`?.`) and nullish coalescing (`??`) instead of manual null checks unless a null value triggers other behavior.

Doc comment rules live in [doc-comments.md](doc-comments.md).
