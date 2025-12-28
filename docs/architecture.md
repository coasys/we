# WE Architecture

This document provides a high-level overview of WE's technical architecture and design principles.

## Architecture Layers

```
┌─────────────────────────────────────────────────┐
│           Communities & Templates               │
│  (JSON schemas defining UI, modules, behavior)  │
└─────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│              Module Ecosystem                   │
│  Governance │ Economics │ Social │ Content      │
└─────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│            WE Application Framework             │
│  Schema Renderer │ Template System │ Stores     │
└─────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│               Design System                     │
│  Elements │ Components │ Widgets │ Pages        │
└─────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│                   AD4M                          │
│  Identity │ Perspectives │ Neighborhoods        │
└─────────────────────────────────────────────────┘
```

## Core Components

### 1. AD4M Layer (Foundation)

**Agent-Centric Distributed Application Meta-protocol**

- **Agent Identity** - Decentralized identifiers (DIDs) for users
- **Perspectives** - Personal data graphs that users control
- **Languages** - Pluggable modules for different data types and interactions
- **Neighborhoods** - Shared spaces where agents interact and coordinate

**Key Principle:** Computation happens on the user's device, not on servers. Users own and control their data.

### 2. Design System

A modular UI component library organized by complexity:

- **`@we/elements`** - Atomic web components (we-button, we-text, we-icon, we-input)
- **`@we/components`** - Composed Solid components (Column, Row, PopoverMenu, PostCard)
- **`@we/widgets`** - Complex feature widgets (CesiumGlobe, SpaceSidebar, CreateSpaceModal)
- **`@we/pages`** - Full page components (HomePage, SpacePage, ProfilePage)
- **`@we/templates`** - Complete UI templates (DefaultTemplate, CenteredTemplate)

**Design Philosophy:** Components are framework-agnostic at the element level, framework-specific at higher levels. This allows mixing web components with framework-specific optimizations.

### 3. Schema Renderer

**Declarative UI system that renders interfaces from JSON schemas.**

#### Core Features

**Token System** for reactive data binding:

```typescript
{
  type: 'we-button',
  props: {
    text: { $store: 'userStore.name' },           // Reactive store access
    onClick: { $action: 'spaceStore.join' },      // Action binding
    disabled: { $not: { $store: 'userStore.isAuthenticated' } }
  }
}
```

**Available Tokens:**

- `$store` - Access reactive store state
- `$action` - Bind to store actions/methods
- `$expr` - Evaluate JavaScript expressions
- `$if` - Conditional rendering
- `$forEach` - Iterate and render lists
- `$map` - Transform data structures
- `$pick` - Extract specific properties
- `$eq`, `$ne`, `$not` - Logical operations

**Control Structures:**

```typescript
// Conditional rendering
{
  type: '$if',
  props: {
    condition: { $store: 'userStore.isLoggedIn' },
    then: { type: 'ProfileView' },
    else: { type: 'LoginForm' }
  }
}

// List rendering
{
  type: '$forEach',
  props: {
    items: { $store: 'postStore.posts' },
    as: 'post'
  },
  children: [
    { type: 'PostCard', props: { post: { $expr: 'post' } } }
  ]
}
```

**Recursive Resolution:** Tokens work at any nesting level - inside arrays, objects, or deeply nested structures. This enables complex data binding for sophisticated components.

### 4. Application Framework (`@we/app-framework`)

**The orchestration layer that ties everything together.**

#### Store System

Reactive state management with:

- **SpaceStore** - Current space/community state and actions
- **RouteStore** - Navigation and routing
- **TemplateStore** - Template management and switching
- **ThemeStore** - Theme configuration and styling
- **Custom stores** - Extensible for module-specific state

#### Template System

**Templates are JSON schemas that define entire applications:**

```typescript
const template = {
  stores: {
    // Store initialization
    spaceStore: {
      /* config */
    },
    postStore: {
      /* config */
    },
  },
  routes: [
    {
      path: '/',
      type: 'HomePage',
      props: {
        /* ... */
      },
    },
    {
      path: '/space/:id',
      type: 'SpacePage',
      props: {
        posts: { $store: 'postStore.posts' },
        onCreatePost: { $action: 'postStore.create' },
      },
    },
  ],
};
```

**Template Switching:** Users can switch templates without losing data - the UI changes but the underlying AD4M data remains intact.

