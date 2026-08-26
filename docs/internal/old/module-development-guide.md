# Module Development Guide (SUPERSEDED)

> **⚠️ SUPERSEDED — the module system was built, and it does not look like this. Do not follow it.**
>
> **Status (Aug 2026): superseded by the real module contract**, `packages/module-system/shared/src/module.ts`.
>
> The names survived and the shape did not, which makes this document more misleading than one that
> was simply never implemented. `defineModule` exists — as an identity function, for inference and a
> greppable declaration site — and so does a `moduleRegistry`, in `app-shell/src/shared/registries/`.
> What they take is not what is described below:
>
> | Below                                                               | Actually                                                                                                                               |
> | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
> | `stores: { proposalStore: ProposalStore }` — a map of store classes | `createStore(deps)`, a factory the host lends reactivity to, published under `modules.<id>.*`                                          |
> | `languages: [...]` — AD4M language definitions                      | Nothing. A module reaches data through the backend ports, and declares `backends: ['ad4m']` if it genuinely needs that one             |
> | `initialize(config, context)` / `cleanup(context)`                  | No lifecycle pair. `ModuleContext` with `context.ad4m.createNeighborhood` does not exist                                               |
> | Components as the main contribution                                 | Schema fragments first — `slots`, `docks`, `anchors`, `launcher`, `embed`, the whole placement system, none of which is described here |
>
> **Where to go instead:**
>
> - **The contract** — `packages/module-system/shared/src/module.ts`. Deliberately exhaustive, and it
>   is the documentation; there is no second file to read.
> - **The minimal example** — `packages/module-system/notes/`, which takes nothing from the host and
>   imports no framework at all.
> - **Where a module sits among the other surfaces**, and what registers one —
>   [`docs/contributing/surfaces.md`](../../contributing/surfaces.md).
> - **The distribution design**, still unbuilt — [`../plans/module-marketplace.md`](../plans/module-marketplace.md).
>
> Moved here from `plans/` because a banner is not protection: an agent greps this repository, lands
> mid-file on 700 lines describing `initialize(config, context)` in the present tense, and follows
> them. `internal/old/` is where documents go once the thing they describe is not what the codebase
> does.

This guide explains how to build modules for WE - composable packages that provide governance, economics, social features, and other coordination primitives.

## What is a Module?

A **module** is a self-contained package that bundles:

- **Stores** - State management and business logic
- **Components** - UI elements for the module's features
- **Languages** - AD4M language definitions for data persistence
- **Schemas** - Pre-built schema fragments for easy integration
- **Types** - Shared TypeScript definitions

Modules enable communities to add sophisticated functionality (governance, economics, etc.) to their templates without writing code.

## Module Architecture

### Package Structure

```
packages/
  modules/
    governance/
      package.json
      tsconfig.json
      src/
        index.ts                      # Module export
        stores/
          ProposalStore.ts            # Proposal state and actions
          VotingStore.ts              # Voting logic and state
        components/
          GovernancePanel.tsx         # Full governance interface
          GovernanceWidget.tsx        # Compact widget version
          ProposalCard.tsx            # Individual proposal display
          ProposalForm.tsx            # Create proposal form
          VoteButton.tsx              # Voting interface
        languages/
          proposal-language.ts        # AD4M language for proposals
          voting-language.ts          # AD4M language for votes
        schemas/
          governance-page.json        # Full page layout
          governance-widget.json      # Widget layout
          governance-compact.json     # Minimal layout
        types/
          index.ts                    # Shared types
        utils/
          voting-mechanisms.ts        # Voting logic (quadratic, etc.)
```

## Creating a Module

### 1. Module Definition

Every module exports a standard structure:

