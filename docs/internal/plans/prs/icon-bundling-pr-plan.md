# PR Plan: Eliminate icon flash by bundling used Phosphor SVGs

## Problem

`we-icon` fetches SVGs from the Phosphor CDN on first use. Until the fetch resolves, the component renders an empty `<span>` with no dimensions, causing a layout shift (flash/jiggle) as the SVG pops in.

## Goals

1. **Zero layout shift** — icons never cause a reflow, even on first render
2. **Minimal bundle impact** — only icons actually referenced get bundled
3. **No new consumer dependencies** — `@phosphor-icons/core` stays internal to the build
4. **CDN fallback preserved** — dynamic/unknown icon names still load at runtime

---

## Part 1: Immediate layout-shift fix (loading placeholder sizing)

**File:** `packages/design-system/3-primitives/src/primitives/icon.ts`

Give the loading and error `<span>` placeholders explicit dimensions matching `--icon-size` so the element reserves the correct space before the SVG arrives.

```ts
// Before
if (!this.svg) return html`<span role="img" aria-label="icon loading"></span>`;

// After
if (!this.svg) return html`<span role="img" aria-label="icon loading"
  style="display:inline-block;width:var(--icon-size);height:var(--icon-size)"></span>`;
```

Same treatment for the error state span.

**Why split this out:** It's a 2-line fix that eliminates the jiggle immediately, independent of the bundling work. Can ship as its own commit or even its own PR.

---

## Part 2: Build-time icon bundling

### 2a. Icon extraction script

**New file:** `packages/design-system/3-primitives/scripts/collect-icons.ts`

A Node script that:

1. Scans source files (schemas, components, templates) for `we-icon` `name` values via AST or regex
   - JSON schemas: look for `{ "type": "we-icon", "props": { "name": "..." } }`
   - Lit templates: look for `<we-icon name="...">`
   - Include all `weight` variants found (default to `regular` when omitted)
2. Reads matching SVGs from the installed `@phosphor-icons/core` package (`node_modules/@phosphor-icons/core/assets/{weight}/{name}.svg`)
3. Sanitizes each SVG (reuse or call the existing `sanitizeSvg` logic)
4. Emits a generated JS module:

```ts
// packages/design-system/3-primitives/src/generated/icon-bundle.ts  (gitignored)
export const bundledIcons: Record<string, string> = {
  "gear:regular": '<svg xmlns="http://www.w3.org/2000/svg" ...>...</svg>',
  "x:regular": '<svg ...>...</svg>',
  "arrow-left:bold": '<svg ...>...</svg>',
  // ...only icons found in the codebase
};
```

**Scan targets** (configurable, but good defaults):
- `packages/app-framework/src/**/*.{ts,tsx,schema.ts}`
- `packages/design-system/**/src/**/*.ts`
- `apps/**/src/**/*.{ts,tsx}`
- `views/**/*.{ts,tsx,schema.ts}`

### 2b. Auto-registering resolver

**New file:** `packages/design-system/3-primitives/src/icons/register-bundled-icons.ts`

```ts
import { setIconResolver } from '../primitives/icon';
import { bundledIcons } from '../generated/icon-bundle';

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2.1.1/assets';

export function registerBundledIcons() {
  setIconResolver((name, weight) => {
    const key = `${name}:${weight}`;
    if (key in bundledIcons) return bundledIcons[key]; // sync string
    // Fallback to CDN for unknown icons
    const fileName = weight === 'regular' ? name : `${name}-${weight}`;
    return `${CDN_BASE}/${weight}/${fileName}.svg`;
  });
}
```

### 2c. Sync-path optimisation in `we-icon`

**File:** `packages/design-system/3-primitives/src/primitives/icon.ts`

Currently `loadIcon()` is `async` and always awaits the cache promise, so even a synchronous resolver result causes a microtask delay (one-frame flash). Change the cache to support resolved values:

