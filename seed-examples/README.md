# Seed Configuration Examples

This directory contains example seed configurations for different WE launcher setups.

## Usage

1. Copy the example you want to use:

   ```bash
   cp seed-examples/native-we-app.seed.json we-seed.json
   ```

2. Edit paths in `we-seed.json` to match your setup

3. Run setup:
   ```bash
   pnpm setup
   ```

## Available Examples

### `native-we-app.seed.json`

**Pure WE application** built with the design system and schema renderer.

- No embedded external apps
- Template switching enabled
- Build UIs from WE components and schemas
- Ideal for: Building decentralized apps from scratch

### `multi-app.seed.json`

**Multi-app launcher** with sidebar navigation.

- Multiple external apps (Flux + Playground)
- Sidebar navigation with iframe embedding
- Template switching disabled
- Ideal for: Bundling multiple existing apps

### `flux-only.seed.json`

**Single external app** in full-screen mode.

- Just Flux, no sidebar
- 100% viewport coverage
- Template switching disabled
- Ideal for: Dedicated launcher for one app

## Creating Your Own

1. Start with an example that's closest to your needs
2. Modify the `project` section (name, description, author)
3. Adjust `ad4m.dataPath` to avoid conflicts
4. Add/remove apps as needed
5. Customize `host.ui` for white-labeling

See [SEED-SYSTEM.md](../SEED-SYSTEM.md) for complete documentation.
