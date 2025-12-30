# @we/app-framework

Core framework package for the WE launcher applications. Provides platform-agnostic UI components, stores, and utilities that are shared across all launcher implementations (web, Electron, Tauri).

## What This Package Does

The `@we/app-framework` serves as the foundation for building WE launcher applications across different platforms. It provides:

- **Platform Abstraction Layer**: Common interface for different runtime environments (web, Electron, Tauri)
- **SolidJS Framework Integration**: Pre-configured SolidJS app with routing, stores, and components
- **AD4M Integration**: Stores and utilities for managing AD4M client connections
- **Shared UI Components**: Application-level components (AI interface, settings, splashscreen)
- **Schema & Template Registries**: System for managing dynamic content schemas
- **Design System Integration**: Automatic import of all WE design system packages

## Architecture

### Platform Adapters

Each launcher implements the `PlatformAdapter` interface to handle platform-specific concerns:

```typescript
interface PlatformAdapter {
  // Build AD4M client using platform-specific method
  buildAd4mClient(): Promise<Ad4mClient>;

  // Optional: Get connection details for passing to embedded apps
  getConnectionDetails?(): Promise<{ port: number; token: string }>;

  // Platform metadata
  isDesktop: boolean;
  platform: 'web' | 'electron' | 'tauri';
}
```

**Example Implementations:**

- **Web**: Uses `ad4m-connect` for browser-based authentication
- **Electron**: Uses IPC to get port/token from main process
- **Tauri**: Uses Tauri commands to get port/token from Rust backend

### Directory Structure

```
src/
├── frameworks/
│   └── solid/              # SolidJS-specific implementation
│       ├── App.tsx         # Root application component
│       ├── components/     # App-level components
│       ├── stores/         # Global state management
│       ├── providers/      # Context providers
│       └── registries/     # Template and theme registries
│
└── shared/                 # Platform-agnostic code
    ├── platform/           # Platform adapter types and context
    ├── schemas/            # Data schemas
    ├── registries/         # Template and theme registries
    ├── prompts/            # AI prompt utilities
    └── utils.ts            # Shared utilities
```

## Usage

### Setting Up a New Launcher

1. **Install the package:**

```bash
pnpm add @we/app-framework
```

2. **Create a platform adapter:**

```typescript
// src/platform/webAdapter.ts
import type { PlatformAdapter } from '@we/app-framework/shared';

export const webAdapter: PlatformAdapter = {
  async buildAd4mClient() {
    // Platform-specific implementation
  },
  isDesktop: false,
  platform: 'web',
};
```

3. **Initialize the app:**

```typescript
// src/main.tsx
import { render } from 'solid-js/web';
import { App, PlatformProvider } from '@we/app-framework/solid';
import { webAdapter } from './platform/webAdapter';

render(
  () => (
    <PlatformProvider adapter={webAdapter}>
      <App />
    </PlatformProvider>
  ),
  document.getElementById('root')!
);
```

### Using Platform Adapter

Access the platform adapter anywhere in your app:

```typescript
import { usePlatform } from '@we/app-framework/shared';

function MyComponent() {
  const platform = usePlatform();

  if (platform.isDesktop) {
    // Desktop-specific logic
  }

  const client = await platform.buildAd4mClient();
}
```

### Accessing Stores

```typescript
import { useAdamStore } from '@we/app-framework/solid';

function MyComponent() {
  const adam = useAdamStore();

  // Access AD4M client
  const client = adam.adamClient();

  // Get current user
  const me = adam.me();

  // Check boot state
  if (adam.bootState() === 'ready') {
    // App is ready
  }
}
```

## Package Exports

### `@we/app-framework/shared`

Platform-agnostic types, utilities, and schemas. Use this for:

- Platform adapter types
- Schema definitions
- Template registries
- Theme registries
- Shared utilities

### `@we/app-framework/solid`

SolidJS framework integration. Use this for:

- Root App component
- Platform provider
- Application stores
- UI components

### `@we/app-framework/shared/index.scss`

Shared styles and design system imports.

## Key Features

### Platform Abstraction

Write once, run anywhere. The platform adapter system allows the same UI code to work across web, Electron, and Tauri with only the connection logic changing.

### State Management

Built-in stores for:

- **AdamStore**: AD4M client, authentication, agent management
- **SpacesStore**: Perspective management
- **ThemeStore**: UI theme switching

### Embedded Apps Support

Desktop platforms can expose AD4M credentials to embedded iframes using the `getConnectionDetails()` method. See [`../../apps/EMBEDDING.md`](../../apps/EMBEDDING.md) for details.

### Design System Integration

Automatically imports the entire WE design system:

- Tokens (CSS variables)
- Themes
- Elements
- Components
- Widgets
- Pages
- Templates

## Development

### Building

```bash
pnpm build
```

This uses `tsup` to compile TypeScript and generate type definitions.

### Used By

- `@we/we-web` - Web launcher
- `@we/we-electron` - Electron desktop launcher
- `@we/we-tauri` - Tauri desktop launcher

## Related Packages

- `@we/components` - Reusable UI components
- `@we/primitives` - Base UI primitives
- `@we/models` - Shared data models
- `@we/design-system-types` - Design system type definitions

## License

MIT
