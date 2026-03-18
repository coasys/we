# Framework Declarations Generator: Improvements

Harden `generate-framework-declarations.ts` so each supported framework gets **idiomatic, accurate type declarations** instead of the current one-size-fits-all prop list. Also expand CEM coverage to include events and improve custom-type detection robustness.

## Status

| Task                                                          | Status      |
| ------------------------------------------------------------- | ----------- |
| T1 — Framework-aware standard props                           | Not started |
| T2 — Derive Solid `prop:` entries from actual component props | Not started |
| T3 — Robust custom-type detection                             | Not started |
| T4 — Extract events from CEM                                  | Not started |
| T5 — Auto-generated file header                               | Not started |
| T6 — Use CEM declaration name instead of filename             | Not started |
| T7 — Svelte 5 compatibility                                   | Not started |
| T8 — Remove unnecessary `extends` + default export            | Not started |

---

## Problem Statement

The script reads `custom-elements.json` (CEM) and generates per-framework `.d.ts` files so consumers get autocomplete for `<we-button>` etc. in their framework of choice. The **architecture is sound** — CEM as single source of truth, parallel I/O, inline `import()` types — but several framework-specific details are incorrect or missing.

### Current issues

1. **Standard props are framework-agnostic.** `ref`, `style`, `class`, `children` are emitted identically for every framework, but:
   - React needs `className` (not `class`), `React.CSSProperties` (not `Record<string, any>`), `React.Ref<HTMLElement>` (not `HTMLElement`), `React.ReactNode` (not `any`)
   - Solid needs `JSX.Element` for children and `class` is correct
   - Svelte doesn't use `ref` at all — it has `bind:this`

2. **Solid `prop:` accessors are hardcoded for all components** regardless of whether the component actually accepts `hoverProps` / `activeProps` / `focusProps` / `disabledProps`.

3. **Custom-type detection** only matches exact primitive names (`string`, `boolean`, `number`, `any`). Inline unions (`'primary' | 'secondary'`), array types (`string[]`), generics, `undefined`, `null` would all be misidentified as importable custom types.

4. **No event declarations.** The CEM supports `events` on declarations but the script ignores them entirely. Consumers can't get typed `onButtonClick` (React) or `on:button-click` (Svelte).

5. **No auto-generated header** — output files lack a `// DO NOT EDIT` warning, inviting manual edits that will be overwritten.

6. **`className` derived from filename** (`path.basename(module.path, '.ts')`) rather than the CEM declaration `name` field.

7. **Svelte `svelteHTML` namespace** targets Svelte 3/4; Svelte 5 uses a different typing approach.

8. **React `extends React.JSX.IntrinsicElements`** is unnecessary — TypeScript declaration merging handles interface augmentation automatically.

9. **`export default generateFrameworkDeclarations`** on a self-invoking script is misleading.

---

## T1 — Framework-Aware Standard Props

**Goal:** Emit correct standard props per framework instead of a single hardcoded list.

**Changes:**

`scripts/generate-framework-declarations.ts` — replace the hardcoded standard-props block in `generateComponentProps` with a framework-dispatched helper:

```ts
function getStandardProps(framework?: Framework): string[] {
  const base = [
    `${indent(4)}slot?: string | number;`,
    `${indent(4)}id?: string;`,
    `${indent(4)}style?: Record<string, any>;`,
  ];

  const reactLike = framework?.name.startsWith('react');

  if (reactLike) {
    return [
      `${indent(4)}key?: string | number;`,
      `${indent(4)}ref?: React.Ref<HTMLElement>;`,
      ...base,
      `${indent(4)}className?: string;`,
      `${indent(4)}style?: React.CSSProperties;`,
      `${indent(4)}children?: React.ReactNode;`,
    ];
  }

  if (framework?.name === 'solid') {
    return [...base, `${indent(4)}class?: string;`, `${indent(4)}children?: JSX.Element;`];
  }

  if (framework?.name === 'svelte') {
    return [...base, `${indent(4)}class?: string;`, `${indent(4)}children?: any;`];
  }

  // Global / fallback
  return [
    `${indent(4)}key?: string | number;`,
    `${indent(4)}ref?: HTMLElement;`,
    ...base,
    `${indent(4)}class?: string;`,
    `${indent(4)}children?: any;`,
  ];
}
```

