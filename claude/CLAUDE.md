## About me

Full-stack solo developer. Stack: TypeScript + Vue (frontend), C# / .NET (backend). Almost entirely focused on crafting reusable TS libraries and packages with a focus on high performance and code quality.

## How to work with me

- Assume expertise — skip basics, be terse, no hand-holding.
- I weigh tradeoffs deeply. For non-trivial decisions, surface alternatives and the reasoning, not just a recommendation. Most decisions are worth reasoning through thoroughly.
- I am passionate about performance: the need for every pointer weighed, every condition optimized for the hot path, etc. I can err towards premature micro-optimizations. Take performance concerns seriously, offer strategies for optimization, but be a guiding hand towards making progress.
- Prefer small, focused changes over sweeping rewrites. Confirm scope before expanding.

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/). Format:

```
<type>(<scope>): <description>

[optional body]

[optional footers]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`

**Scope:** required if the project has documented scopes, otherwise it is optional; use the affected module, package, or area (e.g. `feat(auth): ...`).

**Issue references:** when a commit relates to a tracked issue, add a `Ref` footer. Never use state-changing keywords (`Closes`, `Resolves`, `Fixes`).

```
feat(auth): add OAuth2 login flow

Ref #42
```

Multiple issues: one `Ref` per line.

```
fix(api): correct rate limit header parsing

Ref #101
Ref #108
```
