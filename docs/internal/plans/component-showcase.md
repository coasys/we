# Component Development & Showcase Strategy

## Overview

This document outlines the recommended approach for component development tooling, enabling both external developers and core team members to efficiently create, preview, and share multi-framework components.

## Recommended Approach: Standalone Component Showcase Package ✅

Create a lightweight dev tool that developers can install independently, without needing to clone the full WE repository.

### Quick Start for Developers

```bash
# Create a new component
pnpm create @we/component my-awesome-card

# This scaffolds:
my-awesome-card/
├── /src
│   ├── Card.solid.tsx
│   ├── Card.react.tsx
│   ├── Card.shared.ts
│   └── Card.stories.ts
├── package.json
├── README.md
└── .we/
    └── showcase.config.ts

# Start development
cd my-awesome-card
pnpm install
pnpm dev
# → Opens http://localhost:3000 with live component preview
```

## Package Structure

### @we/component-showcase (npm package)

```
@we/component-showcase/
├── /bin
│   └── showcase.js              # CLI tool
├── /templates
│   └── component-starter/       # Scaffolding templates
├── /dev-server
│   ├── server.ts               # Local dev server
│   ├── hot-reload.ts           # HMR support
│   └── iframe-renderer.ts      # Component isolation
├── /ui
│   ├── ShowcaseApp.tsx         # The showcase UI
│   └── components/
└── package.json
```

### Package Configuration

```json
{
  "name": "@we/component-showcase",
  "version": "1.0.0",
  "description": "Development tool for WE components",
  "bin": {
    "showcase": "./bin/showcase.js",
    "we-component": "./bin/showcase.js"
  },
  "exports": {
    "./dev": "./dist/dev-server/index.js",
    "./cli": "./bin/showcase.js"
  },
  "dependencies": {
    "vite": "^5.0.0",
    "chokidar": "^3.5.3",
    "commander": "^11.0.0",
    "@vitejs/plugin-react": "^4.2.0",
    "vite-plugin-solid": "^2.8.0",
    "@vitejs/plugin-vue": "^5.0.0"
  },
  "peerDependencies": {
    "solid-js": "^1.9.0",
    "react": "^18.0.0",
    "vue": "^3.0.0"
  },
  "peerDependenciesMeta": {
    "solid-js": { "optional": true },
    "react": { "optional": true },
    "vue": { "optional": true }
  }
}
```

## Component Configuration

```typescript
// .we/showcase.config.ts
export default {
  components: './src/**/*.{solid,react,vue}.tsx',
  frameworks: ['solid', 'react', 'vue'],
  port: 3000,

  // Optional: Connect to WE design system
  designSystem: '@we/design-system',

  // Optional: Custom props for testing
  fixtures: './fixtures/',

  // Optional: Integration tests
  tests: './tests/',
};
```

## Developer Scripts

```json
{
  "name": "@username/my-component",
  "scripts": {
    "dev": "showcase dev",
    "build": "showcase build",
    "test": "showcase test",
    "publish": "showcase publish"
  },
  "devDependencies": {
    "@we/component-showcase": "^1.0.0"
  }
}
```

## CLI Tool

```typescript
// @we/component-showcase/bin/showcase.js
#!/usr/bin/env node

import { Command } from 'commander';
import { startDevServer } from '../dev-server';
import { buildComponent } from '../builder';
import { publishComponent } from '../publisher';

const program = new Command();

program
  .name('showcase')
  .description('WE Component Showcase - develop and share components')
  .version('1.0.0');

program
  .command('dev')
  .description('Start development server')
  .option('-p, --port <port>', 'Port number', '3000')
  .action(async (options) => {
    const config = await loadConfig();
    await startDevServer({ ...config, port: options.port });
  });

program
  .command('build')
  .description('Build component for distribution')
  .action(async () => {
    await buildComponent();
  });

program
  .command('publish')
  .description('Publish component to npm')
  .action(async () => {
    await publishComponent();
  });

program
  .command('create <name>')
  .description('Create a new component')
  .option('-f, --frameworks <frameworks>', 'Frameworks to support', 'solid,react')
  .action(async (name, options) => {
    await scaffoldComponent(name, options.frameworks.split(','));
  });

program.parse();
```

## Dev Server Implementation

