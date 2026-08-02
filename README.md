# WE

WE is a decentralized application framework and design system built on AD4M. It provides everything needed to build dynamic, schema-driven web applications with multiple launcher implementations (web, Electron, Tauri) and a comprehensive component library.

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
- **[Launcher UI Customization](./docs/guides/launcher-ui-customization.md)** - Customizing boot screen, settings, and launcher UI
- **[All docs →](./docs/README.md)**

## Workspace Structure

### Packages

- **[@we/app-shell](./packages/app-shell)** - Core framework for building WE launcher applications with platform adapters, stores, and SolidJS integration
- **[@we/schema-shared](./packages/schema-system/shared)** + **[@we/schema-solid](./packages/schema-system/solid)** - Schema-driven UI renderer with shared types/validators and SolidJS rendering
- **[@we/design-system](./packages/design-system)** - Complete design system with tokens, themes, elements, components, widgets, pages, and templates
- **[@we/block-solid](./packages/block-system/solid)** + **[@we/block-shared](./packages/block-system/shared)** - Block-based content composition system
- **[@we/models](./packages/models)** - Shared WE models (WeNode base class and entity models)
- **[@we/cli](./packages/cli)** - Command-line tools and build utilities
- **[@we/utils](./packages/utils)** - Shared utility functions

### Apps

- **[@we/app-web](./apps/we-web)** - Web launcher application (browser-based)
- **[@we/app-electron](./apps/we-electron)** - Electron desktop launcher (Linux, macOS, Windows)
- **[@we/app-tauri](./apps/we-tauri)** - Tauri desktop launcher (Rust-based)
- **[playgrounds](./apps/playgrounds)** - Development playgrounds for testing components and features

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
- **Platform Adapters**: Abstract platform differences for web, Electron, and Tauri
- **AD4M Integration**: Built-in stores and utilities for decentralized apps
- **Framework Support**: SolidJS with planned React support

## Development

```bash
# Validate seed configuration
pnpm validate:seed

# Build all packages
pnpm build

# Build for production
pnpm build:web
pnpm build:electron
pnpm build:tauri
```

## Support

For issues or questions, please open an issue on GitHub.
