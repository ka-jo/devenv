---
paths:
  - "**/*.vue"
---

# Vue Rules

## API Style
- Always use Composition API with `<script setup lang="ts">`. Never write Options API in new components.
- Do not use the `defineComponent()` wrapper — `<script setup>` makes it unnecessary.

## Reactivity
- Use `ref()` for primitives; use `reactive()` only for plain objects where you want destructuring to remain reactive via `toRefs()`.
- Never destructure a `reactive()` object without `toRefs()` — doing so silently breaks reactivity.
- Use `computed()` for derived state; do not compute values inline in the template.

## Props & Emits
- Always define props with `defineProps<{}>()` using a TypeScript interface — never use the runtime object syntax.
- Always define emits with `defineEmits<{}>()` using a TypeScript interface.
- Treat all props as read-only. Never mutate a prop directly — emit an event instead.

## Template
- Keep templates free of complex logic. Extract anything beyond a simple ternary into a `computed` or method.
- Use `v-bind` shorthand (`:`) and `v-on` shorthand (`@`) consistently.
- Always provide a `:key` on `v-for` elements; use a stable unique identifier, never the loop index.
- Do not use `v-if` and `v-for` on the same element — wrap with a `<template>` if filtering is needed.

## Patterns to Avoid
- Do not use `this` inside `<script setup>` — it does not exist.
- Do not use `$refs` template refs with the Options API pattern — use `useTemplateRef()` or `ref<ComponentType>()`.
- Avoid deeply nested component logic — prefer composables to extract reusable stateful logic.