```typescript
// packages/modules/governance/src/index.ts
import { ProposalStore } from './stores/ProposalStore';
import { VotingStore } from './stores/VotingStore';
import { GovernancePanel, GovernanceWidget, ProposalCard, VoteButton, ProposalForm } from './components';
import { proposalLanguage, votingLanguage } from './languages';
import { governancePageSchema, governanceWidgetSchema } from './schemas';

export interface GovernanceConfig {
  votingMechanism: 'simple' | 'weighted' | 'quadratic';
  quorum: number; // 0-1, percentage of voters needed
  votingPeriod: number; // Seconds
  proposalThreshold?: number; // Min tokens to create proposal
}

export const governanceModule = {
  // Module metadata
  name: 'governance',
  version: '1.0.0',
  description: 'Proposal and voting system for communities',

  // Stores that get registered globally
  stores: {
    proposalStore: ProposalStore,
    votingStore: VotingStore,
  },

  // Components that get registered in componentRegistry
  components: {
    GovernancePanel,
    GovernanceWidget,
    ProposalCard,
    VoteButton,
    ProposalForm,
  },

  // AD4M languages to install
  languages: [proposalLanguage, votingLanguage],

  // Pre-built schema fragments
  schemas: {
    fullPage: governancePageSchema,
    widget: governanceWidgetSchema,
    compact: governanceCompactSchema,
  },

  // Module initialization
  async initialize(config: GovernanceConfig, context: ModuleContext) {
    console.log(`Initializing governance module with config:`, config);

    // Setup AD4M neighborhoods for proposals/votes
    const proposalNeighborhood = await context.ad4m.createNeighborhood({
      name: `${context.spaceName}-proposals`,
      language: proposalLanguage.address,
    });

    // Initialize stores with config
    context.stores.proposalStore.setConfig(config);
    context.stores.votingStore.setConfig(config);

    // Subscribe to AD4M updates
    context.stores.proposalStore.subscribeToProposals(proposalNeighborhood);
    context.stores.votingStore.subscribeToVotes(proposalNeighborhood);

    return {
      proposalNeighborhoodUrl: proposalNeighborhood.url,
    };
  },

  // Module cleanup
  async cleanup(context: ModuleContext) {
    console.log('Cleaning up governance module');

    // Unsubscribe from updates
    context.stores.proposalStore.unsubscribe();
    context.stores.votingStore.unsubscribe();
  },
};

export type GovernanceModule = typeof governanceModule;
```

### 2. Store Implementation

Stores manage state and provide actions:

```typescript
// packages/modules/governance/src/stores/ProposalStore.ts
import { createStore } from 'solid-js/store';
import type { AD4MClient } from '@perspect3vism/ad4m';
import type { GovernanceConfig } from '../types';

export interface Proposal {
  id: string;
  title: string;
  description: string;
  creator: string;
  createdAt: Date;
  votingEndsAt: Date;
  status: 'active' | 'passed' | 'rejected' | 'executed';
  yesVotes: number;
  noVotes: number;
  totalVotes: number;
}

export class ProposalStore {
  private ad4mClient?: AD4MClient;
  private config?: GovernanceConfig;
  private neighborhoodUrl?: string;
  private unsubscribe?: () => void;

  // Reactive store
  private [store, setStore] = createStore<{
    proposals: Proposal[];
    loading: boolean;
    error: string | null;
  }>({
    proposals: [],
    loading: false,
    error: null,
  });

  // Accessors (for $store tokens)
  get proposals() { return this.store.proposals; }
  get active() { return this.store.proposals.filter(p => p.status === 'active'); }
  get loading() { return this.store.loading; }
  get error() { return this.store.error; }

  // Configuration
  setConfig(config: GovernanceConfig) {
    this.config = config;
  }

  setAD4MClient(client: AD4MClient) {
    this.ad4mClient = client;
  }

  // Subscribe to proposal updates
  async subscribeToProposals(neighborhoodUrl: string) {
    this.neighborhoodUrl = neighborhoodUrl;

    // Subscribe to AD4M perspective updates
    this.unsubscribe = await this.ad4mClient!.perspective.addListener(
      neighborhoodUrl,
      (update) => this.handleProposalUpdate(update)
    );

    // Load initial proposals
    await this.loadProposals();
  }

  // Actions (for $action tokens)
  async create(data: { title: string; description: string }) {
    if (!this.ad4mClient || !this.neighborhoodUrl) {
      throw new Error('Module not initialized');
    }

    this.setStore({ loading: true, error: null });

    try {
      const proposal: Proposal = {
        id: crypto.randomUUID(),
        title: data.title,
        description: data.description,
        creator: this.ad4mClient.agent.me()!,
        createdAt: new Date(),
        votingEndsAt: new Date(Date.now() + this.config!.votingPeriod * 1000),
        status: 'active',
        yesVotes: 0,
        noVotes: 0,
        totalVotes: 0,
      };

      // Add to AD4M
      await this.ad4mClient.perspective.addLink(this.neighborhoodUrl, {
        source: 'proposal-list',
        predicate: 'has-proposal',
        target: proposal.id,
      });

      await this.ad4mClient.perspective.addLink(this.neighborhoodUrl, {
        source: proposal.id,
        predicate: 'proposal-data',
        target: JSON.stringify(proposal),
      });

      // Update local state
      this.setStore({ proposals: [...this.store.proposals, proposal] });

    } catch (error) {
      this.setStore({ error: (error as Error).message });
      throw error;
    } finally {
      this.setStore({ loading: false });
    }
  }

  async delete(proposalId: string) {
    // Implementation
  }

  async execute(proposalId: string) {
    // Check if proposal passed
    // Execute proposal logic
  }

  private async loadProposals() {
    // Load from AD4M
  }

  private handleProposalUpdate(update: any) {
    // Handle real-time updates
  }

  unsubscribe() {
    this.unsubscribe?.();
  }
}
```

