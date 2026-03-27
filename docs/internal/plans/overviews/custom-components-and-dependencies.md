# Plan: Custom Components, npm Dependencies & Browser APIs

> How external code integrates with WE's schema system — the boundary between declarative JSON and executable JavaScript, and why npm packages must be bundled into components rather than referenced from schemas.

---

## The Boundary

WE has two distinct layers with different rules:

| Layer                 | Format                  | Can import npm packages? | Can use browser APIs? | Trust model                        |
| --------------------- | ----------------------- | ------------------------ | --------------------- | ---------------------------------- |
| **Schema**            | JSON                    | No                       | No                    | Inert — safe to share freely       |
| **Component / Store** | JavaScript (ESM bundle) | Yes (bundled in)         | Yes (full access)     | Executable — requires user consent |

Schemas reference components by **name**. The component registry maps names to implementations. Everything about how an implementation works — including which npm packages it uses, which browser APIs it calls — is invisible to the schema.

```
Schema JSON                          Component Registry                Implementation
─────────────                        ──────────────────                ──────────────
{ "type": "ChartWidget" }    →    resolveComponent("ChartWidget")  →  SolidJS component
{ "props": {                                                           - imports chart.js
    "data": { "$query": ... }                                          - uses <canvas>
  }                                                                    - calls ResizeObserver
}
```

---

## Why Schemas Can't Reference npm Packages

If schemas could declare `"import": "chart.js@4.2.0"`, every render would need:

1. **Runtime resolution** — which version? Which CDN? What if it's offline?
2. **Transitive dependencies** — `chart.js` pulls in other packages, which pull in others
3. **Build step in the browser** — bare specifiers (`"chart.js"`) don't work in `import()` without a bundler or import map
4. **Version conflicts** — schema A needs `lodash@4`, schema B needs `lodash@3`, both render on the same page
5. **Security opacity** — no way to inspect or consent to what code will execute before it runs
6. **Network dependency** — first render requires fetching packages; offline use breaks

None of these problems exist when schemas stay as pure JSON referencing named components.

---

## How npm Packages Get Into WE

### For core components (ship with WE)

Standard monorepo development. Packages are in `package.json`, imported normally, bundled by Vite at build time. Nothing unusual:

```typescript
// Inside @we/components — this is normal SolidJS code
import { Chart } from 'chart.js';

export function ChartWidget(props: { data: DataPoint[] }) {
  // uses chart.js, canvas API, ResizeObserver — whatever it needs
}
```

The component is registered in the built-in component registry and available to all schemas by name.

### For community components (installed from marketplace)

The package author bundles their dependencies during development using standard tooling (Vite, Rollup, esbuild). The output is a **single self-contained ESM file**:

```
Author's project                        Published package
────────────────                        ─────────────────
src/
  ChartWidget.tsx                  →    @we-pkg/charts/1.0.0/index.js
  (imports chart.js)                      (chart.js inlined, tree-shaken)
  (imports color-utils)                   (color-utils inlined)
package.json                              ~45KB single file
  chart.js: "^4.2.0"
  color-utils: "^1.0.0"
```

When a user installs the package:

1. WE fetches the single ESM file (from URL, npm CDN, or AD4M-native distribution)
2. Content-hashes it for integrity verification
3. Caches it in IndexedDB for offline use
4. Loads it via `import()` — no build step, no resolution, no network needed after first install
5. Calls `registerComponent()` / `registerStore()` / `registerBlock()` from the package manifest

From that point on, any schema can use `{ "type": "ChartWidget" }`.

### What this means for package authors

A community component package needs a minimal build setup:

```
my-we-package/
  src/
    index.ts          ← exports PackageManifest
    ChartWidget.tsx   ← the component (imports npm deps normally)
  package.json        ← npm deps listed here as usual
  vite.config.ts      ← builds to single ESM output
```

```typescript
// vite.config.ts — minimal config for a WE component package
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'] },
    rollupOptions: {
      // Don't externalize anything — bundle all deps into the output
      external: [],
    },
  },
});
```

```typescript
// src/index.ts
import type { PackageManifest } from '@we/types';
import { ChartWidget } from './ChartWidget';

const manifest: PackageManifest = {
  name: '@we-pkg/charts',
  version: '1.0.0',
  components: { ChartWidget },
  capabilities: [],
};

export default manifest;
```

The author develops with normal npm tooling, imports whatever they need, and the bundler produces the self-contained output. The consumer never sees the dependency tree.

---

## How Browser APIs Get Into WE

### The rule

