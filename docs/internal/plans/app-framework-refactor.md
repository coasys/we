# App Framework Refactor

Restructure `@we/app-framework` to:

- **Clean up the runtime package** with clear internal boundaries between platform infrastructure (`core/`) and the WE native application (`app/`). One package, two distinct layers — `app/` imports from `core/` but never the reverse. When a second consumer appears (coasys monorepo), the `app/` directory can be extracted to its own package in ~30 minutes.
- **Extract `@we/seed`** as a standalone build-time package: CLI, processor, validator, types. No browser deps.
- **Remove embedded app special-casing** — iframes become a regular schema component via an enhanced `we-iframe` primitive.

## Status

| Phase                                                                  | Status      |
| ---------------------------------------------------------------------- | ----------- |
| P1 — Inject seed from launcher apps (remove hardcoded import)          | Not started |
| P2 — Enhance `we-iframe` with AD4M credential sharing + URL resolution | Not started |
| P3 — Remove integration infrastructure (composer, loader, seed apps)   | Not started |
| P4 — Extract `@we/seed` package (CLI, processor, validator, types)     | Not started |
| P5 — Unify validators + fix type/reality mismatch                      | Not started |
| P6 — Internal restructure: `core/` vs `app/` boundary                  | Not started |
| P7 — Clean up dead code + final polish                                 | Not started |

---

## Problem Statement

### Current state

`@we/app-framework` is a single package responsible for:

- SolidJS application shell (7 stores, providers, App component)
- Schema/template registry system
- Seed file processor + CLI tool (`we-seed` binary)
- Platform abstraction layer
- AI prompt library
- Design system integration (imports all DS layers)
- Launcher infrastructure (integration composer, loader, 3-mode detection)
- **WE-specific domain logic** (SpaceStore, AiStore, CesiumGlobe, 3D layers, post schemas)

The framework conflates **platform infrastructure** (boot, auth, routing, theming — things any AD4M app needs) with **application logic** (spaces, posts, AI generation, 3D visualization — things specific to the WE native experience). Anyone using the framework to build a different AD4M application inherits all of WE's domain code.

The launcher infrastructure also treats embedded apps as architecturally special — with dedicated types, validators, a multi-mode composer (0/1/N apps), platform adapter URL resolution, and the entire seed `apps[]` specification. This creates a parallel path that undermines the schema-driven UI model.

### Key issues

1. **Platform ≠ application**: SpaceStore, AiStore, CesiumGlobe, GSAP, Three.js are WE app concerns interleaved with platform infrastructure. No clear boundary between the two.
2. **Hardcoded seed import**: `import weSeedFile from '../../../../we-seed.json'` — fragile relative path, breaks if repo structure changes, prevents framework reuse
3. **Dual integration paths**: Processor generates code (schemas/integrations/flux/\*) that the runtime never loads; the composer generates templates on-the-fly instead
4. **Validator inconsistency**: `validateSeed()` requires ≥1 app; `validateSeedForLauncher()` allows 0 apps; actual seed has `apps: []`
5. **Type/reality mismatch**: `WeSeedFile` defines `ad4m.ai`, `ad4m.perspectives`, `ad4m.executor`; actual seed uses `ad4m.dataPath`, `ad4m.executorPath`, `ad4m.repoPath` — fields not in the type
6. **Dead code**: `seedLoader.ts` (marked unused), generated flux integration files, `loadFluxIntegration()` hardcoded loader
7. **God package**: Build-time CLI + runtime framework + AI prompts + domain app in one package

### Target state

- **`@we/app-framework`** — Single package with clear internal structure:
  - **`core/`** — Platform infrastructure: core stores (Adam, Route, Template, Theme, Modal), registries, platform adapter, App shell, base component registry
  - **`app/`** — WE native application: SpaceStore, AiStore, AI prompts, weNativeApp/DefaultTemplate/TwitterTemplate schemas, domain component registry extensions (CesiumGlobe, GraphWidget, PostCard)
  - `app/` imports from `core/` but never the reverse — enforced by convention or lint rule
  - If a second AD4M app needs the platform without WE's domain logic, `app/` extracts to `@we/native-app` trivially
- **`@we/seed`** — Build-time tooling: CLI, processor, validator, types. Zero browser deps.
- Seed file injected by launcher apps, not imported by the framework
- Embedded apps use `we-iframe` with `ad4m` and `capabilities` props — no special infrastructure
- Single validation path, types match reality

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
import { App, PlatformProvider } from '@we/app-framework/solid';

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

## Phase 2 — Enhance `we-iframe` with AD4M + URL resolution

**Goal**: Make `we-iframe` a self-contained primitive that handles credential sharing and platform-aware URL resolution, replacing the scattered logic in AdamStore and PlatformAdapter.

### New props on `we-iframe`

