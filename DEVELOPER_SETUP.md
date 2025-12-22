# WE Developer Setup Guide

This guide explains how to set up the WE workspace for development or production builds.

## Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Rust and Cargo (for AD4M and Tauri)
- Yarn (for Flux)

## Quick Start

### 1. Clone Repositories

```bash
# Clone all required repositories
git clone https://github.com/your-org/we.git
git clone https://github.com/your-org/flux.git
git clone https://github.com/your-org/ad4m.git

# Your directory structure should look like:
# Coding/
#   ├── we/
#   ├── flux/
#   └── ad4m/
```

### 2. Build External Dependencies

```bash
# Build AD4M executor (required for Electron and Tauri)
cd ad4m
cargo build --release
# This creates: target/release/ad4m-executor (~350MB)

# Build Flux app (required for all platforms)
cd ../flux/app
yarn install
yarn build
# This creates: dist/ folder with built app
```

### 3. Configure WE Seed File

```bash
cd ../../we
nano we-seed.json  # Or use your favorite editor
```

**Edit the paths in `we-seed.json`:**

```json
{
  "ad4m": {
    "repoPath": "../ad4m", // Path to AD4M repo
    "executorPath": "../ad4m/target/release/ad4m-executor"
  },
  "apps": [
    {
      "id": "flux",
      "paths": {
        "projectRoot": "../flux/app",
        "dist": "../flux/app/dist" // Path to built Flux app
      }
    }
  ]
}
```

**Note:** All paths are relative to the `we/` directory.

### 4. Run Setup

```bash
# From the we/ directory
pnpm setup
```

This single command:

- ✅ Installs all dependencies
- ✅ Validates your seed configuration
- ✅ Checks external dependencies exist
- ✅ Builds all internal WE packages
- ✅ Generates platform-specific configurations

### 5. Start Developing!

```bash
# Choose your platform:
pnpm dev:web       # Web development server
pnpm dev:electron  # Electron development mode
pnpm dev:tauri     # Tauri development mode
```

## Build for Production

```bash
# Build specific platform
pnpm build:web
pnpm build:electron  # Creates AppImage in apps/we-electron/release/
pnpm build:tauri     # Creates AppImage in apps/we-tauri/src-tauri/target/release/bundle/

# Or build everything
pnpm build:all
```

## Available Commands

### Root Commands (run from `we/` directory)

| Command               | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| `pnpm setup`          | Complete workspace setup (run after clone or seed changes) |
| `pnpm validate`       | Validate seed file configuration                           |
| `pnpm dev`            | Start web dev (same as `dev:web`)                          |
| `pnpm dev:web`        | Start web development server                               |
| `pnpm dev:electron`   | Start Electron in dev mode                                 |
| `pnpm dev:tauri`      | Start Tauri in dev mode                                    |
| `pnpm build`          | Build all packages                                         |
| `pnpm build:web`      | Build web distribution                                     |
| `pnpm build:electron` | Build Electron AppImage                                    |
| `pnpm build:tauri`    | Build Tauri AppImage                                       |
| `pnpm build:all`      | Build all distributions                                    |

### Per-App Commands

You can also run commands directly from each app directory:

```bash
# Web
cd apps/we-web
pnpm dev
pnpm build

# Electron
cd apps/we-electron
pnpm electron:dev
pnpm electron:build

# Tauri
cd apps/we-tauri
pnpm tauri:dev
pnpm tauri:build
```

## Architecture

### Single Source of Truth

The `we-seed.json` file is the **single source of truth** for all configuration:

- App definitions (name, routes, paths)
- Port assignments
- AD4M paths
- Build resources

All platform-specific files are **auto-generated** from this seed file:

**Electron:**

- `apps/we-electron/electron/seed-servers.js`
- `apps/we-electron/electron/seed-port-map.json`
- `apps/we-electron/electron/seed-extra-resources.json`
- `apps/we-electron/electron-builder.config.js`

**Tauri:**

- `apps/we-tauri/src-tauri/Cargo.toml` (from template)
- `apps/we-tauri/src-tauri/src/generated/seed_servers.rs`
- `apps/we-tauri/src-tauri/src/generated/seed-port-map.json`
- `apps/we-tauri/src/generated/seed-port-map.json`

**Never edit generated files directly** - they are overwritten on every build.

## Troubleshooting

### "AD4M executor not found"

Build AD4M first:

```bash
cd ad4m
cargo build --release
```

### "Flux dist not found"

Build Flux first:

```bash
cd flux/app
yarn install
yarn build
```

### "Cargo.toml not found" (Tauri)

Run the generator:

```bash
cd apps/we-tauri
node scripts/generate-seed-config.cjs
```

Or just run `pnpm setup` from the root.

### Validation Errors

Check your paths:

```bash
pnpm validate
```

This will show exactly what's missing or incorrect.

## Project Structure

```
we/
├── we-seed.json                  # Single source of truth
├── package.json                  # Root orchestrator
├── scripts/
│   ├── setup-workspace.cjs       # Setup automation
│   └── validate-seed.cjs         # Validation tool
├── packages/
│   ├── app-framework/            # Core framework
│   └── cli/                      # Build tooling
└── apps/
    ├── we-web/                   # Web app
    ├── we-electron/              # Electron app
    │   ├── electron/
    │   └── scripts/
    │       └── generate-seed-config.cjs
    └── we-tauri/                 # Tauri app
        ├── src-tauri/
        │   ├── Cargo.toml.template
        │   └── src/generated/    # Auto-generated (gitignored)
        └── scripts/
            └── generate-seed-config.cjs
```

## Development Workflow

1. **Initial Setup** (once):

   ```bash
   # Build external deps
   cd ad4m && cargo build --release
   cd ../flux/app && yarn install && yarn build

   # Setup WE
   cd ../../we
   pnpm install
   nano we-seed.json  # Configure paths
   pnpm setup
   ```

2. **Daily Development**:

   ```bash
   cd we
   pnpm dev:tauri  # or electron, or web
   ```

3. **After Pulling Changes**:

   ```bash
   pnpm install  # Update dependencies
   pnpm setup    # Regenerate configs
   ```

4. **After Changing Seed File**:
   ```bash
   pnpm setup    # Regenerate all configs
   ```

## Tips

- **Web development** doesn't require AD4M or Flux to be built
- **Electron and Tauri** need both AD4M executor and app dist folders
- Run `pnpm validate` to check if everything is configured correctly
- Run `pnpm setup` after any seed file changes
- All paths in seed file are relative to the `we/` directory

## Support

For issues or questions, please open an issue on GitHub.
