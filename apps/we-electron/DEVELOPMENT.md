# WE Electron Development

## Development Workflow

To run in development mode:

```bash
pnpm electron:dev
```

This will:

1. Start the Vite dev server on an available port (typically 3002)
2. Wait for the dev server to be ready
3. Launch Electron which will:
   - Start the AD4M executor on a free port (12000-13000)
   - Generate a unique credential token
   - Load the Vite dev server in the Electron window
   - Open DevTools automatically

## Building for Production

To build for production:

```bash
pnpm electron:build
```

This will:

1. Build the renderer with Vite
2. Package the app with Electron Builder
3. Include the executor binary and any embedded apps (like Flux)
4. Output to `dist-electron/`

The production build creates:

- AppImage for Linux
- Can be configured for Windows (NSIS) and Mac (DMG)

## Optional: Embedding External Apps (e.g., Flux)

The Electron launcher can embed external apps via iframe. Here's how to set up Flux as an example:

### 1. Repository Structure

```
/path/to/projects/
├── we/           (this repo)
├── ad4m/         (AD4M monorepo - required)
└── flux/         (Flux monorepo - optional)
```

### 2. Build Flux

```bash
cd ../../../flux/app
pnpm install
pnpm build
```

This creates `flux/app/dist/` which the Electron app will serve.

### 3. Development with Flux

The Electron app automatically serves Flux in production builds from the bundled resources. In development, you can:

**Option A: Use Flux dev server**

```bash
# Terminal 1: Start Flux dev server
cd ../../../flux/app
pnpm dev  # Runs on port 3030

# Terminal 2: Start Electron
cd we/apps/we-electron
pnpm electron:dev
```

**Option B: Use Flux production build**
Just build Flux once and the Electron app will serve it from `dist/`.

### 4. How It Works

**Development:**

- Launcher: Uses Vite dev server on available port (set via `VITE_DEV_SERVER_URL`)
- Flux iframe: `http://localhost:3030` (Flux dev server, if running)

**Production:**

- Launcher: `http://localhost:9080` (Express server)
- Flux iframe: `http://localhost:8080` (Express server)

Both are served via HTTP (not `file://`) to avoid cross-origin issues.

### 5. Development vs Production Mode

The app automatically detects whether it's running in development or production:

- **Development:** Uses `import.meta.env.DEV` from Vite (true in dev server, false in build)
- **Platform adapter** exposes `isDevelopment` flag to the app
- **Flux URL** switches automatically based on this flag:
  - Dev: `http://localhost:3030` (expects Flux dev server)
  - Prod: `http://localhost:8080` (serves bundled Flux)

This is configured in `LauncherTemplate.schema.ts` using conditional rendering based on `adamStore.isDevelopment`.

### 6. Screen Sharing in Embedded Apps

Electron requires special handling for `getDisplayMedia()` in iframes:

- A polyfill is automatically injected into embedded apps
- The polyfill uses Electron's `desktopCapturer` API
- Works by accessing parent window's `window.electron` API
- Requires `webSecurity: false` in BrowserWindow config

## Troubleshooting

### Electron Binary Not Downloading

If Electron fails to download its binary after `pnpm install`, this is due to pnpm workspace behavior with lifecycle scripts.

The `postinstall` script in `package.json` handles this automatically:

```json
"postinstall": "cd ../../node_modules/.pnpm/electron@*/node_modules/electron 2>/dev/null && node install.js || true"
```

This workaround ensures Electron's install script runs even in pnpm workspaces. The `.npmrc` file in the workspace root also enables lifecycle scripts with `enable-pre-post-scripts=true`.

### Login Hangs After HMR Update (Dev Mode)

If login hangs with a timeout after Hot Module Reload updates in dev mode:

**Cause:** HMR can break the WebSocket connection to the AD4M executor while keeping stale connection references.

**Solution:** Refresh the browser (Ctrl+R / Cmd+R) instead of relying on HMR after code changes that affect the Apollo client or WebSocket connections.

See `electron/main.js` for implementation details.

### 6. Integration Protocol

Embedded apps receive AD4M credentials via postMessage. See [`embedding-external-apps.md`](../../docs/guides/embedding-external-apps.md) for the complete protocol.

## Troubleshooting

### Executor Binary Not Found

Make sure you've built the AD4M executor:

```bash
cd ../../ad4m/cli
cargo build --release
```

### Embedded App Not Loading

Check the console for errors. Common issues:

- Flux not built (run `pnpm build` in flux/app)
- Wrong port configuration
- Missing postMessage request (see embedding-external-apps.md (docs/guides))

### Login Hangs After HMR Update (Dev Mode)

If login hangs with a timeout after Hot Module Reload updates in dev mode:

**Cause:** HMR can break the WebSocket connection to the AD4M executor while keeping stale connection references.

**Solution:** Refresh the browser (Ctrl+R / Cmd+R) instead of relying on HMR after code changes that affect the Apollo client or WebSocket connections.

### Electron Binary Not Downloading

If Electron fails to download its binary after `pnpm install`, this is due to pnpm workspace behavior with lifecycle scripts.

The `postinstall` script in `package.json` handles this automatically:

```json
"postinstall": "cd ../../node_modules/.pnpm/electron@*/node_modules/electron 2>/dev/null && node install.js || true"
```

This workaround ensures Electron's install script runs even in pnpm workspaces. The `.npmrc` file in the workspace root also enables lifecycle scripts with `enable-pre-post-scripts=true`.

### Screen Sharing Not Working

- Check that the polyfill is being injected (look for logs in console)
- Verify `webSecurity: false` in main.js
- Check that `window.electron.getDesktopSources` exists

### Build Fails

If the build fails, check:

- `package.json` extraResources paths are correct
- AD4M executor binary exists
- Flux dist folder exists (if bundling Flux)