| Prop           | Type       | Default | Description                                    |
| -------------- | ---------- | ------- | ---------------------------------------------- |
| `ad4m`         | `boolean`  | `false` | Enable AD4M credential sharing via postMessage |
| `capabilities` | `string[]` | `[]`    | AD4M capability scoping (future use)           |

### Credential sharing (moved from AdamStore)

When `ad4m={true}` and the platform is desktop:

1. Read `getConnectionDetails()` from platform context
2. On iframe load, postMessage `{ type: 'AD4M_CONFIG', port, token }` to iframe origin
3. Clean up listener on component disconnect

### URL resolution (moved from PlatformAdapter)

When `src` is not a full URL (no `http://` prefix):

- **Electron**: Resolve via bundled port map → `http://localhost:{port}`
- **Tauri**: Resolve via asset protocol → `asset://localhost{src}/index.html`
- **Web**: Treat as relative path

This is ~40 lines of logic inside the `we-iframe` component, replacing `PlatformAdapter.resolveAppUrl()` and the credential-sharing code in AdamStore.

### Files changed

- `packages/design-system/3-primitives/src/primitives/iframe.ts` — add `ad4m`, `capabilities` props; add credential sharing + URL resolution
- `packages/app-framework/src/frameworks/solid/stores/AdamStore.tsx` — remove iframe postMessage logic

---

## Phase 3 — Remove integration infrastructure

**Goal**: Delete the launcher mode detection, integration composer, integration loader, and seed `apps[]` machinery. Embedded apps become `we-iframe` nodes in schemas.

### What gets deleted

| File                                     | Reason                                                             |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `src/shared/integrationComposer.ts`      | Replaced by schemas authored directly                              |
| `src/shared/integrationLoader.ts`        | Dead code — was loading pre-generated files the runtime didn't use |
| `src/shared/seedLoader.ts`               | Already marked unused                                              |
| `src/shared/schemas/integrations/flux/*` | Generated files never consumed at runtime                          |
| `PlatformAdapter.resolveAppUrl()`        | Moved into `we-iframe`                                             |
| `PlatformAdapter.getConnectionDetails()` | Stays but consumed by `we-iframe` directly                         |

### What gets simplified

- `initializeIntegrations.ts` — reduces to: validate seed, apply host UI config, register default template. No launcher generation.
- `WeSeedFile` type — remove `apps[]`, `paths`, `commands` fields
- `src/shared/index.ts` — remove integration exports

### Migration for existing Flux integration

The Electron/Tauri launcher apps that currently embed Flux via seed config instead use a template schema:

```json
{
  "type": "we-iframe",
  "props": {
    "src": {
      "$if": {
        "condition": { "$store": "adamStore.isDevelopment" },
        "then": "http://localhost:3000",
        "else": "/apps/flux"
      }
    },
    "ad4m": true,
    "capabilities": ["perspectives", "languages", "agents"],
    "width": "100%",
    "height": "100%"
  }
}
```

Build-time packaging of Flux dist files remains in the Electron/Tauri build scripts — that's build tooling, not framework concern.

---

## Phase 4 — Extract `@we/seed` package

**Goal**: Move all build-time seed tooling into a standalone package with no browser or SolidJS dependencies.

### Package structure

```
packages/seed/
├── package.json          (@we/seed, bin: we-seed)
├── tsconfig.json
├── tsup.config.ts
└── src/
    ├── index.ts          (public API)
    ├── types.ts          (WeSeedFile, SeedValidationResult, SeedMetadata)
    ├── processor.ts      (SeedProcessor class)
    ├── validator.ts      (validateSeed — unified)
    ├── cli.ts            (we-seed binary)
    └── examples.ts       (seed file examples)
```

### Dependencies

- `zod` (for validation, if we upgrade from manual checks)
- Zero browser/framework deps

### Consumers

- `@we/app-framework` imports types only: `import type { WeSeedFile } from '@we/seed'`
- Build scripts in we-electron, we-tauri can use the processor/validator directly
- CI can run `we-seed validate` independently

---

## Phase 5 — Unify validators + fix types

**Goal**: Single validation function that handles all cases. Types match the actual seed file.

### Validator changes

- Merge `validateSeed()` and `validateSeedForLauncher()` into one `validateSeed()` in `@we/seed`
- 0 apps is valid (native WE mode)
- AD4M fields are optional and validated when present

### Type fixes

Add actually-used fields to `WeSeedFile`:

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

## Phase 6 — Internal restructure: `core/` vs `app/` boundary

**Goal**: Establish a clear internal boundary within `@we/app-framework` between platform infrastructure and WE-specific application logic. One package, two layers — `app/` imports from `core/` but never the reverse.

This is deliberately **not** a package extraction. WE is one product — the framework and the native experience ship together. The internal boundary exists so that if a second consumer appears (coasys monorepo, another AD4M project), the `app/` directory can be extracted to `@we/native-app` in a single move.

### Directory structure after restructure

