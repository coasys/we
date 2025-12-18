# WE Seed System

The WE Seed System allows external applications to define integration configurations through JSON seed files. These seed files can be processed to automatically generate integration code for embedding apps into WE launchers.

## Overview

Instead of manually creating integration code in the WE repository, external developers can:

1. Create a `we-seed.json` file in their app repository
2. Run the WE seed processor to generate integration code
3. Build custom WE launchers with their app embedded

## Seed File Structure

A WE seed file is a JSON configuration that describes how to integrate an external app:

```typescript
interface WeSeedFile {
  project: {
    name: string; // Application name
    version: string; // Semantic version
    description: string; // Brief description
    author: string; // Author or organization
    repository?: string; // Repository URL
    license?: string; // License (SPDX)
  };

  paths: {
    projectRoot: string; // Root directory (relative to seed file)
    ad4mRoot?: string; // AD4M data directory
    dist: string; // Build output directory
    devServer?: {
      port: number;
      host?: string;
    };
  };

  commands: {
    install: string; // Install dependencies (use your package manager: npm, yarn, pnpm, bun, etc.)
    build: string; // Production build command
    dev: string; // Development server command
    clean?: string; // Cleanup command (optional)
  };

  ui?: {
    templates?: Record<string, any>; // Custom UI schemas
    theme?: {
      // Theme overrides
      colors?: Record<string, string>;
      fonts?: Record<string, string>;
    };
    routes?: Array<{
      // Custom routes
      path: string;
      component: string;
    }>;
    components?: Record<string, string>; // Component registry
  };

  ad4m?: {
    ai?: {
      enabled: boolean;
      config?: Record<string, any>;
    };
    perspectives?: Array<{
      name: string;
      uuid?: string;
    }>;
    languages?: Array<{
      name: string;
      address?: string;
    }>;
    executor?: {
      config?: Record<string, any>;
    };
  };

  integration: {
    mount: string; // Mount point (e.g., "flux")
    capabilities: Array<
      // Required capabilities
      'perspectives' | 'languages' | 'agents' | 'filesystem' | 'network'
    >;
    platforms: Array<
      // Supported platforms
      'electron' | 'tauri' | 'web'
    >;
    entry?: string; // Entry point file
  };
}
```

## Example Seed Files

### Minimal Example

```json
{
  "project": {
    "name": "My App",
    "version": "1.0.0",
    "description": "A simple integrated app",
    "author": "Developer"
  },
  "paths": {
    "projectRoot": "./",
    "dist": "dist"
  },
  "commands": {
    "install": "pnpm install",
    "build": "pnpm build",
    "dev": "pnpm dev"
  },
  "integration": {
    "mount": "myapp",
    "capabilities": [],
    "platforms": ["web"]
  }
}
```

### Full Example (Flux)

```json
{
  "project": {
    "name": "Flux",
    "version": "1.0.0",
    "description": "Social communication platform built on AD4M",
    "author": "Flux Team",
    "repository": "https://github.com/fluxapp/flux",
    "license": "MIT"
  },
  "paths": {
    "projectRoot": "./",
    "dist": "dist",
    "devServer": {
      "port": 5173,
      "host": "localhost"
    }
  },
  "commands": {
    "install": "yarn install",
    "build": "yarn build",
    "dev": "yarn dev",
    "clean": "yarn clean"
  },
  "ui": {
    "theme": {
      "colors": {
        "primary": "#6366f1",
        "secondary": "#8b5cf6"
      }
    },
    "routes": [
      {
        "path": "/flux",
        "component": "FluxMain"
      },
      {
        "path": "/flux/chat/:channelId",
        "component": "FluxChat"
      }
    ]
  },
  "ad4m": {
    "ai": {
      "enabled": true,
      "config": {
        "model": "gpt-4"
      }
    },
    "perspectives": [
      {
        "name": "Flux Channels"
      }
    ],
    "languages": [
      {
        "name": "flux-message-language"
      }
    ]
  },
  "integration": {
    "mount": "flux",
    "capabilities": ["perspectives", "languages", "agents"],
    "platforms": ["electron", "tauri", "web"],
    "entry": "index.html"
  }
}
```

> **Note on Package Managers**: The seed system is package-manager agnostic. Use whatever your app uses (npm, yarn, pnpm, bun, etc.) in the `commands` field. The examples above show different package managers - choose what works for your project.

## Usage

### CLI Tool

```bash
# Validate a seed file
npx we-seed ./we-seed.json --validate

# Generate integration code
npx we-seed ./we-seed.json --output ./integrations

# Process with verbose output
npx we-seed ./we-seed.json --verbose
```

### Programmatic API

```typescript
import { loadSeed, processSeed, validateSeed } from '@coasys/app-framework/seed';

// Validate
const seed = await loadSeed('./we-seed.json');
const validation = validateSeed(seed);

if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}

// Process and generate
const result = await processSeed(seed);
console.log('Generated integration:', result.metadata.integrationId);
```

## Workflow for External Developers

1. **Clone WE Repository**

   ```bash
   git clone https://github.com/coasys/we.git
   cd we
   pnpm install
   ```

2. **Create Seed File**

   In your app repository, create `we-seed.json`:

   ```json
   {
     "project": { ... },
     "paths": { ... },
     "commands": { ... },
     "integration": { ... }
   }
   ```

3. **Generate Integration**

   ```bash
   # From your app directory
   npx we-seed ./we-seed.json --output ../we/packages/app-framework/src/shared/schemas/integrations
   ```

4. **Build Custom Launcher**
   ```bash
   cd ../we
   pnpm build
   ```

## Generated Files

When you process a seed file, the following files are generated:

```
packages/app-framework/src/shared/schemas/integrations/{app-id}/
├── schemas.ts      # UI schema definitions
├── routes.ts       # Route configurations
├── manifest.ts     # Integration manifest
└── metadata.json   # Processing metadata
```

## Platform Adapters

The seed system integrates with platform adapters to detect the environment:

```typescript
// Automatically detects platform and environment
if (adapter.isDevelopment) {
  // Load from dev server
  loadApp(`http://localhost:${seed.paths.devServer.port}`);
} else {
  // Load from build output
  loadApp(seed.paths.dist);
}
```

## Benefits

- **No WE Code Changes**: External apps don't modify WE source
- **Reproducible**: Same seed file generates consistent integration
- **Shareable**: Seed files can be versioned and shared
- **Type-Safe**: Full TypeScript support with validation
- **Platform Agnostic**: Works with Electron, Tauri, and web

## Future Enhancements

- Auto-detection of package managers
- Support for monorepo configurations
- Integration testing utilities
- Hot-reload for development
- Schema migration tools
- Integration marketplace

## See Also

- [Examples](./examples.ts) - Example seed file configurations
- [Validator](./validator.ts) - Seed file validation logic
- [Processor](./processor.ts) - Code generation implementation
