# AD4M Launcher Development

## Repository Structure

This project uses relative paths to access the AD4M monorepo. The structure that works with the current paths is:

```
/path/to/projects/
├── we/           (this repo)
└── ad4m/         (AD4M monorepo - required)
```

### Optional: Flux Integration Example

The Flux app integration serves as an example of how to embed external apps:

```
/path/to/projects/
├── we/           (this repo)
├── ad4m/         (AD4M monorepo - required)
└── flux/         (Flux monorepo - optional example)
```

**If your repositories are in a different location**, update the paths in the files listed below.

## Local Path Dependencies

The following files contain relative paths to external repositories:

### Required (AD4M)

- **src-tauri/Cargo.toml** → `../../../../ad4m/rust-client` and `../../../../ad4m/rust-executor`

### Optional (Flux integration example)

- **package.json** → `../../../flux/app/dist` (for Flux dev server)
- **src-tauri/tauri.conf.json** → `../../../../flux/app/dist` (for Flux production bundle)

If you organize your repositories differently, you'll need to update these paths manually.

## Development Workflow

### Running with Flux Integration (Example)

```bash
pnpm tauri:flux
```

This command:

1. Starts a Python HTTP server to serve the Flux app (`../../../flux/app/dist` on port 4173)
2. Starts the Tauri dev server in release mode

### Running without Flux

```bash
pnpm tauri:dev
```

This starts just the Tauri app with AD4M integration, without the Flux example.

## Building for Production

```bash
pnpm tauri:build
```

If the Flux integration is set up, this will bundle the Flux app (from `../../../flux/app/dist`) into the production build using Tauri's resource bundling.

## Embedding Your Own Apps

The Flux integration demonstrates how to embed external apps in the launcher. To embed your own app:

1. Build your app to a `dist` directory
2. Update `package.json` scripts to serve your app on a local port
3. Update `src-tauri/tauri.conf.json` resources to bundle your app for production
4. Update the schema to point the iframe to your app's URL