```ts
// Change cache type to hold either a resolved string or a pending promise
const svgCache = new Map<string, string | Promise<string>>();

private loadIcon() {
  if (!this.name) return;
  const cacheKey = `${this.name}:${this.weight}`;

  if (!svgCache.has(cacheKey)) {
    const result = this.fetchIcon();
    // If fetchIcon returned a string synchronously (bundled icon), store it directly
    svgCache.set(cacheKey, result);
  }

  const cached = svgCache.get(cacheKey)!;
  if (typeof cached === 'string') {
    // Synchronous hit — no flash at all
    this.svg = cached;
  } else {
    // Async path — CDN fallback
    cached
      .then((svg) => { this.svg = svg; })
      .catch(() => {
        console.warn(`Failed to load icon "${this.name}"`);
        this.error = true;
      });
  }
}

private fetchIcon(): string | Promise<string> {
  if (iconResolver) {
    const result = iconResolver(this.name, this.weight);
    if (typeof result === 'string') {
      // Resolver returned synchronously (bundled)
      return result.trim().startsWith('<') ? sanitizeSvg(result) : this.fetchUrl(result);
    }
    // Resolver returned a promise
    return result.then((r) =>
      r.trim().startsWith('<') ? sanitizeSvg(r) : this.fetchUrl(r)
    );
  }
  return this.fetchUrl(this.buildCdnUrl());
}

private async fetchUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch icon "${this.name}"`);
  return sanitizeSvg(await response.text());
}

private buildCdnUrl(): string {
  const baseUrl = 'https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2.1.1/assets';
  const fileName = this.weight === 'regular' ? this.name : `${this.name}-${this.weight}`;
  return `${baseUrl}/${this.weight}/${fileName}.svg`;
}
```

### 2d. Build integration

**File:** `packages/design-system/3-primitives/package.json`

Add a `build:icons` script that runs the collection before the main build:

```json
{
  "scripts": {
    "build:icons": "tsx scripts/collect-icons.ts",
    "build:steps": "pnpm build:icons && pnpm build:cem && tsup",
  }
}
```

Add the generated file to `.gitignore`:
```
packages/design-system/3-primitives/src/generated/
```

### 2e. App bootstrap

**File:** `apps/we-electron/src/index.tsx` (and any other app entry points)

Call `registerBundledIcons()` at startup, before any UI renders:

```ts
import { registerBundledIcons } from '@we/primitives/icons';
registerBundledIcons();
```

Alternatively, auto-register via a side-effect import so consumers don't need to remember:

```ts
// 3-primitives/src/index.ts — add at top
import './icons/register-bundled-icons';
```

This would mean all consumers get bundled icons automatically. Tradeoff: slightly less control, but simpler DX. **Recommend the auto-register approach** since every consumer wants this.

---

## Part 3: Dev-mode convenience

During development (`pnpm dev`), the icon bundle may be stale if new icons were added. Options:

- **Option A (simple):** Devs run `pnpm build:icons` manually when they add new icon names. New icons silently fall back to CDN until the next build, so nothing breaks — just a flash for the new icon during dev.
- **Option B (nice-to-have):** A Vite/tsup plugin that watches for `we-icon` name changes and regenerates the bundle. More complex, likely not worth it for v1.

**Recommend Option A** — the CDN fallback means dev experience is never broken, just slightly degraded for brand-new icons.

---

## Commit plan

| # | Scope | Description |
|---|-------|-------------|
| 1 | `we-icon` placeholder sizing | Give loading/error spans explicit `width`/`height` via `--icon-size` |
| 2 | Icon collection script | `scripts/collect-icons.ts` — scans codebase, reads from `@phosphor-icons/core`, emits `icon-bundle.ts` |
| 3 | Sync-path in `we-icon` | Refactor `loadIcon`/`fetchIcon` to support synchronous resolver returns without microtask delay |
| 4 | Auto-register resolver | `register-bundled-icons.ts` + import from `index.ts` |
| 5 | Build integration | Wire `build:icons` into the build pipeline, `.gitignore` the generated file |

---

## Bundle size estimate

- Average Phosphor SVG: ~300–500 bytes (they're well-optimised single-path icons)
- Typical app uses 30–60 unique icons → **~15–30 KB uncompressed, ~5–10 KB gzipped**
- This replaces 30–60 network requests on cold load

---

## Edge cases

- **Dynamic icon names** (e.g. `name` bound to a variable from data): These won't be found by static analysis. They fall back to CDN — same as today. No regression.
- **`setIconResolver` called by consumer:** The auto-registered bundled resolver gets replaced. Consumer takes full control. Works as designed.
- **Icon used in schema but not in any scanned file:** Schema files are included in the scan targets, so this shouldn't happen. If it does, CDN fallback handles it.
- **Weight variants:** The scan must capture both `name` and `weight`. If weight is omitted (most common case), default to `regular`. Bundle each `name:weight` pair found.

---

## Testing

- Unit test: `loadIcon` returns synchronously for bundled icons (no `await` tick)
- Unit test: `loadIcon` falls back to CDN fetch for unbundled icons
- Unit test: placeholder span has correct dimensions during loading
- Visual regression: side-by-side before/after showing no layout shift on page load
- Build test: `collect-icons.ts` produces valid output for the current codebase
