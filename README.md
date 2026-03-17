# WE

WE is a decentralized application framework and design system built on AD4M. It provides everything needed to build dynamic, schema-driven web applications with multiple launcher implementations (web, Electron, Tauri) and a comprehensive component library.

## Quick Start

```bash
# Setup workspace (validates seed, builds packages, generates configs)
pnpm setup

# Start development
pnpm dev:web       # Web development server
pnpm dev:electron  # Electron app
pnpm dev:tauri     # Tauri app
```

## Documentation

- **[DEVELOPER_SETUP.md](./DEVELOPER_SETUP.md)** - Complete setup guide, commands, and workflows
- **[SEED-SYSTEM.md](./SEED-SYSTEM.md)** - Seed file architecture, configuration, and examples
- **[LAUNCHER-UI-CUSTOMIZATION.md](./LAUNCHER-UI-CUSTOMIZATION.md)** - Customizing boot screen, settings, and launcher UI

## Workspace Structure

### Packages

- **[@we/app-framework](./packages/app-framework)** - Core framework for building WE launcher applications with platform adapters, stores, and SolidJS integration
- **[@we/schema-shared](./packages/schema-system/shared)** + **[@we/schema-solid](./packages/schema-system/solid)** - Schema-driven UI renderer with shared types/validators and SolidJS rendering
- **[@we/design-system](./packages/design-system)** - Complete design system with tokens, themes, elements, components, widgets, pages, and templates
- **[@we/block-solid](./packages/block-system/solid)** + **[@we/block-shared](./packages/block-system/shared)** - Block-based content composition system
- **[@we/models](./packages/block-system/models)** - Shared TypeScript types and interfaces
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
pnpm validate

# Build all packages
pnpm build

# Build for production
pnpm build:web
pnpm build:electron
pnpm build:tauri
```

## Support

For issues or questions, please open an issue on GitHub.
