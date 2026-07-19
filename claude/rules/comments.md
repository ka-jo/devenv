---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.cjs"
  - "**/*.cs"
---
# Comments

## Syntax

Use `//` for every non-doc comment, even ones spanning multiple lines. Reserve `/* */` for the rare case a comment must sit inline within a line of code and can't be extracted — and even then, prefer finding another means of making the context more self explanatory (e.g. pulling the value into a named constant) over adding an inline comment.

Doc comments (`/** */`) are covered separately in `doc-comments.md`.

## When to write one

A comment must pass two gates:

1. **Surprise test** — would a reader, seeing only the code, risk "fixing" it into something wrong, or wonder why the obvious alternative wasn't used? If the code just does the ordinary thing the ordinary way, skip the comment.
2. **Investigation-strip test** — cut any clause narrating how the fact was established ("verified," "confirmed," "tested," "turns out") rather than the fact itself. The comment should read the same whether written during initial design or found by accident years later. If nothing survives the cut, it was session narrative, not documentation.

## Example

```ts
// Explicit width is load-bearing: ink-select-input's own row wrapper has none, so
// without it here this Box sizes to its content instead of the sidebar's available
// space — one long-enough line and the whole row balloons past the sidebar's border.
<Box width={ROW_CONTENT_WIDTH}>
```

A lasting fact about a library's behavior, stated with no reference to how it was found — and no comment at all on the ordinary lines around it.

## Why

Comments outlive the session that wrote them, but their content often doesn't age the same way: prose describing an investigation ("verified," "confirmed") or an unsurprising choice reads as noise to a later reader who has no reason to expect otherwise, and it silently rots as the reason stops applying. Mixed `//`/`/* */` usage similarly costs a reader nothing individually but adds inconsistency with no offsetting benefit. Both gates exist to keep comments load-bearing — restating a fact about the system that would otherwise be lost — rather than a transcript of how the author got there.
