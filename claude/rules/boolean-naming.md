---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Naming Conventions for Boolean Variables, Properties, and Functions

Boolean variables, properties, and functions returning boolean values must use a predicate naming convention:

- **Use `isX`, `hasX`, `canX`, `shouldX`, `willX`, `wasX`** prefixes to clearly signal a boolean value.
- Prefer `isX` as the default unless another prefix better expresses the semantic intent:
  - `isLoading`, `isDisabled`, `isValid`, `isEmpty` — state of the subject
  - `hasError`, `hasChildren`, `hasPermission` — presence of something
  - `canSubmit`, `canDelete` — capability or permission
  - `shouldRetry`, `shouldCache` — decision or recommendation
  - `willChange` — future state prediction (rare)
  - `wasModified` — past state (rare; prefer `isModified` for current state)

**Examples:**
```ts
const isVisible = true;
const hasError = false;
const canDelete = user.role === 'admin';

interface Config {
  isEnabled: boolean;
  hasValidation: boolean;
}

function isReady(): boolean { return true; }
function hasPermission(action: string): boolean { return true; }
```

**Why:** Predicate prefixes make boolean intent unambiguous at the call site, reducing cognitive load and preventing bugs from treating booleans as properties or counts.