### 3. Component Implementation

Components provide the UI:

```typescript
// packages/modules/governance/src/components/GovernancePanel.tsx
import { For, Show, createSignal } from 'solid-js';
import { Column, Row } from '@we/components/solid';
import type { Proposal } from '../types';

export interface GovernancePanelProps {
  proposals: Proposal[];
  onVote: (proposalId: string, vote: 'yes' | 'no') => void;
  onCreateProposal: (data: { title: string; description: string }) => void;
  showCreateForm?: boolean;
}

export function GovernancePanel(props: GovernancePanelProps) {
  const [showForm, setShowForm] = createSignal(false);
  const [title, setTitle] = createSignal('');
  const [description, setDescription] = createSignal('');

  const handleSubmit = () => {
    props.onCreateProposal({
      title: title(),
      description: description(),
    });
    setTitle('');
    setDescription('');
    setShowForm(false);
  };

  return (
    <Column gap="800" p="800" width="100%">
      {/* Header */}
      <Row justify="space-between" align="center">
        <we-text fontSize="2xl" fontWeight="bold">Governance</we-text>
        <Show when={props.showCreateForm !== false}>
          <we-button
            bg="primary-500"
            color="white"
            onClick={() => setShowForm(!showForm())}
          >
            New Proposal
          </we-button>
        </Show>
      </Row>

      {/* Create form */}
      <Show when={showForm()}>
        <Column gap="400" bg="neutral-100" r="400" p="600">
          <we-text fontSize="lg" fontWeight="bold">Create Proposal</we-text>

          <we-input
            placeholder="Proposal title..."
            value={title()}
            onInput={(e) => setTitle(e.target.value)}
          />

          <we-input
            placeholder="Description..."
            multiline
            rows={4}
            value={description()}
            onInput={(e) => setDescription(e.target.value)}
          />

          <Row gap="400">
            <we-button bg="primary-500" color="white" onClick={handleSubmit}>
              Create
            </we-button>
            <we-button bg="neutral-200" onClick={() => setShowForm(false)}>
              Cancel
            </we-button>
          </Row>
        </Column>
      </Show>

      {/* Proposals list */}
      <Column gap="600">
        <For each={props.proposals}>
          {(proposal) => (
            <ProposalCard
              proposal={proposal}
              onVote={(vote) => props.onVote(proposal.id, vote)}
            />
          )}
        </For>

        <Show when={props.proposals.length === 0}>
          <we-text color="neutral-600">No proposals yet</we-text>
        </Show>
      </Column>
    </Column>
  );
}
```

