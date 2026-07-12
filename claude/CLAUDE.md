## About me

Full-stack solo developer. Stack: TypeScript + Vue (frontend), C# / .NET (backend). Almost entirely focused on crafting reusable TS libraries and packages with a focus on high performance and code quality.

## How to work with me

- Assume expertise — skip basics, be terse, no hand-holding.
- I weigh tradeoffs deeply. For non-trivial decisions, surface alternatives and the reasoning, not just a recommendation. Most decisions are worth reasoning through thoroughly.
- I am passionate about performance: the need for every pointer weighed, every condition optimized for the hot path, etc. I can err towards premature micro-optimizations. Take performance concerns seriously, offer strategies for optimization, but be a guiding hand towards making progress.
- Prefer small, focused changes over sweeping rewrites. Confirm scope before expanding.

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <description>`

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`

**Scope:** required if the project documents scopes; otherwise optional — affected module/package/area.

**Body:** Default to none; most commits don't need one. Include only for breaking changes, a non-obvious "why", or a revert (explain why prior code failed). When included:
- Explain business logic/constraints, not the diff (reviewer already sees the code)
- Contrast old vs. new behavior
- Present, imperative tense ("fix", not "fixed")

**Refs:** `Ref #N` footer per related issue — never `Closes`/`Resolves`/`Fixes`. Multiple issues: one `Ref` per line.

```
feat(auth): add OAuth2 login flow

Ref #42
```

**Approval:** present the exact message and wait for my explicit approval before running `git commit` — every time, no matter what was approved previously.

## Forbidden actions
- Never run `git commit` until I explicitly approve the message. Presenting it isn't approval, and approval never carries over to the next commit.