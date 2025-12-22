# WE Seed System

The seed system allows developers to build custom launchers by defining a `we-seed.json` file that specifies which applications to embed and how to configure the launcher.

## Overview

A **seed file** is a JSON configuration that defines:

- Project metadata (name, version, author)
- Host customization (theme colors, UI overrides)
- Embedded applications (paths, capabilities, commands)

The launcher automatically adapts based on the number of apps:

- **Single app**: Full-screen layout (no sidebar)
- **Multiple apps**: Sidebar navigation + app routing

## Quick Start

### 1. Clone Required Repositories

```bash
# Clone the WE framework
git clone https://github.com/yourusername/we.git

# Clone applications you want to embed
git clone https://github.com/juntofoundation/flux.git
git clone https://github.com/yourusername/my-app.git
```

### 2. Create a Seed File

Create `we/we-seed.json`:

```json
{
  "project": {
    "name": "My Custom Launcher",
    "version": "1.0.0",
    "description": "A custom launcher with my favorite apps",
    "author": "Your Name"
  },
  "host": {
    "theme": {
      "colors": {
        "primary": "#667eea",
        "secondary": "#764ba2"
      }
    }
  },
  "ad4m": {},
  "apps": [
    {
      "id": "flux",
      "name": "Flux",
      "route": "/flux",
      "capabilities": ["perspectives", "languages", "agents"],
      "paths": {
        "projectRoot": "../flux/app",
        "dist": "../flux/app/dist",
        "devServer": {
          "port": 3030,
          "host": "localhost"
        }
      },
      "commands": {
        "install": "yarn install",
        "build": "yarn build",
        "dev": "yarn dev"
      }
    }
  ]
}
```

### 3. Build and Run

```bash
cd we
pnpm install
pnpm build
cd apps/we-web
pnpm dev
```

Open http://localhost:3000 to see your launcher!

## Seed File Schema

### Project Section

```json
{
  "project": {
    "name": "string", // Required: Display name
    "version": "string", // Required: Semantic version
    "description": "string", // Optional: Description
    "author": "string" // Required: Author name
  }
}
```

### Host Section

```json
{
  "host": {
    "theme": {
      "colors": {
        "primary": "#hex", // Primary brand color
        "secondary": "#hex", // Secondary accent
        "background": "#hex", // Background color
        "text": "#hex" // Text color
      }
    }
  }
}
```

### Apps Section

Each app in the `apps` array:

```json
{
  "id": "string", // Required: Unique identifier
  "name": "string", // Required: Display name
  "route": "/path", // Required: Route path (e.g., /flux)
  "capabilities": [], // Required: AD4M capabilities (see below)
  "paths": {
    "projectRoot": "string", // Path to app's project root
    "dist": "string", // Path to built app (production)
    "devServer": {
      "port": 3000, // Dev server port
      "host": "localhost" // Dev server host
    }
  },
  "commands": {
    "install": "string", // Install command (npm/yarn/pnpm)
    "build": "string", // Build command
    "dev": "string" // Dev server command
  }
}
```

## Capabilities

Available AD4M capabilities:

- `perspectives` - Access to AD4M perspectives
- `languages` - Language management
- `agents` - Agent operations
- `filesystem` - File system access
- `network` - Network requests

Capabilities automatically configure iframe permissions (camera, microphone, etc.).

## Single vs Multi-App Mode

### Single App (Full-Screen)

When `apps` array has **1 app**:

- App loads at root route `/`
- No sidebar or navigation
- 100% viewport width/height
- Ideal for standalone launchers

### Multiple Apps (Sidebar)

When `apps` array has **2+ apps**:

- Sidebar (100px) with navigation buttons
- Each app has its own route
- Click sidebar buttons to switch apps
- Content area fills remaining space

## Development Workflow

1. **Edit seed file**: Modify `we/we-seed.json`
2. **Rebuild**: `cd packages/app-framework && pnpm build`
3. **Restart dev server**: `cd apps/we-web && pnpm dev`
4. **See changes**: Refresh browser