```typescript
// @we/component-showcase/src/dev-server/server.ts
import { createServer } from 'vite';
import { watch } from 'chokidar';

export async function startDevServer(config: ShowcaseConfig) {
  // 1. Discover components
  const components = await discoverComponents(config.components);

  // 2. Start Vite server with framework plugins
  const server = await createServer({
    plugins: [solidPlugin(), reactPlugin(), vuePlugin()],
    server: {
      port: config.port,
    },
  });

  // 3. Watch for changes
  const watcher = watch(config.components);
  watcher.on('change', (path) => {
    console.log(`Component updated: ${path}`);
    // Trigger HMR
    server.ws.send({
      type: 'custom',
      event: 'component-update',
      data: { path },
    });
  });

  // 4. Serve showcase UI
  await server.listen();
  console.log(`Showcase running at http://localhost:${config.port}`);
}
```

```typescript
// Component discovery
export async function discoverComponents(pattern: string) {
  const files = await glob(pattern);

  return files.map((file) => {
    const framework = file.match(/\.(solid|react|vue)\.tsx?$/)?.[1];
    const componentName = path.basename(file, path.extname(file));

    return {
      name: componentName,
      framework,
      path: file,
    };
  });
}
```

## Component Scaffolding

```typescript
// @we/component-showcase/src/scaffolder/index.ts
export async function scaffoldComponent(name: string, frameworks: Framework[]) {
  const projectDir = `./${name}`;

  // Create directory structure
  await fs.mkdir(projectDir, { recursive: true });

  // Copy base template
  await copyTemplate('component-base', projectDir);

  // Generate framework files
  for (const framework of frameworks) {
    await generateComponentFile(name, framework, projectDir);
  }

  // Generate package.json
  await generatePackageJson(name, frameworks, projectDir);

  // Generate README
  await generateReadme(name, frameworks, projectDir);

  console.log(`✅ Created ${name} with ${frameworks.join(', ')} support`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${name}`);
  console.log(`  pnpm install`);
  console.log(`  pnpm dev`);
}
```

## Showcase UI Features

The showcase provides developers with:

### 1. Live Component Preview

- Side-by-side framework comparison (Solid, React, Vue, Svelte)
- View modes: single, split, or all frameworks
- Responsive preview (mobile, tablet, desktop)
- Isolated rendering in iframes to prevent style conflicts

### 2. Interactive Props Editor

- Visual form-based editor
- JSON editor for advanced users
- Live updates as you edit
- Type hints from TypeScript definitions

### 3. Code Viewer

- Syntax highlighted source code
- Switch between framework implementations
- Copy to clipboard
- Highlight recent changes

### 4. Testing Integration

- Visual regression testing
- Accessibility checks (a11y)
- Performance metrics (render time, bundle size)
- Interactive testing with props variations

### 5. Documentation

- Auto-extracted from JSDoc comments
- Usage examples
- Props table with types
- Framework compatibility matrix

## Showcase UI Implementation

```typescript
// Component with inline documentation
/**
 * @component Button
 * @category Buttons
 * @description Primary action button with variants
 *
 * @example
 * <Button variant="primary" onClick={handleClick}>
 *   Click me
 * </Button>
 */
export function Button(props: ButtonProps) {
  return <we-button {...props} />;
}
```

```typescript
// src/components/ShowcaseLayout.tsx
import { For, createSignal } from 'solid-js';

export function ShowcaseLayout() {
  const [selectedFramework, setSelectedFramework] = createSignal<Framework>('solid');
  const [viewMode, setViewMode] = createSignal<'single' | 'split' | 'all'>('single');

  return (
    <div class="showcase-layout">
      {/* Header */}
      <header>
        <h1>WE Component Showcase</h1>
        <div class="controls">
          {/* Framework selector */}
          <FrameworkSelector
            selected={selectedFramework()}
            onChange={setSelectedFramework}
          />

          {/* View mode toggle */}
          <ViewModeToggle
            mode={viewMode()}
            onChange={setViewMode}
          />
        </div>
      </header>

      {/* Main content */}
      <main>
        <ComponentGrid viewMode={viewMode()} framework={selectedFramework()} />
      </main>
    </div>
  );
}
```

## Starter Template via `pnpm create`

```bash
# Similar to create-vite, create-next-app
pnpm create @we/component my-card
```

```typescript
// packages/create-we-component/index.ts
#!/usr/bin/env node

import { scaffoldComponent } from '@we/component-showcase/scaffolder';

const componentName = process.argv[2];
if (!componentName) {
  console.error('Please provide a component name');
  process.exit(1);
}

// Interactive prompts
const answers = await prompts([
  {
    type: 'multiselect',
    name: 'frameworks',
    message: 'Which frameworks do you want to support?',
    choices: [
      { title: 'Solid', value: 'solid', selected: true },
      { title: 'React', value: 'react' },
      { title: 'Vue', value: 'vue' },
      { title: 'Svelte', value: 'svelte' },
    ],
  },
  {
    type: 'select',
    name: 'category',
    message: 'Component category?',
    choices: [
      { title: 'Button', value: 'buttons' },
      { title: 'Card', value: 'cards' },
      { title: 'Form', value: 'forms' },
      { title: 'Layout', value: 'layout' },
      { title: 'Other', value: 'other' },
    ],
  },
]);

await scaffoldComponent(componentName, {
  frameworks: answers.frameworks,
  category: answers.category,
});
```

## Developer Workflows

### External Developer (Creating New Component)

```bash
# 1. Create component
pnpm create @we/component awesome-button
cd awesome-button

# 2. Develop with live preview
pnpm dev
# → Opens showcase at localhost:3000

# 3. See all framework versions side-by-side
# → Edit Button.solid.tsx → see live update
# → Edit Button.react.tsx → see live update

# 4. Test with different props
# → Built-in props editor in showcase

# 5. Build for distribution
pnpm build
# → Creates dist/ with all framework bundles

# 6. Publish to npm
pnpm publish
```

### Core Team (Contributing to WE)

```bash
# 1. Clone repo
git clone https://github.com/jhweir/we.git
cd we

# 2. Focus on specific component
cd packages/design-system/4-components
pnpm showcase dev --component PostCard --frameworks solid,react

# 3. See component in context of full design system
pnpm dev  # Starts full app with all components
```

## Hybrid Approach: Best of Both Worlds

### For External Developers (Recommended)

```bash
# Use standalone tool
pnpm create @we/component my-card

# Auto-includes lightweight showcase
my-card/
├── src/
├── package.json
└── node_modules/
    └── @we/component-showcase/  # Self-contained
```

### For Core Team / Contributors

```bash
# Clone full repo for deeper integration
git clone https://github.com/jhweir/we.git

# But still use showcase tool for focused development
cd packages/design-system/4-components
pnpm showcase dev --component PostCard
```

## Package Ecosystem

```
@we/component-showcase      # Main dev tool
@we/create-component        # Scaffolding CLI (pnpm create)
@we/component-validator     # Validates component structure
@we/component-marketplace   # Optional: browse/share components
```

## Benefits Summary

**Why build a standalone showcase package:**

1. ✅ **Lightweight** - developers don't need full WE repo
2. ✅ **Fast setup** - `pnpm create @we/component` and start coding
3. ✅ **Self-contained** - includes everything needed for development
4. ✅ **Multi-framework** - supports all frameworks out of the box
5. ✅ **Live preview** - instant feedback while coding
6. ✅ **Easy publishing** - built-in npm publish workflow
7. ✅ **Community friendly** - lowers barrier to contribution
8. ✅ **Works both ways** - external devs AND core team can use it

## Implementation Priority

### Phase 1: Core Infrastructure

- [ ] Create `@we/component-showcase` package
- [ ] Implement dev server with Vite
- [ ] Add basic component discovery
- [ ] Build simple preview UI

### Phase 2: Developer Experience

- [ ] Add `pnpm create @we/component` scaffolding
- [ ] Implement HMR for live updates
- [ ] Add props editor
- [ ] Add code viewer

### Phase 3: Multi-Framework Support

- [ ] Add Solid plugin
- [ ] Add React plugin
- [ ] Add Vue plugin
- [ ] Add Svelte plugin

### Phase 4: Advanced Features

- [ ] Visual regression testing
- [ ] Accessibility checks
- [ ] Performance metrics
- [ ] Documentation extraction

### Phase 5: Community Features

- [ ] Component marketplace
- [ ] Publishing automation
- [ ] Version management
- [ ] Discovery/search

## Getting Started

To start using the component showcase (once implemented):

```bash
# Install globally
npm install -g @we/component-showcase

# Or use directly with pnpm create
pnpm create @we/component my-component

# Start developing
cd my-component
pnpm dev
```

This approach makes it **super easy** for developers to create, preview, test, and share multi-framework components with the WE community! 🚀