```
packages/app-framework/src/
├── core/                              ← platform infrastructure
│   ├── stores/
│   │   ├── AdamStore.tsx              (AD4M client, boot, auth)
│   │   ├── RouteStore.tsx             (navigation)
│   │   ├── TemplateStore.tsx          (template switching)
│   │   ├── ThemeStore.tsx             (theme application)
│   │   └── ModalStore.tsx             (modal state)
│   ├── platform/
│   │   ├── types.ts                   (PlatformAdapter interface)
│   │   └── context.tsx                (platform context provider)
│   ├── registries/
│   │   ├── templateRegistry.ts
│   │   ├── themeRegistry.ts
│   │   ├── launcherUIRegistry.ts
│   │   └── componentRegistry.tsx      (base: primitives, Row, Column, etc.)
│   ├── schemas/
│   │   ├── BaseTemplate.schema.ts
│   │   └── defaults/                  (BootScreen, AppSettings)
│   ├── providers/
│   │   ├── StoreProvider.tsx
│   │   └── TemplateProvider.tsx
│   ├── components/
│   │   ├── Splashscreen.tsx
│   │   └── AppSettings.tsx
│   ├── App.tsx                        (shell: boot → auth → render)
│   └── initializeIntegrations.ts      (seed config + host UI)
│
├── app/                               ← WE native application
│   ├── stores/
│   │   ├── SpaceStore.tsx             (perspectives, posts, 3D layers)
│   │   └── AiStore.tsx                (AI schema generation)
│   ├── prompts/
│   │   ├── schemaContext.ts
│   │   ├── schemaExamples.ts
│   │   └── testPrompts.ts
│   ├── schemas/
│   │   ├── weNativeApp.ts
│   │   ├── DefaultTemplate.schema.ts
│   │   ├── TwitterTemplate.schema.ts
│   │   └── TestTemplate.schema.ts
│   ├── registry.ts                    (extends component registry: CesiumGlobe, GraphWidget, PostCard)
│   └── index.ts                       (registerApp — wires stores, schemas, widgets into core)
│
└── shared/                            ← truly shared (types, utils, styles)
    ├── index.ts
    ├── utils.ts
    └── styles/
```

### Dependency rule

**`app/` → `core/`** — allowed (app imports platform infrastructure)  
**`core/` → `app/`** — **forbidden** (platform must not know about the WE app)

Enforced by convention initially. Can later add an ESLint rule (`no-restricted-imports`) or use a boundary tool.

### Store classification

| Store         | Layer   | Reason                                                  |
| ------------- | ------- | ------------------------------------------------------- |
| AdamStore     | `core/` | AD4M client, boot state, auth — any AD4M app needs this |
| RouteStore    | `core/` | Navigation — platform infrastructure                    |
| TemplateStore | `core/` | Template switching — platform infrastructure            |
| ThemeStore    | `core/` | Theme application — platform infrastructure             |
| ModalStore    | `core/` | Modal state — platform infrastructure                   |
| SpaceStore    | `app/`  | Perspectives, posts, layers — WE domain model           |
| AiStore       | `app/`  | AI generation, prompts — WE feature                     |

### Component registry split

`core/registries/componentRegistry.tsx` registers only base components:

- Primitives: we-text, we-button, we-icon, we-modal, we-iframe
- Layout: Column, Row
- Base widgets: CircleButton, PopoverMenu

`app/registry.ts` extends it with domain widgets:

- CesiumGlobe, GraphWidget, PostCard, CreateSpaceModalWidget

### App registration pattern

```typescript
// app/index.ts
import { componentRegistry, templateRegistry } from '../core/registries';
import { SpaceStore, AiStore } from './stores';
import { weNativeApp, DefaultTemplate, TwitterTemplate } from './schemas';
import { nativeAppComponents } from './registry';

export function registerApp() {
  Object.assign(componentRegistry, nativeAppComponents);
  templateRegistry.weNative = weNativeApp;
  templateRegistry.default = DefaultTemplate;
  templateRegistry.twitter = TwitterTemplate;
}

export { SpaceStore, AiStore };
```

Called from `App.tsx` during initialization — no change to launcher app entry points.

### Future extraction path

When a second consumer needs the platform without WE's domain logic:

1. `mv app/ ../native-app/src/`
2. Add `packages/native-app/package.json` with deps on `@we/app-framework`
3. Move `three`, `gsap`, `@we/cesium-layers` to native-app's deps
4. Launcher apps add `import { registerApp } from '@we/native-app'`

The internal boundary makes this a mechanical move, not an architectural change.

---

## Phase 7 — Clean up dead code + final polish

**Goal**: Remove all orphaned code and tighten the remaining surface.

- Delete `src/shared/seedLoader.ts`
- Delete `src/shared/schemas/integrations/` directory
- Remove `src/shared/integrationLoader.ts` and `src/shared/integrationComposer.ts` (if not already deleted in P3)
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

@we/app-framework (single package, two internal layers)
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
    deps: @we/models, @we/widgets, @we/cesium-layers, three, gsap

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