## Example: Flux-Only Launcher

```json
{
  "project": {
    "name": "Flux Launcher",
    "version": "1.0.0",
    "author": "Your Name"
  },
  "host": {
    "theme": {
      "colors": {
        "primary": "#6366f1"
      }
    }
  },
  "ad4m": {},
  "apps": [
    {
      "id": "flux",
      "name": "Flux",
      "route": "/",
      "capabilities": ["perspectives", "languages", "agents"],
      "paths": {
        "projectRoot": "../flux/app",
        "dist": "../flux/app/dist",
        "devServer": { "port": 3030, "host": "localhost" }
      },
      "commands": {
        "install": "yarn install",
        "build": "yarn build",
        "dev": "yarn dev"
      }
    }
  ]
}
```

Result: Full-screen Flux at http://localhost:3000

## Example: Multi-App Launcher

```json
{
  "project": {
    "name": "My Multi-App Workspace",
    "version": "1.0.0",
    "author": "Your Name"
  },
  "host": {
    "theme": {
      "colors": {
        "primary": "#667eea",
        "secondary": "#764ba2"
      }
    }
  },
  "ad4m": {},
  "apps": [
    {
      "id": "flux",
      "name": "Flux",
      "route": "/flux",
      "capabilities": ["perspectives", "languages", "agents"],
      "paths": {
        "projectRoot": "../flux/app",
        "dist": "../flux/app/dist",
        "devServer": { "port": 3030, "host": "localhost" }
      },
      "commands": {
        "install": "yarn install",
        "build": "yarn build",
        "dev": "yarn dev"
      }
    },
    {
      "id": "my-app",
      "name": "My App",
      "route": "/my-app",
      "capabilities": [],
      "paths": {
        "projectRoot": "../my-app",
        "dist": "../my-app/dist",
        "devServer": { "port": 3040, "host": "localhost" }
      },
      "commands": {
        "install": "npm install",
        "build": "npm run build",
        "dev": "npm run dev"
      }
    }
  ]
}
```

Result: Sidebar with Flux and My App navigation

## Architecture

### How It Works

1. **Build time**: `initializeIntegrations.ts` imports `we-seed.json` via static import
2. **Module load**: Seed is validated and launcher template is generated
3. **Template registration**: Generated launcher replaces placeholder in `templateRegistry`
4. **Render time**: Template store reads registry and renders launcher
5. **Runtime**: Apps load in iframes with configured permissions

### File Structure

```
we/
  we-seed.json                     ← Your seed file (REQUIRED)
  packages/app-framework/src/
    shared/
      initializeIntegrations.ts    ← Loads seed, generates launcher
      integrationComposer.ts       ← Generates template from seed
      seedLoader.ts                ← (unused) Future async loading
      registries/
        templateRegistry.ts        ← Stores generated launcher
```

## Tips

- **Seed file location**: Must be at `we/we-seed.json` (workspace root)
- **Requires rebuild**: Changes require `pnpm build` in app-framework
- **Dev server ports**: Ensure no conflicts (Flux: 3030, WE: 3000, etc.)
- **Path resolution**: Relative paths are from workspace root (`we/`)

## Troubleshooting

**Launcher not updating?**

- Rebuild app-framework: `cd packages/app-framework && pnpm build`
- Restart dev server: `cd apps/we-web && pnpm dev`
- Hard refresh browser (Cmd/Ctrl + Shift + R)

**App not loading in iframe?**

- Check dev server is running (e.g., `cd flux/app && yarn dev`)
- Verify port in seed matches actual dev server port
- Check browser console for CORS/permission errors

**Sidebar not showing?**

- Ensure `apps` array has 2+ items
- Check console for "Generating multi-app launcher" message
- Verify each app has unique `route` value

## Future Enhancements

- Theme application (host.theme → design system colors)
- Template forking (customize launcher UI)
- Dynamic seed loading (hot-reload without rebuild)
- Seed validation CLI tool
- Production build support