### 4. Schema Fragments

Pre-built schemas for easy integration:

```json
// packages/modules/governance/src/schemas/governance-page.json
{
  "type": "Column",
  "props": {
    "width": "100%",
    "height": "100%",
    "p": "800"
  },
  "children": [
    {
      "type": "GovernancePanel",
      "props": {
        "proposals": { "$store": "proposalStore.proposals" },
        "onVote": { "$action": "votingStore.castVote" },
        "onCreateProposal": { "$action": "proposalStore.create" },
        "showCreateForm": true
      }
    }
  ]
}
```

## Using Modules in Templates

### 1. Declare Modules

```typescript
// Community template
{
  modules: [
    {
      name: 'governance',
      version: '1.0.0',
      config: {
        votingMechanism: 'quadratic',
        quorum: 0.3,
        votingPeriod: 7 * 24 * 60 * 60  // 7 days
      }
    },
    {
      name: 'economics',
      version: '1.0.0',
      config: {
        tokenSymbol: 'COMM',
        initialSupply: 1000000
      }
    }
  ],

  routes: [
    {
      path: '/governance',
      type: 'GovernancePanel',
      props: {
        proposals: { $store: 'proposalStore.active' },
        onVote: { $action: 'votingStore.castVote' },
        onCreateProposal: { $action: 'proposalStore.create' }
      }
    }
  ]
}
```

### 2. Use Pre-built Schemas

```typescript
// Import schema fragment
import governanceWidget from '@we/governance/schemas/governance-widget.json';

{
  routes: [
    {
      path: '/',
      type: 'HomePage',
      children: [
        {
          type: 'Column',
          children: [
            { type: 'we-text', props: { text: 'Welcome' } },
            governanceWidget, // Use pre-built schema
          ],
        },
      ],
    },
  ];
}
```

### 3. Customize Components

```typescript
// Override default components
{
  routes: [
    {
      path: '/governance',
      children: [
        {
          type: 'Column',
          children: [
            // Custom header
            { type: 'CustomGovernanceHeader' },

            // Use module's components with custom styling
            {
              type: '$forEach',
              props: {
                items: { $store: 'proposalStore.active' },
                as: 'proposal',
              },
              children: [
                {
                  type: 'ProposalCard', // From governance module
                  props: {
                    proposal: { $expr: 'proposal' },
                    // Custom styling
                    style: { background: 'custom-gradient' },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}
```

## Module Registry Integration

### App Framework Setup

```typescript
// packages/app-shell/src/frameworks/solid/registries/moduleRegistry.ts
import { governanceModule } from '@we/governance';
import { economicsModule } from '@we/economics';

export const moduleRegistry = {
  governance: governanceModule,
  economics: economicsModule,
};

export interface ModuleContext {
  ad4m: AD4MClient;
  spaceName: string;
  stores: Record<string, any>;
  componentRegistry: ComponentRegistry;
}

export async function initializeModule(moduleName: string, config: any, context: ModuleContext) {
  const module = moduleRegistry[moduleName];
  if (!module) {
    throw new Error(`Module "${moduleName}" not found`);
  }

  console.log(`Initializing module: ${module.name} v${module.version}`);

  // Register stores
  if (module.stores) {
    for (const [storeName, StoreClass] of Object.entries(module.stores)) {
      const store = new StoreClass();
      store.setAD4MClient?.(context.ad4m);
      context.stores[storeName] = store;
    }
  }

  // Register components
  if (module.components) {
    Object.assign(context.componentRegistry, module.components);
  }

  // Install AD4M languages
  if (module.languages) {
    for (const language of module.languages) {
      await context.ad4m.runtime.installLanguage(language);
    }
  }

  // Call module's initialize hook
  if (module.initialize) {
    await module.initialize(config, context);
  }

  return module;
}

export async function cleanupModule(moduleName: string, context: ModuleContext) {
  const module = moduleRegistry[moduleName];
  if (module?.cleanup) {
    await module.cleanup(context);
  }
}
```

