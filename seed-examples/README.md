# Seed Configuration Examples

This directory contains example seed configurations for different WE deployments.

## Usage

1. Copy the example closest to your needs:

   ```bash
   cp seed-examples/we-native.seed.json we-seed.json
   ```

2. Edit paths in `we-seed.json` to match your local setup

3. Run setup:
   ```bash
   pnpm setup-workspace
   ```

## Available Examples

### `we-native.seed.json`

**Pure WE app** — no embedded external apps.

- WE shell with templates only (sidebar, spaces, settings, etc.)
- Build UIs entirely from WE components and schemas
- Ideal for: building decentralized apps natively inside the WE design system

### `we-with-apps.seed.json`

**WE + embedded apps** — external apps alongside templates.

- WE shell with sidebar showing both templates and app icons
- Each app runs in a persistent iframe (CSS-toggled, never unmounted)
- Switching templates does not destroy app state / WebRTC sessions
- Ideal for: bundling one or more existing web apps (e.g. Flux) into the WE shell

## Creating Your Own

1. Start with an example that's closest to your needs
2. Update the `project` section (name, description, author)
3. Change `ad4m.dataPath` to avoid collisions with other WE instances
4. Add apps to the `apps` array — each needs `id`, `name`, `icon`, `paths.dist`, and `paths.devServer`

See the [seed type definitions](../packages/app-framework/src/types/seed.ts) for the full schema.
