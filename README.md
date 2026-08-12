# WE

WE is a decentralized application framework and design system built on AD4M. It provides everything needed to build dynamic, schema-driven applications — a token-based design system, a JSON-schema renderer, a graph engine, feature modules, and launcher apps for web, Electron, and Tauri.

**New here? Read [Why WE Exists](./VISION.md)** — the vision, the problem, and what WE is for.

## Quick Start

```bash
# Setup workspace (validates seed, builds packages, generates configs)
pnpm setup-workspace

# Start development
pnpm dev:web       # Web development server
pnpm dev:electron  # Electron app
pnpm dev:tauri     # Tauri app
```

## Documentation

- **[Developer Setup](./docs/getting-started/developer-setup.md)** - Complete setup guide, commands, and workflows
- **[Seed System](./docs/getting-started/seed-system.md)** - Seed file architecture, configuration, and examples
- **[Codebase Map](./docs/architecture/codebase-map.md)** - Architecture: the stack, the seams, where things live
- **[All docs →](./docs/README.md)**

## Workspace Structure

### Packages

| Directory                                          | Packages                                                                                                            | What it is                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **[design-system/](./packages/design-system)**     | `@we/tokens` `@we/themes` `@we/primitives` `@we/components` `@we/widgets` `@we/design-types` `@we/design-utils`      | Tokens → Lit primitives → Solid components/widgets, plus the DS-props machinery         |
| **[schema-system/](./packages/schema-system)**     | `@we/schema-shared` `@we/schema-solid`                                                                               | Schema semantics (framework-neutral) + the Solid renderer                               |
| **[block-system/](./packages/block-system)**       | `@we/block-shared` `@we/block-solid`                                                                                 | Block-based content composition (Lexical editor + AD4M persistence)                     |
| **[backend-system/](./packages/backend-system)**   | `@we/backend-shared` `@we/backend-ad4m` `@we/backend-inmemory`                                                       | The backend contract, its AD4M adapter, and the in-memory reference implementation      |
| **[graph-system/](./packages/graph-system)**       | `@we/graph-protocol` `@we/graph-core` `@we/graph-expanders` `@we/graph-layouts` `@we/graph-solid`                    | The graph engine behind `GraphView`                                                    |
| **[module-system/](./packages/module-system)**     | `@we/module-shared` `@we/module-call` `@we/module-notes` `@we/module-transcribe` `@we/module-graph` + globe family   | The feature-module contract and the bundled modules                                    |
| **[templates/](./packages/templates)**             | `@we/template-kit` `@we/template-shell` `@we/template-default`                                                       | Reusable template fragments, the shell surfaces, and the built-in space templates      |
| **[app-shell](./packages/app-shell)**              | `@we/app-shell`                                                                                                      | The application shell: stores, registries, boot, built-in schemas                       |
| **[editor](./packages/editor)**                    | `@we/editor`                                                                                                         | The template/theme editing surface, embeddable via `EditorHost`                         |
| **[models](./packages/models)**                    | `@we/models`                                                                                                         | WE's domain models (Space, blocks, …)                                                   |
| **[ai-context](./packages/ai-context)**            | `@we/ai-context`                                                                                                     | Generates the AI/schema reference (`CLAUDE.md` et al.) from code + fragments            |
| **[cli](./packages/cli)**                          | `@we/cli`                                                                                                            | `we-build` — the banner-and-timing wrapper every package's build runs through           |

### Apps

- **[@we/app-web](./apps/we-web)** - Web launcher application (browser-based)
- **[@we/app-electron](./apps/we-electron)** - Electron desktop launcher (Linux, macOS, Windows)
- **[@we/app-tauri](./apps/we-tauri)** - Tauri desktop launcher (Rust-based)
- **[playgrounds](./apps/playgrounds)** - Development playgrounds (graph explorer, render benchmark, portable-UI slice)

## Features

### Launcher System

- **Single Source of Truth**: Configure everything via `we-seed.json`
- **Multi-Platform**: Web, Electron, and Tauri support
- **App Modes**: Automatic layout switching (single app vs multi-app)
- **White-Labeling**: Fully customizable launcher UI via seed configuration
- **Auto-Generation**: Platform-specific configs generated from seed file

### Framework & Design System

- **Schema-Driven UI**: Build interfaces from JSON schemas with `@we/schema-solid`
- **Component Library**: Comprehensive design system with tokens, themes, and components
- **Backend Contract**: The renderer and design system never import a backend — AD4M is one adapter behind `@we/backend-shared`
- **Platform Adapters**: Abstract platform differences for web, Electron, and Tauri
- **Framework Support**: SolidJS today; the schema semantics are framework-neutral by construction

## Development

```bash
pnpm validate:seed      # Validate seed configuration
pnpm validate:schemas   # Validate all template schemas
pnpm build              # Build all packages (serialized: cross-package builds share output dirs)
pnpm test               # Run every package's tests (--no-bail: see all failures at once)
pnpm typecheck          # Typecheck (packages that define a typecheck script)
pnpm lint               # ESLint, zero-warning policy
pnpm lint:css           # Stylelint over authored CSS
pnpm build:web          # Production builds per target
pnpm build:electron
pnpm build:tauri
```

## Support

For issues or questions, please open an issue on GitHub.