## Best Practices

### 1. Keep Modules Focused

Each module should do one thing well:

- ✅ Good: `governance` module (proposals + voting)
- ✅ Good: `economics` module (tokens + treasury)
- ❌ Bad: `community` module (governance + economics + social + chat)

### 2. Provide Multiple UI Options

Offer different layouts for different contexts:

- Full page layout (for dedicated route)
- Widget layout (for embedding in dashboards)
- Compact layout (for sidebars or small spaces)

### 3. Make Everything Configurable

Use config objects for customization:

```typescript
config: {
  votingMechanism: 'quadratic',  // vs 'simple', 'weighted'
  quorum: 0.3,                   // Adjustable threshold
  votingPeriod: 604800,          // Community-specific timing
}
```

### 4. Type Everything

Export TypeScript types for all public interfaces:

```typescript
export interface GovernanceConfig {
  /* ... */
}
export interface Proposal {
  /* ... */
}
export interface Vote {
  /* ... */
}
export type GovernanceModule = typeof governanceModule;
```

### 5. Document Schema Integration

Provide clear examples of how to use in schemas:

```typescript
// In module README
## Usage in Templates

\`\`\`json
{
  "modules": ["governance"],
  "routes": [{
    "path": "/gov",
    "type": "GovernancePanel",
    "props": {
      "proposals": { "$store": "proposalStore.proposals" },
      "onVote": { "$action": "votingStore.castVote" }
    }
  }]
}
\`\`\`
```

### 6. Test Independently

Each module should have its own tests:

```
packages/modules/governance/
  src/
  tests/
    stores/
      ProposalStore.test.ts
      VotingStore.test.ts
    components/
      GovernancePanel.test.tsx
      ProposalCard.test.tsx
```

## Module Composition Patterns

### Pattern 1: Module Dependencies

Some modules depend on others:

```typescript
export const treasuryModule = {
  name: 'treasury',
  dependencies: ['economics'], // Requires economics module

  async initialize(config, context) {
    // Can access tokenStore from economics module
    const balance = context.stores.tokenStore.getBalance();
    // ...
  },
};
```

### Pattern 2: Module Extensions

Modules can extend each other:

```typescript
export const quadraticVotingModule = {
  name: 'quadratic-voting',
  extends: 'governance', // Extends governance module

  // Override voting store
  stores: {
    votingStore: QuadraticVotingStore, // Replaces default
  },
};
```

### Pattern 3: Module Hooks

Modules can hook into each other:

```typescript
export const reputationModule = {
  name: 'reputation',
  hooks: {
    'governance:vote-cast': async (vote) => {
      // Update reputation when someone votes
      await reputationStore.incrementScore(vote.voter, 1);
    },
  },
};
```

## Publishing Modules

### 1. Package.json Setup

```json
{
  "name": "@we/governance",
  "version": "1.0.0",
  "description": "Governance module for WE communities",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "schemas"],
  "keywords": ["we", "governance", "dao", "voting"],
  "peerDependencies": {
    "@we/app-shell": "^0.1.0",
    "@perspect3vism/ad4m": "^0.8.0",
    "solid-js": "^1.8.0"
  }
}
```

### 2. Documentation

Every module should have:

- README.md with usage examples
- API documentation for stores/components
- Configuration options reference
- AD4M language specifications

### 3. Versioning

Follow semantic versioning:

- Patch (1.0.x): Bug fixes, minor improvements
- Minor (1.x.0): New features, backward compatible
- Major (x.0.0): Breaking changes

## Example: Simple Governance Module

See `packages/modules/governance-simple` for a minimal working example that demonstrates:

- Basic proposal/voting stores
- Simple UI components
- AD4M language integration
- Schema fragments
- Template usage

---

This module system enables the Cambrian explosion of social coordination primitives that WE aims to create. Each module is a reusable, composable building block that communities can mix and match to create their perfect coordination stack.