#### Seed System

**Bootstrap configurations for different use cases:**

Seeds define:

- Initial stores and state
- Default templates
- Required AD4M languages
- Initial neighborhoods/spaces
- Configuration parameters

Example seeds:

- `weNativeApp` - Full-featured social/coordination app
- Community seeds - Forum-style interaction
- DAO seeds - Governance-focused
- Marketplace seeds - Trading and exchange

### 5. Module Ecosystem

**Composable coordination primitives** that can be added to any template.

#### Current Modules

**Cesium Layers** (`@we/cesium-layers`):

- Pluggable 3D globe visualization system
- User locations, country outlines, H3 hexagons
- Layer factory pattern for community contributions

**Block Composer** (in development):

- Fractal post composition system
- Embeddable blocks: text, polls, games, maps, etc.
- Recursive composition (blocks within blocks)

#### Planned Modules

**Governance:**

- Voting mechanisms (simple, weighted, quadratic, etc.)
- Proposal systems
- Decision execution
- Delegation frameworks

**Economics:**

- Token creation and management
- Treasury systems
- Resource allocation
- Markets and exchange

**Social:**

- Reputation systems
- Content curation
- Moderation frameworks
- Relationship graphs

## Design Principles

### 1. Composability

Everything is a module that can be mixed and matched. Communities compose their stack from proven primitives rather than building from scratch.

### 2. Evolvability

No lock-in. Templates and modules can be swapped without data migration. Communities can experiment rapidly and evolve their coordination structures over time.

### 3. Declarative UIs

Schemas describe what the UI should be, not how to build it. This enables:

- AI-generated interfaces
- Non-developer contributions
- Rapid prototyping
- Cross-framework compatibility

### 4. Agent-Centric

Users run their own nodes and control their own data. Computation happens on user devices, not corporate servers.

### 5. Exit-Friendly

Communities can fork templates, switch modules, or migrate to alternative implementations without losing data or community relationships.

## Data Flow

```
User Action
    ↓
Component (Schema-rendered)
    ↓
Store Action (via $action token)
    ↓
AD4M Language (data persistence)
    ↓
Neighborhood (shared state)
    ↓
Store Update (reactive)
    ↓
UI Re-render (via $store token)
```

## Key Technical Decisions

### Why JSON Schemas?

- **Shareable** - Templates can be distributed as simple files
- **AI-friendly** - LLMs can generate and modify schemas
- **Framework-agnostic** - Same schema works across implementations
- **Version-controllable** - Track changes to coordination structures
- **Composable** - Schemas can reference and include other schemas

### Why SolidJS?

- **Fine-grained reactivity** - Efficient updates without virtual DOM
- **Simple mental model** - Close to vanilla JavaScript
- **Web component friendly** - Works well with design system
- **Performance** - Fast enough for real-time coordination

### Why Web Components?

- **Framework-agnostic** - Can be used anywhere (React, Vue, vanilla)
- **Encapsulation** - Styles and behavior contained
- **Future-proof** - Built on web standards
- **Progressive enhancement** - Work without JavaScript

### Why Monorepo?

- **Coordinated changes** - Update schema renderer and components together
- **Shared tooling** - Build scripts, testing, deployment
- **Discoverability** - All modules in one place
- **Version coherence** - Ensure compatible module versions

## Extension Points

Communities and developers can extend WE through:

1. **Custom modules** - Build new coordination primitives
2. **Custom templates** - Create specialized UIs
3. **Custom languages** - Add new AD4M data types
4. **Custom components** - Extend the design system
5. **Custom themes** - Brand and style customization

## Performance Considerations

- **Lazy loading** - Modules loaded on demand
- **Memo-ization** - Token resolution cached via reactive memos
- **Virtual scrolling** - Large lists rendered efficiently
- **Web workers** - Heavy computation off main thread
- **Service workers** - Offline-first architecture

## Security Model

- **Client-side execution** - No server-side code to compromise
- **Cryptographic identity** - DIDs with key-based authentication
- **Encrypted communication** - AD4M languages handle encryption
- **Sandboxed modules** - Modules can't access data they don't need
- **User control** - Explicit permissions for data access

---

This architecture enables rapid experimentation with social coordination while maintaining user sovereignty and data portability. As the module ecosystem grows, so does the power and flexibility available to communities.
