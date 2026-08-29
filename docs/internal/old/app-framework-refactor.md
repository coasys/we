> **Archived: completed refactor.** `packages/app-framework` became `packages/app-shell`;
> everything this plan proposed either shipped or was superseded. Historical context only.

# App Framework Refactor

Targeted cleanup of `@we/app-shell`: fix the seed import, remove dead integration infrastructure, fix type/validator mismatches, and add an `Ad4mIframe` wrapper for embedded app credential sharing.

## Status

| Phase                                                         | Status      |
| ------------------------------------------------------------- | ----------- |
| P1 — Inject seed from launcher apps (remove hardcoded import) | Not started |
| P2 — Add `Ad4mIframe` wrapper component in app-framework      | Not started |
| P3 — Remove dead integration infrastructure + dead code       | Not started |
| P4 — Unify validators + fix type/reality mismatch             | Not started |

### Deferred (not needed yet)

| Phase                                                | Reason deferred                                                                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Extract `@we/seed` package~~                       | Code is already well-organized under `src/seed/` with clear files. Creating a separate package adds monorepo overhead for no current consumer. |
| ~~Internal restructure: `core/` vs `app/` boundary~~ | YAGNI — WE is one product. The current structure is clear enough to extract `app/` later if a second consumer appears. No concrete need today. |

---

## Problem Statement

### Current state

`@we/app-shell` has several concrete issues worth fixing:

1. **Hardcoded seed import**: `import weSeedFile from '../../../../we-seed.json'` in `initializeIntegrations.ts` — fragile relative path, breaks if repo structure changes, prevents framework reuse
2. **Dead integration infrastructure**: `integrationComposer.ts`, `integrationLoader.ts`, `seedLoader.ts`, and `schemas/integrations/flux/*` — the seed has `apps: []`, the composer generates templates from apps that don't exist, the loader loads files the runtime never uses, `seedLoader.ts` is explicitly marked unused
3. **Validator inconsistency**: `validateSeed()` (in `seed/validator.ts`) requires ≥1 app; `validateSeedForLauncher()` (in `integrationComposer.ts`) allows 0 apps; actual seed has `apps: []`
4. **Type/reality mismatch**: `WeSeedFile` defines `ad4m.ai`, `ad4m.perspectives`, `ad4m.executor`; actual seed uses `ad4m.dataPath`, `ad4m.executorPath`, `ad4m.repoPath` — fields not in the type. `electron` field also missing from type.
5. **No clean way to embed AD4M-aware apps**: Currently scattered between AdamStore (credential sharing), PlatformAdapter (URL resolution), and integrationComposer (launcher generation)

### What we're NOT doing (and why)

- **Not extracting `@we/seed` to a separate package** — The code under `src/seed/` (cli.ts, processor.ts, validator.ts, examples.ts) is already well-organized. A separate package adds a package.json, build config, versioning, and dependency management for a CLI that only build scripts use. Until there's an external consumer, the overhead isn't justified.
- **Not restructuring into `core/` vs `app/` directories** — This would touch 30+ files and rewrite all their imports to prepare for extracting `app/` to a separate package _if_ a second consumer appears. WE is one product — the framework and the native experience ship together. If extraction is needed later, the current code is organized well enough to do it then.
- **Not putting AD4M logic in `we-iframe`** — See P2 reasoning below.

---

## Phase 1 — Inject seed from launcher apps

**Goal**: Remove the hardcoded `../../../../we-seed.json` import. Launcher apps pass the seed into the framework.

### Changes

- Add `seed` prop to `PlatformProvider`
- Store seed in platform context alongside the adapter
- `initializeIntegrations()` receives seed as a parameter instead of importing it
- Each launcher app (we-web, we-electron, we-tauri) imports its own seed and passes it in:

```tsx
// apps/we-electron/src/index.tsx
import seed from '../../we-seed.json';
import { App, PlatformProvider } from '@we/app-shell/solid';

render(
  () => (
    <PlatformProvider adapter={electronAdapter} seed={seed}>
      <App />
    </PlatformProvider>
  ),
  root,
);
```

### Files changed

- `packages/app-framework/src/shared/platform/types.ts` — add seed to context
- `packages/app-framework/src/shared/platform/context.tsx` — accept seed prop
- `packages/app-framework/src/shared/initializeIntegrations.ts` — remove static import, accept seed parameter
- `apps/we-web/src/index.tsx` — import and pass seed
- `apps/we-electron/src/renderer/index.tsx` — import and pass seed
- `apps/we-tauri/src/index.tsx` — import and pass seed

---

## Phase 2 — Add `Ad4mIframe` wrapper component

**Goal**: Provide a clean way to embed AD4M-aware apps in schemas, without putting platform logic in a design system primitive.

### Why NOT in `we-iframe`

`we-iframe` is a design system primitive in `@we/primitives`. Putting AD4M credential sharing and platform-aware URL resolution there means:

- **Layer violation**: `@we/primitives` (design system) would depend on platform concepts (AD4M client, Electron/Tauri URL protocols). Every consumer of the DS (Storybook, external projects) inherits AD4M types.
- **Context access**: `we-iframe` is a Lit web component. It has no access to SolidJS context (`usePlatform()`). You'd need to pass platform details through attributes or a global, defeating the purpose of the platform abstraction.
- **Testability**: A pure iframe primitive is testable in isolation. An iframe with AD4M credential logic baked in requires mocking the platform layer in every test.

### Why NOT in `@we/components`

`@we/components` is a Solid component library that wraps primitives — part of the design system stack. But `Ad4mIframe` needs `usePlatform()` from `@we/app-shell`. Putting it in `@we/components` would create a circular dependency: `@we/app-shell` → `@we/components` (already exists via componentRegistry) → `@we/app-shell`.

### Solution: wrapper in `@we/app-shell`

A thin Solid component (~20 lines) that composes `we-iframe` with platform-aware behavior:

```tsx
// packages/app-framework/src/frameworks/solid/components/Ad4mIframe.tsx
import { createEffect, createSignal } from 'solid-js';
import { usePlatform } from '../../shared/platform/context';

export default function Ad4mIframe(props: { src: string; capabilities?: string[]; [key: string]: unknown }) {
  const platform = usePlatform();
  const [resolvedSrc, setResolvedSrc] = createSignal(props.src);

  // Platform-aware URL resolution
  createEffect(() => {
    if (props.src.startsWith('http')) {
      setResolvedSrc(props.src);
    } else {
      setResolvedSrc(platform.resolveAppUrl(props.src));
    }
  });

  // Credential sharing on load
  function handleLoad(e: Event) {
    if (platform.isDesktop && platform.getConnectionDetails) {
      const iframe = e.target as HTMLIFrameElement;
      platform.getConnectionDetails().then(({ port, token }) => {
        iframe.contentWindow?.postMessage({ type: 'AD4M_CONFIG', port, token }, new URL(resolvedSrc()).origin);
      });
    }
  }

  return <we-iframe {...props} src={resolvedSrc()} onLoad={handleLoad} />;
}
```

Register in `componentRegistry.tsx`:

```ts
import Ad4mIframe from '../components/Ad4mIframe';

export const componentRegistry = {
  // ...existing entries
  Ad4mIframe,
};
```

### Schema usage

AD4M-aware embedded app:

```json
{ "type": "Ad4mIframe", "props": { "src": "/apps/flux", "capabilities": ["perspectives", "agents"] } }
```

Plain iframe (no AD4M):

```json
{ "type": "we-iframe", "props": { "src": "https://example.com" } }
```

### Files changed

- `packages/app-framework/src/frameworks/solid/components/Ad4mIframe.tsx` — new (~20 lines)
- `packages/app-framework/src/frameworks/solid/registries/componentRegistry.tsx` — add registry entry

---

## Phase 3 — Remove dead integration infrastructure + dead code

**Goal**: Delete the integration composer, loader, seed loader, and generated flux files. The seed has `apps: []` — this infrastructure serves no current purpose.

### What gets deleted

| File                                     | Reason                                                         |
| ---------------------------------------- | -------------------------------------------------------------- |
| `src/shared/integrationComposer.ts`      | Generates launcher templates from seed apps — seed has no apps |
| `src/shared/integrationLoader.ts`        | Loads pre-generated integration files the runtime doesn't use  |
| `src/shared/seedLoader.ts`               | Explicitly marked unused with detailed comment explaining why  |
| `src/shared/schemas/integrations/flux/*` | Generated files never consumed at runtime                      |

### What gets simplified

- `initializeIntegrations.ts` — reduces to: validate seed, apply host UI config, register default template. No launcher generation.
- `WeSeedFile` type — remove `apps` array, `paths`, `commands` fields (can be re-added if embedded apps are needed later)
- `PlatformAdapter` interface — keep `resolveAppUrl()` and `getConnectionDetails()` (still used by `Ad4mIframe` through `usePlatform()`)
- `src/shared/index.ts` — remove integration exports

---

## Phase 4 — Unify validators + fix types

**Goal**: Single validation function. Types match the actual seed file.

### Validator changes

- Merge `validateSeed()` (from `src/seed/validator.ts`) and `validateSeedForLauncher()` (from `integrationComposer.ts`, deleted in P3) into one `validateSeed()` in `src/seed/validator.ts`
- 0 apps is valid (native WE mode)
- AD4M fields are optional and validated when present

### Type fixes

Add actually-used fields to `WeSeedFile` in `src/types/seed.ts`:

```typescript
ad4m?: {
  dataPath?: string;        // e.g. "~/.we-native-app"
  executorPath?: string;    // e.g. "../ad4m/target/release/ad4m-executor"
  repoPath?: string;        // e.g. "../ad4m"
  // ...existing ai, perspectives, languages, executor fields
}

electron?: {
  appDistPath?: string;
  basePort?: number;
}
```

