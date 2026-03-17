# Component Framework Reorganization Strategy

## Overview

This document outlines the strategy for reorganizing the design system from a framework-first to a component-first structure, enabling better multi-framework support and community component integration.

## Current Structure

```
packages/design-system/4-components/
├── /shared
│   └── types.ts
└── /solid
    └── /components
        ├── PostCard.tsx
        ├── Column.tsx
        └── Row.tsx
```

## Proposed Structure

```
packages/design-system/4-components/
└── /components
    ├── /PostCard
    │   ├── PostCard.solid.tsx
    │   ├── PostCard.react.tsx
    │   ├── PostCard.vue.tsx
    │   └── PostCard.svelte.tsx
    ├── /Column
    │   ├── Column.solid.tsx
    │   ├── Column.react.tsx
    │   └── ...
    └── /Row
        ├── Row.solid.tsx
        └── ...
```

## Analysis

### ✅ Strong Arguments FOR Component-First Structure

#### 1. Community Package Pattern

```
@community/awesome-button/
├── Button.solid.tsx
├── Button.react.tsx
├── Button.vue.tsx
├── package.json
└── README.md
```

- Natural for third-party developers
- One package = one component concept
- Clear what you're getting

#### 2. Schema Renderer Framework Selection

```typescript
// In schema renderer
const framework = getCurrentFramework(); // 'solid' | 'react' | 'vue'

// Auto-resolve correct version
import(`@community/awesome-button/Button.${framework}.tsx`);
```

- Runtime framework detection
- Automatic version selection
- Seamless multi-framework support

#### 3. Documentation Co-location

```
/PostCard
├── PostCard.solid.tsx
├── PostCard.react.tsx
├── PostCard.stories.tsx      # Shared stories
├── PostCard.test.ts          # Shared test logic
├── README.md                 # Component docs
└── types.ts                  # Shared types
```

- Everything about PostCard in one place
- Easier to maintain consistency across frameworks
- Better for contributors (see all versions at once)

#### 4. Consistency Enforcement

- When updating PostCard, you see all framework versions
- Harder to forget to update one framework
- Props/types stay in sync naturally

#### 5. Community Marketplace Vision

```typescript
// User installs community component
pnpm add @johndoe/fancy-card

// Schema automatically uses correct version
{
  type: '@johndoe/fancy-card',
  props: { ... }
}
// ↓ Resolves to FancyCard.solid.tsx if using Solid
```

### ⚠️ Arguments AGAINST Current Framework-First Structure

#### 1. Framework Silos

- Solid devs only see Solid components
- React devs only see React components
- Hard to ensure feature parity

#### 2. Import Paths Get Awkward for Mixed Projects

```typescript
// Current
import { PostCard } from '@we/components/solid';
import { Button } from '@we/components/react'; // Can't mix?
```

#### 3. Community Package Mismatch

- Your structure: framework-first
- Their structure: component-first (naturally)
- Inconsistent patterns

## Recommendation: 🎯 Hybrid Approach

**Use component-first for the design system, but keep framework-specific entry points:**

```
packages/design-system/4-components/
├── /src
│   └── /components
│       ├── /PostCard
│       │   ├── PostCard.solid.tsx
│       │   ├── PostCard.react.tsx
│       │   ├── PostCard.shared.ts    # Shared logic/types
│       │   └── index.ts              # Re-exports
│       ├── /Column
│       │   ├── Column.solid.tsx
│       │   ├── Column.react.tsx
│       │   └── index.ts
│       └── /Row
│           └── ...
├── /solid
│   └── index.ts                      # export * from '../components/*/index.solid'
├── /react
│   └── index.ts                      # export * from '../components/*/index.react'
└── package.json
```

### Package Exports

```json
{
  "name": "@we/components",
  "exports": {
    "./solid": {
      "import": "./dist/solid/index.js",
      "types": "./dist/solid/index.d.ts"
    },
    "./react": {
      "import": "./dist/react/index.js",
      "types": "./dist/react/index.d.ts"
    },
    "./PostCard": {
      "solid": "./dist/components/PostCard/PostCard.solid.js",
      "react": "./dist/components/PostCard/PostCard.react.js",
      "types": "./dist/components/PostCard/PostCard.shared.d.ts"
    }
  }
}
```

### Usage Examples

```typescript
// Current way still works
import { PostCard, Column, Row } from '@we/components/solid';

// New way for direct component access
import { PostCard } from '@we/components/PostCard/PostCard.solid';

// Schema renderer can dynamically resolve
const framework = 'solid';
const { PostCard } = await import(`@we/components/PostCard/PostCard.${framework}`);
```

## Community Package Guidelines

For third-party components, recommend this structure:

```
@username/component-name/
├── /src
│   ├── Component.solid.tsx
│   ├── Component.react.tsx
│   ├── Component.vue.tsx
│   ├── Component.svelte.tsx
│   └── types.ts                 # Shared prop types
├── package.json
├── README.md
└── FRAMEWORKS.md                # Which frameworks are supported
```

### Community Package.json

```json
{
  "name": "@username/component-name",
  "version": "1.0.0",
  "exports": {
    "./solid": "./dist/Component.solid.js",
    "./react": "./dist/Component.react.js",
    "./vue": "./dist/Component.vue.js",
    "./svelte": "./dist/Component.svelte.js"
  },
  "we": {
    "component": true,
    "frameworks": ["solid", "react", "vue", "svelte"],
    "category": "cards"
  }
}
```

## Schema Renderer Integration

```typescript
// In schema renderer
class ComponentRegistry {
  private framework: Framework;

  async resolveComponent(componentName: string): Promise<Component> {
    // Check if external package
    if (componentName.startsWith('@')) {
      return await this.loadExternalComponent(componentName);
    }

    // Load from internal registry
    return this.registry[componentName];
  }

  private async loadExternalComponent(packageName: string) {
    // e.g., '@johndoe/fancy-card'
    const module = await import(`${packageName}/${this.framework}`);
    return module.default || module;
  }
}
```

## Migration Path

1. **Phase 1**: Restructure internally (component-first folders)
2. **Phase 2**: Add multi-framework support to key components
3. **Phase 3**: Update schema renderer to support framework resolution
4. **Phase 4**: Document community package guidelines
5. **Phase 5**: Build marketplace/registry for community components

## Practical Implementation

### Shared Logic

```typescript
// PostCard/PostCard.shared.ts
export interface PostCardProps {
  title: string;
  creator: { name: string; avatar: string };
  text: string;
}

export function formatPostDate(date: Date): string {
  // Shared utility
}
```

### Framework Implementations

```typescript
// PostCard/PostCard.solid.tsx
import { PostCardProps, formatPostDate } from './PostCard.shared';

export function PostCard(props: PostCardProps) {
  return <div>...</div>;
}
```

```typescript
// PostCard/PostCard.react.tsx
import { PostCardProps, formatPostDate } from './PostCard.shared';

export function PostCard(props: PostCardProps) {
  return <div>...</div>;
}
```

## Benefits Summary

**Switch to component-first structure because:**

1. ✅ Aligns with community package expectations
2. ✅ Makes framework parity visible and maintainable
3. ✅ Enables schema renderer to auto-select framework version
4. ✅ Better documentation/discoverability per component
5. ✅ Natural for third-party developers
6. ✅ Can still provide framework-specific bundles for convenience

**Keep framework entry points** for backwards compatibility and convenience:

```typescript
import { PostCard } from '@we/components/solid'; // Still works
```

But internally organize by component, with framework variants co-located. This gives you the best of both worlds! 🚀
