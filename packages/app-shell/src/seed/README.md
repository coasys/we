# WE Seed System

The WE Seed System allows external applications to define integration configurations through JSON seed files. These seed files can be processed to automatically generate integration code for embedding apps into WE launchers.

## Overview

Instead of manually creating integration code in the WE repository, external developers can:

1. Create a `we-seed.json` file in their app repository
2. Run the WE seed processor to generate integration code
3. Build custom WE launchers with their app embedded

## Seed File Structure

The seed's shape is defined once, in
[`../types/seed.ts`](../types/seed.ts) (`WeSeedFile`), and documented in
[`docs/getting-started/seed-system.md`](../../../../docs/getting-started/seed-system.md).
This README used to carry its own (different, drifted) copy of the schema —
deliberately removed: the seed had three mutually inconsistent descriptions,
and the type file is the one the validator actually enforces.

Example seeds live in [`seed-examples/`](../../../../seed-examples/) at the
workspace root.

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

## Integration Loader

After generating integration files, use the integration loader to dynamically load them at runtime:

```typescript
import { loadIntegrations, getIntegration, getIntegrationUrl } from '@we/app-shell';

// Load all integrations for current platform
const integrations = await loadIntegrations('electron'); // or 'tauri' or 'web'

// Get specific integration
const flux = await getIntegration('flux', 'electron');
if (flux) {
  console.log(flux.manifest.name); // "Flux"
  console.log(flux.schemas); // UI schemas
  console.log(flux.routes); // Route configs
}

// Get integration URL for current environment
const url = getIntegrationUrl(flux.manifest, isDevelopment, flux.metadata?.seed?.paths);
// Development: http://localhost:5173
// Production: app/dist
```

### Platform Adapters

The integration loader works seamlessly with platform adapters:

```typescript
import { loadIntegrations, getIntegrationUrl } from '@we/app-shell';

// In your platform adapter
async function loadExternalApps(platform: 'electron' | 'tauri' | 'web') {
  const integrations = await loadIntegrations(platform);

  for (const integration of integrations) {
    const url = getIntegrationUrl(integration.manifest, adapter.isDevelopment, integration.metadata?.seed?.paths);

    // Load the app
    if (adapter.isDevelopment) {
      loadApp(url); // http://localhost:5173
    } else {
      loadApp(url); // app/dist
    }
  }
}
```

### Capability Checking

Check if an integration has specific capabilities:

```typescript
import { hasCapability } from '@we/app-shell';

const flux = await getIntegration('flux', 'electron');
if (flux) {
  if (hasCapability(flux.manifest, 'perspectives')) {
    // Integration can access perspectives
  }

  if (hasCapability(flux.manifest, 'agents')) {
    // Integration can access agents
  }
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