Remove the current hardcoded block:

```ts
// Remove these lines:
`${indent(4)}key?: string | number;`,
`${indent(4)}ref?: HTMLElement;`,
`${indent(4)}slot?: string | number;`,
`${indent(4)}id?: string;`,
`${indent(4)}class?: string;`,
`${indent(4)}style?: Record<string, any>;`,
`${indent(4)}styles?: Record<string, any>;`,
`${indent(4)}children?: any;`,
```

And replace with:

```ts
...getStandardProps(framework),
// `styles` is a component-specific prop (design-system override object), keep it universal
`${indent(4)}styles?: Record<string, any>;`,
```

**Validation:** Rebuild and diff the output files. Global declarations should be unchanged. React declarations should now have `className`, `React.CSSProperties`, `React.Ref<HTMLElement>`, `React.ReactNode`. Solid should have `JSX.Element` children.

---

## T2 — Derive Solid `prop:` Entries from Actual Component Props

**Goal:** Only emit `prop:hoverProps` etc. when the component actually declares those properties.

**Changes:**

Replace the hardcoded Solid block in `generateComponentProps`:

```ts
// Before (hardcoded for all components):
...(framework?.name === 'solid'
  ? [
      `${indent(4)}'prop:hoverProps'?: Record<string, any>;`,
      `${indent(4)}'prop:activeProps'?: Record<string, any>;`,
      `${indent(4)}'prop:focusProps'?: Record<string, any>;`,
      `${indent(4)}'prop:disabledProps'?: Record<string, any>;`,
    ]
  : []),

// After (derived from actual properties):
...(framework?.name === 'solid'
  ? Object.keys(component.properties)
      .filter((name) => name.endsWith('Props'))
      .map((name) => `${indent(4)}'prop:${name}'?: ${component.properties[name].type};`)
  : []),
```

**Validation:** After rebuild, `we-spinner` (no state props) should have zero `prop:` entries. `we-button` (has state props) should still have them.

---

## T3 — Robust Custom-Type Detection

**Goal:** Avoid wrapping inline unions, arrays, or other non-importable types in `import()`.

**Changes:**

Replace the basic-type check:

```ts
// Before:
const isBasicType = ['string', 'boolean', 'number', 'any'].includes(typeName);

// After:
function isInlineType(typeName: string): boolean {
  // Primitives and builtins
  const primitives = ['string', 'boolean', 'number', 'any', 'undefined', 'null', 'void', 'never', 'unknown', 'object'];
  if (primitives.includes(typeName)) return true;
  // Literal unions: 'primary' | 'secondary'
  if (typeName.includes("'") || typeName.includes('"')) return true;
  // Array types: string[], Array<string>
  if (typeName.includes('[]') || typeName.startsWith('Array<')) return true;
  // Generic types with angle brackets: Record<string, any>, Map<K,V>
  if (typeName.includes('<')) return true;
  // Union/intersection types that aren't simple named types
  if (typeName.includes('|') || typeName.includes('&')) return true;
  // Function types
  if (typeName.includes('=>')) return true;
  return false;
}
```

Then use `isInlineType` instead of `isBasicType` when deciding whether to wrap in `import()`.

**Validation:** Add a few inline test assertions or a small test file that calls `isInlineType` with edge cases: `"'primary' | 'secondary'"`, `"string[]"`, `"Record<string, any>"`, `"BadgeVariant"` (should return false → gets imported).

---

## T4 — Extract Events from CEM

**Goal:** Generate typed event props so React consumers get `onButtonClick`, Svelte gets `on:button-click`, etc.

**Changes:**

1. Extend the `CustomElementsManifest` interface to include events:

```ts
// Add to declaration type:
events?: Array<{
  name: string;
  type?: { text?: string };
  description?: string;
}>;
```

