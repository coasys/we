# WE Tauri Development

## Prerequisites

### Required: AD4M Monorepo

This project uses relative paths to access the AD4M monorepo. The structure that works with the current paths is:

```
/path/to/projects/
├── we/           (this repo)
└── ad4m/         (AD4M monorepo - required)
```

**If your repositories are in a different location**, update the paths in `src-tauri/Cargo.toml`:

- `../../../../ad4m/rust-client`
- `../../../../ad4m/rust-executor`

## Development Workflow

### Running the Launcher

```bash
pnpm tauri:dev
```

This starts the Tauri app with AD4M integration.

## Building for Production

```bash
pnpm tauri:build
```

This creates a production build. If embedded apps (like Flux) are configured, they will be bundled using Tauri's resource system.

## Optional: Embedding External Apps

The Tauri launcher can embed external apps via iframe. This section uses Flux as an example, but the pattern works for any app.

### 1. Repository Structure

```
/path/to/projects/
├── we/           (this repo)
├── ad4m/         (AD4M monorepo - required)
└── flux/         (Flux monorepo - optional example)
```

### 2. Configure Paths

Update these files to point to your embedded app:

**package.json** → `../../../flux/app/dist` (for dev server)
**src-tauri/tauri.conf.json** → `../../../../flux/app/dist` (for production bundle)

### 3. Build Your Embedded App

```bash
cd ../../../flux/app
pnpm install
pnpm build
```

### 4. Development

Simply run `pnpm tauri:dev` as shown above. The launcher will look for embedded apps in the configured paths.

### 5. Integration Protocol

Embedded apps receive AD4M credentials via postMessage. See [`embedding-external-apps.md`](../../docs/guides/embedding-external-apps.md) for the complete protocol and implementation details.

### 6. Tauri-Specific Notes

**Screen Sharing:** Works natively in Tauri without polyfills (unlike Electron).

**Resource Bundling:** Embedded apps are bundled at build time via `tauri.conf.json` resources configuration.

**Development:** The Tauri dev server will serve embedded apps from the configured paths. Make sure your embedded app is built before running `pnpm tauri:dev`.

## Embedding Your Own Apps

To embed your own app (not Flux):

1. Build your app to a `dist` directory
2. Update `package.json` scripts to serve your app on a local port (for dev)
3. Update `src-tauri/tauri.conf.json` resources to bundle your app (for production)
4. Implement the postMessage protocol in your app (see `../../docs/guides/embedding-external-apps.md`)
5. Update the launcher's routing to display your app's iframe