---

## Implementation Order

```
P1 (inject seed) → P3 (remove dead infra) → P4 (fix validators + types)
                  ↘ P2 (Ad4mIframe wrapper) — independent, can be done anytime
```

P1 must come first since P3 simplifies `initializeIntegrations.ts` which P1 modifies. P4 is last since it cleans up types that P3 changes. P2 is independent and can be done in parallel or after.

- Remove unused exports from `src/shared/index.ts`
- Remove `@ts-ignore` in `initializeIntegrations.ts` (fix launcherUIRegistry API with a proper setter)
- Remove `resolveAppUrl` from `PlatformAdapter` interface and all implementations
- Update all internal import paths to use `core/` and `app/` structure
- Verify the `app/ → core/` dependency rule holds (no reverse imports)
- Verify no remaining references to deleted modules

---

## Architecture After Refactor

```
@we/seed (build-time — separate package)
├── types.ts              (WeSeedFile, SeedValidationResult, SeedMetadata)
├── processor.ts          (SeedProcessor — generates TS from seed JSON)
├── validator.ts          (validateSeed — unified)
├── cli.ts                (we-seed binary)
└── examples.ts

@we/app-shell (single package, two internal layers)
├── core/                         ← platform infrastructure
│   ├── stores/                   (Adam, Route, Template, Theme, Modal)
│   ├── platform/                 (PlatformAdapter interface + context)
│   ├── registries/               (template, theme, launcher UI, base components)
│   ├── schemas/defaults/         (BootScreen, AppSettings, BaseTemplate)
│   ├── providers/                (Store, Template)
│   ├── components/               (Splashscreen, AppSettings)
│   ├── App.tsx                   (shell: boot → auth → render)
│   └── initializeIntegrations.ts (seed config + host UI)
│
├── app/                          ← WE native application (imports core/, never reverse)
│   ├── stores/                   (SpaceStore, AiStore)
│   ├── prompts/                  (schemaContext, schemaExamples, testPrompts)
│   ├── schemas/                  (weNativeApp, DefaultTemplate, TwitterTemplate)
│   ├── registry.ts               (CesiumGlobe, GraphWidget, PostCard)
│   └── index.ts                  (registerApp)
│
└── shared/                       (types, utils, styles)

    deps: @coasys/ad4m, solid-js, @solidjs/router, zod
    deps: @we/tokens, @we/themes, @we/primitives, @we/components
    deps: @we/schema-shared, @we/schema-solid
    deps: @we/entities, @we/widgets, @we/cesium-layers, three, gsap

we-iframe (in @we/primitives — enhanced)
├── AD4M credential sharing  (postMessage on load when ad4m=true)
├── Platform-aware URL resolution (logical paths → platform URLs)
└── Standard iframe props    (src, allow, sandbox, width, height)

Launcher Apps (we-web, we-electron, we-tauri)
├── PlatformAdapter implementation
├── Seed import + injection via PlatformProvider
└── Build scripts for app packaging (Electron Express, Tauri assets)
```

### Initialization flow (after refactor)

```
Launcher app entry point
  │
  ├── import seed from './we-seed.json'
  │
  └── <PlatformProvider adapter={...} seed={seed}>
        <App />                              ← core/App.tsx
          │
          ├── registerApp()                  ← app/ wires stores, schemas, widgets into core
          ├── StoreProvider                  ← core stores + app stores
          ├── TemplateProvider
          │     ├── initializeIntegrations() ← apply seed host config, set default template
          │     └── Render active template   ← schema renderer
          │
          └── Schema tree renders:
                ├── we-text, we-button, Row, Column  (core/ components)
                ├── CesiumGlobe, GraphWidget         (app/ components)
                └── we-iframe[ad4m=true]             (embedded apps, self-contained)
```

````

### Seed file (simplified)

```json
{
  "project": { "name": "WE", "version": "0.1.0", "description": "...", "author": "..." },
  "ad4m": { "dataPath": "~/.we", "executorPath": "../ad4m/target/release/ad4m-executor" },
  "electron": { "basePort": 8080 },
  "host": { "ui": { "defaultTemplate": "weNative", "enableTemplateSwitching": true } }
}
````

### Coasys monorepo readiness

- Seed file has no `apps[]` with repo-relative paths — nothing breaks when repo structure changes
- `@coasys/ad4m` moves from `"0.11.0"` to `workspace:*` — one-line change
- `ad4m.executorPath` and `ad4m.repoPath` become unnecessary (build system resolves inter-package references)
- `@we/seed` types can evolve independently for monorepo-aware config
- Framework is fully injectable — no hardcoded assumptions about file layout
- Internal `core/` vs `app/` boundary means extraction to `@we/native-app` is a mechanical move when needed
- No premature abstraction — WE ships as one product with clear internal structure