2. Add an `events` field to the `Component` interface:

```ts
interface ComponentEvent {
  name: string; // e.g. 'button-click'
  type: string; // e.g. 'CustomEvent'
}

interface Component {
  // ... existing fields
  events: ComponentEvent[];
}
```

3. Extract events in `extractComponentsFromCustomElementsManifest`.

4. In `generateComponentProps`, append event props based on framework:

```ts
// React: camelCase `on` prefix
// 'button-click' → onButtonClick?: (event: CustomEvent) => void;

// Svelte: 'on:button-click' attribute
// 'button-click' → 'on:button-click'?: (event: CustomEvent) => void;

// Solid: 'on:button-click' or 'oncapture:button-click'
// Similar to Svelte pattern

// Global: addEventListener-style, add as comment or skip
```

**Validation:** `we-button` fires `button-click`. After rebuild, the React declaration should include `onButtonClick?: (event: CustomEvent) => void;`. Svelte should include `'on:button-click'`.

---

## T5 — Auto-Generated File Header

**Goal:** Prevent accidental manual editing of generated files.

**Changes:**

Add a constant and prepend it to every output file:

```ts
const AUTO_GENERATED_HEADER = [
  '// This file is auto-generated by generate-framework-declarations.ts',
  '// Do not edit manually. Changes will be overwritten on next build.',
  '',
].join('\n');
```

Prepend `AUTO_GENERATED_HEADER` in both `generateComponentDeclaration` and `generateFrameworkIndexFile` before writing.

**Validation:** All generated `.d.ts` files should start with the header comment.

---

## T6 — Use CEM Declaration Name Instead of Filename

**Goal:** Derive `className` (used for output filenames) from the CEM declaration's `name` field rather than `path.basename(module.path)`.

**Changes:**

```ts
// Before:
const baseName = module.path ? path.basename(module.path, '.ts') : '';
// ...
className: baseName,

// After — use the CEM tagName (strip prefix, already unique):
className: declaration.tagName!.replace('we-', ''),
```

This ensures output filenames always match the tag name, even if the source file is renamed or the CEM config changes module paths.

**Validation:** Output filenames should be unchanged (they already happen to match), but the derivation is now robust.

---

## T7 — Svelte 5 Compatibility

**Goal:** Support Svelte 5's typing approach alongside the existing Svelte 3/4 `svelteHTML` namespace.

**Changes:**

Add a `svelte5` framework entry that uses Svelte 5's module augmentation pattern:

```ts
// In FRAMEWORKS:
svelte: [
  { name: 'svelte', namespace: 'svelteHTML' },           // Svelte 3/4
  { name: 'svelte5', moduleName: 'svelte/elements' },    // Svelte 5
],
```

Update `package.json` exports to include a `./svelte5` entry pointing to the new declarations.

**Note:** This can wait until consumers actually adopt Svelte 5. Flag for future work if not needed now.

**Validation:** If implemented, import `@we/primitives/svelte5` in a Svelte 5 project and verify autocomplete works.

---

## T8 — Remove Unnecessary `extends` + Default Export

**Goal:** Clean up two minor issues.

**Changes:**

1. In `buildDeclarationContent`, remove `extends React.JSX.IntrinsicElements` from the React interface — TypeScript's declaration merging handles this automatically.

2. Remove the `export default generateFrameworkDeclarations;` at the bottom of the script — it's a self-invoking script, not a library.

**Validation:** Rebuild and verify React declarations still work correctly via `tsc --noEmit` in a consuming package. The `extends` removal should be transparent.

---

## Implementation Order

```
T5 (header)  ──┐
T6 (className) ─┤── Low-risk, mechanical changes. Do first.
T8 (cleanup)  ──┘
       │
T3 (type detection) ── Prerequisite for T4 (needs to handle event types correctly)
       │
T1 (standard props) ── Biggest user-facing improvement
       │
T2 (solid prop:) ── Small but correctness-important
       │
T4 (events) ── Largest new feature, do last
       │
T7 (svelte 5) ── Optional / deferred
```
