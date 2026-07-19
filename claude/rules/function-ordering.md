---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.cs"
---

# Function Ordering: The Step-Down Rule

Order functions top-down by level of abstraction: a caller appears above the callees it depends on, and a file reads like a narrative — high-level policy first, low-level detail last.

- The first function in a file/class should be the highest-level entry point (the one most likely called from outside, or the one orchestrating the others).
- Each function is followed by the functions it calls, in the order it calls them, before descending another level.
- Don't sort alphabetically, by visibility (public/private), or by chronological order added — those orderings optimize for finding a name, not for reading the logic.
- A reader should be able to read top-to-bottom and encounter each helper right after (not before) the code that depends on it, never needing to jump forward to understand what a call does.

**Example:**
```ts
function processOrder(order: Order): Receipt {
  validateOrder(order);
  const total = calculateTotal(order);
  return issueReceipt(order, total);
}

function validateOrder(order: Order): void { /* ... */ }

function calculateTotal(order: Order): number {
  return order.items.reduce((sum, item) => sum + priceOf(item), 0);
}

function priceOf(item: OrderItem): number { /* ... */ }

function issueReceipt(order: Order, total: number): Receipt { /* ... */ }
```

**Why:** Originally from Robert Martin's *Clean Code*. A file organized this way is readable in one pass, top to bottom, like a newspaper article moving from headline to detail — no jumping back and forth to reconstruct the call graph.