**Components and stores can use any browser API. Schemas cannot.**

A schema says _what_ to render. A component decides _how_. Browser APIs are part of _how_:

| Browser API                             | Used by                                    | Schema visibility                    |
| --------------------------------------- | ------------------------------------------ | ------------------------------------ |
| `navigator.mediaDevices.getUserMedia()` | `callService` store, `VideoGrid` component | `$store: "callService.localStream"`  |
| `navigator.geolocation`                 | `LocationPicker` component                 | `{ "type": "LocationPicker" }`       |
| `ResizeObserver`                        | `ChartWidget` component                    | `{ "type": "ChartWidget" }`          |
| `fetch()`                               | Service stores, custom components          | `$action: "weatherService.refresh"`  |
| `IndexedDB`                             | Package cache (framework-level)            | Not visible at all                   |
| `RTCPeerConnection`                     | `callService` store                        | `$store: "callService.participants"` |
| `Web Audio API`                         | `AudioWaveform` component                  | `{ "type": "AudioWaveform" }`        |
| `Canvas / WebGL`                        | Visualisation components                   | `{ "type": "Canvas3D" }`             |
| `Clipboard API`                         | `CopyButton` component                     | `{ "type": "CopyButton" }`           |
| `localStorage`                          | Theme persistence (framework-level)        | `$store: "themeStore.mode"`          |

The pattern is always the same: the component or store uses the browser API internally and exposes a **props or store interface** that the schema binds to. The schema never mentions the API.

### Example: a component using `IntersectionObserver`

```typescript
// InfiniteScroll component — uses browser API internally
export function InfiniteScroll(props: { onLoadMore: () => void; children: JSX.Element }) {
  let sentinel!: HTMLDivElement;

  onMount(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) props.onLoadMore(); },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div>
      {props.children}
      <div ref={sentinel} />
    </div>
  );
}
```

Schema usage — no mention of `IntersectionObserver`:

```json
{
  "type": "InfiniteScroll",
  "props": {
    "onLoadMore": { "$action": "query.loadMore", "args": ["PostBlock"] }
  },
  "children": [
    {
      "type": "$forEach",
      "items": { "$query": { "model": "PostBlock", "order": { "createdAt": "DESC" } } },
      "template": { "type": "PostCard", "props": { "post": "$item" } }
    }
  ]
}
```

---

## Accepted Risks & Mitigations

Community component packages execute in the same browsing context as WE. They have full access to browser globals:

- `document.cookie`, `localStorage`, `sessionStorage`
- `fetch()`, `XMLHttpRequest`, `WebSocket`
- DOM manipulation outside their own component tree
- `window`, `navigator`, global state

**WE's capability system gates framework-provided APIs** (query service, store access, action dispatch) but **cannot sandbox browser globals** without iframe isolation.

### Mitigations (layered)

1. **Most apps are schema-only.** Pure JSON templates never execute code. The attack surface is limited to users who actively install JS packages.
2. **Capability consent UI.** Users see what a package requests before installation. Unknown-source packages get stronger warnings.
3. **Content hashing.** Installed packages are integrity-checked. A cached package can't be silently modified.
4. **Marketplace curation.** Published packages have author DID + content hash for accountability. Reviewed before listing.
5. **Schema-first culture.** The architecture incentivises solving problems with core components + `$query` + `$store` rather than reaching for custom code. Custom packages are the exception, not the norm.

### Future: iframe sandbox (deferred)

If the trust model proves insufficient, packages could be loaded in sandboxed iframes with a `postMessage`-based API bridge. This would prevent access to the parent frame's cookies, storage, and DOM — but adds significant complexity (async rendering, no direct DOM integration, serialization overhead). Not planned unless a real trust incident demonstrates the need.

---

## The Three Audiences

| Audience                           | What they do                                         | npm/browser API exposure                                                                  |
| ---------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **App builders** (most users)      | Write schema JSON, use AI to generate/edit           | None — they pick components by name, bind data with `$query`, wire actions with `$action` |
| **Component authors** (developers) | Build SolidJS components with full tooling           | Full — they import npm packages, use browser APIs, bundle into ESM packages               |
| **WE core team**                   | Build the framework, core components, service stores | Full — standard monorepo development with Vite                                            |

The packaging requirement creates a clean separation: **app builders never touch JavaScript**, component authors use standard frontend tooling, and the registry is the bridge between them. This is the same division of labour as WordPress (theme/plugin developers write PHP, site builders use the admin UI) or Figma (plugin developers write JS, designers use the visual tool).
