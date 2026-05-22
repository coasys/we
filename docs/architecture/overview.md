# WE Architecture: Block-Native Experiences on AD4M

## Vision

WE is a **runtime for decentralized experiences** — one installed app that dynamically loads, renders, and composes app-like experiences built on AD4M. Rather than every project shipping its own Electron/Tauri binary, builders publish experiences that any WE user can open, remix, and integrate into their personal workspace.

The core bet: **apps decompose into data (owned by the user, in their AD4M perspective) and UI (declarative JSON schemas that can be shared, remixed, and AI-modified) — and this separation creates an ecosystem where experiences compose rather than compete.** Two music apps aren't fighting for lock-in; they're both lenses over the same library, and you can mix components from both. Uninstall an experience, your data stays. The monolithic app is the wrong abstraction for a user-sovereign system.

---

## The Problem Blocks Solve

AD4M makes it trivially easy for AI to generate custom models at runtime. This creates a paradox:

```
More flexibility (AI generates any model)
  → More fragmentation (every community has unique schemas)
  → Less interoperability (can't share across communities)
```

If 1000 communities each generate their own Recipe/Track/Post model, they create 1000 incompatible schemas despite representing the same concepts. Different property names, different predicates, different structures — limited cross-community sharing.

**Blocks resolve this by standardizing components, not compositions.** Everyone uses the same ~20-30 block types (shared alphabet), but composes them differently (different sentences). The result: full cross-community readability, graceful degradation, and network effects at the component level.

---

## Two Layers, Not Three

### Layer 1: Block Types (content primitives)

The universal building blocks for all content. Each has standardized properties and a default renderer. Every WE instance ships with these — they're always available, no installation needed.

**Block types serve double duty:**

1. **As composable content** — a recipe is a CollectionBlock containing TextBlocks, ImageBlocks, and ChecklistBlocks
2. **As queryable data** — "find all AudioBlocks" gives you a music library; "find all CalendarBlocks" gives you events

**Core Block Types:**

| Block Type        | Key Properties                                                  | Covers                                                     |
| ----------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| `TextBlock`       | text, format, direction, indent, textStyle, tag, listType       | Headings, paragraphs, quotes, lists, code snippets         |
| `ImageBlock`      | src, altText, width, height, caption                            | Photos, artwork, screenshots, diagrams                     |
| `AudioBlock`      | title, duration, src, mimeType, bitrate, waveformData, albumArt | Music tracks, podcast episodes, voice memos, sound effects |
| `VideoBlock`      | title, duration, src, mimeType, resolution, thumbnail           | Movies, clips, streams, tutorials                          |
| `FileBlock`       | name, size, mimeType, src, checksum                             | Generic binary files, documents                            |
| `CodeBlock`       | code, language, filename                                        | Source code, config snippets                               |
| `TableBlock`      | columns[], rows[]                                               | Data tables, spreadsheets, nutrition info                  |
| `ChecklistBlock`  | items (text, checked)                                           | Todo lists, ingredient lists, checklists                   |
| `MapBlock`        | lat, lng, zoom, markers[]                                       | Locations, routes, geographic data                         |
| `CalendarBlock`   | events (date, title, description)                               | Schedules, timelines, event listings                       |
| `PollBlock`       | question, options[], votes                                      | Polls, surveys, voting                                     |
| `EmbedBlock`      | url, provider, embedType                                        | External content, iframes, widgets                         |
| `LinkBlock`       | url, title, description, thumbnail                              | Bookmarks, link previews                                   |
| `CollectionBlock` | display, direction, ordering                                    | Playlists, albums, folders, galleries, any grouping        |

**Block type admission criteria:** A new block type = a new rendering primitive. If it needs a genuinely different renderer (a different kind of thing on screen), it's a new block type. If it's the same rendering with different domain meaning, it's an existing block type with a different `semanticRole`.

### Layer 2: Entity Models (structural/organizational)

Fixed-schema, flat models for things that don't benefit from block-style composition:

| Model        | Properties                               | Purpose                      |
| ------------ | ---------------------------------------- | ---------------------------- |
| `Space`      | name, description, visibility, members[] | Named containers/communities |
| `Profile`    | displayName, bio, avatar, links[]        | User/agent identity          |
| `Permission` | role, capabilities[]                     | Access control               |
| `Setting`    | key, value                               | Configuration                |

---

## Composition & Relationships

### Universal Containment: `we://contains`

All block hierarchies use a single predicate: `we://contains`. This gives every app the same traversal pattern — no app-specific query logic needed.

```
CollectionBlock (playlist)
  ├── we://contains → TextBlock (playlist title)
  ├── we://contains → ImageBlock (playlist cover)
  ├── we://contains → AudioBlock (track 1)
  ├── we://contains → AudioBlock (track 2)
  └── we://contains → AudioBlock (track 3)
```

### Containment is a DAG, Not a Tree

An AudioBlock can exist in multiple parents (a playlist AND an album). "Add track to playlist" creates a `we://contains` link — it doesn't duplicate the block. Change the track title once, it updates everywhere. Remove it from a playlist, it still exists in the album.

### Ordering

Block ordering within a parent is handled by AD4M's CRDT ordering system (see [CRDT-ORDERING-STRATEGY-V2.md](../ad4m/CRDT-ORDERING-STRATEGY-V2.md)). Since `we://contains` is a `@HasMany` relationship, it declares ordering via the decorator:

```typescript
@HasMany(() => Block, {
  through: "we://contains",
  ordering: { strategy: "linkedList" }
})
children: Block[] = [];
```

This means:

- **Ordering is a type-system guarantee** — enforced by the executor, not the UI layer
- **All clients see the same order** — JS, MCP agents, Rust CLI, future consumers
- **Concurrent edits resolve deterministically** — two agents reordering the same playlist get consistent results via RGA conflict resolution
- **Parent-sourced ordering links** (`ad4m://collection_order`) sit alongside `we://contains` data links on the parent block — no extra queries needed
- **Standard array operations** — `push`, `splice`, `unshift` on the children array, then `save()` — the executor generates the correct ordering links

### Shared References vs. Subjective Data

- **Blocks are shared truth** — the AudioBlock's title, duration, and src are the same for everyone
- **Links to blocks are subjective context** — playback position, personal ratings, liked/unliked status, read/unread are links FROM the user's perspective TO the block, not properties of the block

---

## Semantic Roles: Meaning Without Fragmentation

`semanticRole` lets different communities assign subjective meaning to the same block without modifying it:

```typescript
AudioBlock {
  title: "Bohemian Rhapsody"
  src: "lang://Qm..."
  duration: 354
  semanticRole: [
    "music://track",        // Music app queries for this
    "dj://mixable",         // DJ app queries for this
    "karaoke://has_lyrics"  // Karaoke app queries for this
  ]
}
```

**Key properties:**

- Multiple roles on a single block — no graph duplication
- Add new roles without touching existing structure
- Each perspective interprets the same block its own way
- Apps query by role: "find all AudioBlocks with role `music://track`"

### Domain-Specific Metadata via Composition

When an app needs extra metadata (BPM, musical key, genre), prefer sibling blocks over extension properties:

```
CollectionBlock { semanticRole: ["music://track"] }
  ├── AudioBlock { title: "Bohemian Rhapsody", src: "..." }
  ├── TextBlock { text: "131", semanticRole: ["music://bpm"] }
  ├── TextBlock { text: "Bb Major", semanticRole: ["music://key"] }
  └── TextBlock { text: "Rock", semanticRole: ["music://genre"] }
```

This stays within the block model, is visible to any renderer, and the AI can add/remove metadata blocks without special extension knowledge.

### Suggested Vocabulary

Not enforced, but publish a documented set of common semantic roles alongside the core block types. Over time, popular roles become de facto standards. Fragmentation at the semantic role level is far less severe than model fragmentation — content is still renderable and composable regardless.

---

## The WE Stack

### What Ships with WE (built-in)

1. **~20-30 core block types** with standardized properties and default renderers
2. **Entity models** for structural things (Space, Profile)
3. **Reactive query service** — bridges Ad4mModel queries into Solid signals (see State Management below)
4. **Design system** (7-layer atomic architecture):
   - L1: Tokens (HSL colors, spacing, sizing, fonts — JS + CSS variables)
   - L2: Themes (CSS-only via `data-we-theme` attribute)
   - L3: Primitives (Lit web components: `we-button`, `we-input`, `we-modal`, etc.)
   - L4: Components (SolidJS: `Column`, `Row`, `PostCard`, etc.)
   - L5: Widgets (SolidJS: sidebars, modals, globe, graph)
   - L6: Pages (SolidJS: route-level components)
   - L7: Templates (structural blueprints)
5. **Schema renderer** — JSON-schema-driven UI renderer with dynamic prop resolution (`$query`, `$store`, `$action`, `$expr`, `$map`, `$if`, `$forEach`, `$routes`)
6. **Block composer** — Lexical-based rich text editor for authoring block compositions
7. **AI store** — schema generation and modification via natural language

### What App Builders Publish

1. **Component packages** — custom SolidJS components using design system primitives (e.g., MusicPlayer, Waveform, TrackList)
2. **App stores** — domain-specific logic (e.g., PlayerStore for audio playback, queue management)
3. **Schemas** — JSON compositions wiring components to data queries and stores with routes, layout, and bindings
4. **New block types** (rare) — for genuinely novel content types not covered by the core set, with default renderers

---

## State Management

State in WE comes from three distinct sources. The schema renderer resolves all three uniformly, but they serve different purposes and are authored differently.

### Data Layer: `$query` (declarative, reactive, zero code)

AD4M's `Ad4mModel` already provides a full query and subscription API — `findAll`, `query().where().subscribe()`, `create`, `update`, `delete`. WE does **not** duplicate this with generated store wrappers. Instead, the schema renderer has a `$query` token that declaratively describes a query against Ad4mModel, bridged to Solid reactivity.

```json
{
  "type": "TrackList",
  "props": {
    "tracks": {
      "$query": {
        "model": "AudioBlock",
        "where": { "semanticRole": { "contains": "music://track" } },
        "order": { "title": "ASC" }
      }
    }
  }
}
```

The renderer sees `$query`, executes it through a **reactive query service**, and passes the resulting Solid signal to the component.

**Other query examples:**

```json
{ "$query": { "model": "CollectionBlock", "where": { "semanticRole": { "contains": "music://playlist" } } } }
{ "$query": { "model": "Block", "parent": { "$expr": "route.params.playlistId" }, "through": "we://contains" } }
{ "$query": { "model": "TextBlock", "search": "keyword" } }
```

**Mutations** use the `$action` token with the query service:

```json
{ "$action": "query.create", "args": ["AudioBlock", { "title": "New Track", "src": "..." }] }
{ "$action": "query.delete", "args": ["AudioBlock", "$arg.id"] }
```

#### The Reactive Query Service

The query service is a thin bridge (~50 lines) between Ad4mModel and Solid's reactivity. It does three things:

1. **Perspective injection** — every Ad4mModel call needs a `perspective` argument; the service injects the current perspective so components and schemas don't need to know about it
2. **Signal bridging** — Ad4mModel subscriptions fire callbacks; the service wraps them in `createSignal()` so Solid components get reactive updates
3. **Subscription deduplication** — if two components both query "AudioBlocks with role music://track", one SurrealDB subscription feeds both signal readers

All query logic stays in Ad4mModel where it belongs. The service is a bridge, not a layer.

```typescript
// Conceptual implementation
const queryService = {
  subscribe: (ModelClass, queryParams) => {
    const cacheKey = hash(ModelClass.name, queryParams);
    if (cache.has(cacheKey)) return cache.get(cacheKey).signal;

    const [data, setData] = createSignal([]);
    const builder = ModelClass.query(currentPerspective())
      .where(queryParams.where)
      .order(queryParams.order)
      .limit(queryParams.limit);

    builder.subscribe((results) => setData(results));
    cache.set(cacheKey, { signal: data, dispose: () => builder.dispose() });
    return data;
  },

  find: (ModelClass, id) => ModelClass.find(currentPerspective(), id),
  create: (ModelClass, props) => ModelClass.create(currentPerspective(), props),
};
```

**Why not auto-generated per-block-type stores?** Ad4mModel already provides `AudioBlock.query().where().subscribe()`, `AudioBlock.create()`, etc. Generating a wrapper store for each block type that mirrors this same API is redundant. `$query` goes directly to Ad4mModel — the block type definitions don't need to know about Solid, signals, or stores.

### Framework Stores: `$store` (hand-written, ships with WE)

These manage non-data concerns — authentication, routing, theming, templates, modals, AI. They're hand-written Solid contexts with specific logic:

| Store           | Purpose                            | Example Access                            |
| --------------- | ---------------------------------- | ----------------------------------------- |
| `adamStore`     | AD4M client, agent auth, spaces    | `$store: 'adamStore.me'`                  |
| `routeStore`    | Navigation state                   | `$store: 'routeStore.currentPath'`        |
| `themeStore`    | Current theme                      | `$store: 'themeStore.currentTheme'`       |
| `templateStore` | Current schema, template switching | `$store: 'templateStore.currentTemplate'` |
| `modalStore`    | Modal visibility                   | `$action: 'modalStore.openModal'`         |
| `aiStore`       | AI prompts, schema generation      | `$action: 'aiStore.handleSchemaPrompt'`   |

These don't change. They manage auth state, routing, themes — things that aren't block queries.

### App Stores: `$store` (coded, published with component packages)

Domain-specific logic that can't be expressed as a data query — audio playback, canvas drawing, WebRTC, real-time collaboration. Published as part of component packages and **dynamically registered** when installed.

```typescript
// What an app builder exports in their component package
export const PlayerStore = defineAppStore({
  name: 'player',
  dependencies: ['query'], // declares what it needs, doesn't import framework internals

  create: ({ query }) => {
    const [currentTrack, setCurrentTrack] = createSignal(null);
    const [isPlaying, setIsPlaying] = createSignal(false);
    const [queue, setQueue] = createSignal([]);
    const audio = new Audio();

    const playTrack = async (trackId) => {
      const track = await query.find(AudioBlock, trackId);
      audio.src = track.src;
      audio.play();
      setCurrentTrack(track);
      setIsPlaying(true);
    };

    return {
      currentTrack,
      isPlaying,
      queue,
      playTrack,
      pause: () => {
        audio.pause();
        setIsPlaying(false);
      },
      next: () => {
        /* queue logic */
      },
    };
  },
});
```

**Schema usage:**

```json
{ "$store": "player.currentTrack" }
{ "$store": "player.isPlaying" }
{ "$action": "player.playTrack", "args": ["$arg.id"] }
```

**Key design decisions:**

- App stores **declare dependencies**, not import them — keeps packages decoupled from framework internals
- Store namespaces must be **collision-safe** — two packages can't both register `player`
- Registration is **dynamic** — happens when a component package is installed, not at build time

### Unified Resolution

All three sources feed into one resolution namespace for the schema renderer:

```
┌─────────────────────────────────────────────────────┐
│  Schema Prop Resolution                             │
│                                                     │
│  $query  → Reactive Query Service → Ad4mModel       │
│            (data layer, declarative, auto-bridged)   │
│                                                     │
│  $store  → Framework Stores (adamStore, routeStore) │
│          → App Stores (player, drawing, etc.)       │
│            (imperative logic, hand-written)          │
│                                                     │
│  $action → Methods on any of the above              │
│            (mutations, side effects)                 │
└─────────────────────────────────────────────────────┘
```

From the schema author's perspective: `$query` is for reading/writing block data. `$store` is for non-data state. `$action` calls methods on either. The distinction is clear and each layer does exactly one thing.

### How Data Flows Through an Experience

When a user opens the Spotify experience:

1. **Schema starts rendering** — encounters `$query: { model: "AudioBlock", where: { semanticRole: { contains: "music://track" } } }`
2. **Reactive query service** creates a SurrealDB subscription via `AudioBlock.query(perspective).where(...).subscribe()`, wraps it in a Solid signal, deduplicates if the same query exists
3. **Component receives reactive data** — `TrackList` gets a signal that updates whenever tracks are added/removed/modified in the perspective
4. **User clicks play** — schema triggers `$action: "player.playTrack"` with the track ID
5. **App store acts** — `PlayerStore.playTrack()` calls `query.find(AudioBlock, id)` to get the block, reads its `src`, plays via HTML Audio
6. **UI reactively updates** — `$store: "player.currentTrack"` signal updates, `MusicPlayer` component in the footer re-renders

Data flows cleanly: `$query` is the reactive data layer, `$store` is the logic layer, the schema renderer wires them to components declaratively.

---

## Experience Sharing & Remixability

### Two Schema Scopes

1. **Experience Schema** — a self-contained "app" definition (Spotify alternative, podcast player, notes app). Defines its own routes, layout, and component bindings. Shareable as a unit.
2. **User's Root Schema** — the personal WE workspace. Can incorporate elements from multiple experiences. The user's dashboard with a music bar, chat sidebar, and notes view.

### The Sharing Flow

**Builder creates an experience:**

```json
{
  "meta": { "name": "Harmony", "description": "P2P Music Player" },
  "dependencies": {
    "packages": ["@we-pkg/music"]
  },
  "type": "Row",
  "children": [
    {
      "type": "PlaylistSidebar",
      "props": {
        "playlists": {
          "$query": { "model": "CollectionBlock", "where": { "semanticRole": { "contains": "music://playlist" } } }
        }
      }
    },
    {
      "type": "$routes",
      "routes": [
        {
          "path": "/",
          "type": "TrackList",
          "props": {
            "tracks": {
              "$query": {
                "model": "AudioBlock",
                "where": { "semanticRole": { "contains": "music://track" } },
                "order": { "title": "ASC" }
              }
            }
          }
        },
        { "path": "/playlist/:id", "type": "PlaylistView" }
      ]
    }
  ],
  "slots": {
    "footer": { "type": "MusicPlayer", "props": { "current": { "$store": "player.currentTrack" } } }
  }
}
```

**Receiver opens it in WE:**

1. WE resolves dependencies — installs `@we-pkg/music` component package if needed
2. `$query` props resolve against built-in block types (AudioBlock, CollectionBlock) via the reactive query service — no stores to install for data access
3. `$store` props for `player.*` resolve against the dynamically registered PlayerStore from the package
4. Experience renders immediately

**Receiver remixes it:**

1. "Add the music player from Harmony as a persistent footer in my main template"
2. AI extracts the MusicPlayer component reference and store bindings from the Harmony schema
3. Splices them into the user's root schema
4. Done — pure JSON surgery, no code changes

**Competing apps share data:**

- Two different music apps both use `$query: { model: "AudioBlock", where: { semanticRole: { contains: "music://track" } } }`
- Same Ad4mModel query, same SurrealDB subscription, same music library — different UIs
- Switch apps freely, data stays

### Dependency Resolution

When a schema references components not in the user's registry:

1. Schema declares dependencies in its `dependencies` block
2. WE checks the local component registry
3. Missing packages prompt: "This experience uses @we-pkg/music. Install?"
4. Package downloaded, components and coded stores registered
5. Schema renders

---

## Developer Onramp

### Level 1: Schema-Only (zero code)

- Edit a `schema.json` referencing existing components and `$query` for block data
- Use the AI to generate/modify schemas via natural language
- Good for: dashboards, custom layouts, remixing existing experiences

### Level 2: Custom Components (UI code)

- Write SolidJS components using design system primitives
- Register them in a component package manifest
- Reference them in schemas, wire data via `$query`
- Good for: domain-specific UI (music player, waveform visualizer)

### Level 3: Custom Logic (app stores + components)

- Create app stores via `defineAppStore()` for domain-specific behavior (audio playback, real-time collaboration)
- App stores declare dependencies (e.g., `query` service) and are dynamically registered when installed
- Components bind to both `$query` (data) and `$store` (logic)
- Good for: full app experiences (Spotify alternative, video editor)

### Level 4: Custom Block Types (rare)

- Define new block types for genuinely novel content primitives
- Include a default renderer so other WE users can display them
- Good for: scientific data, 3D models, IoT sensor feeds

---

## Design Principles

1. **Blocks are the universal vocabulary.** All content is block compositions. No parallel model hierarchies.
2. **Containment is the universal relationship.** `we://contains` is the one predicate for all hierarchical structure.
3. **Semantic roles layer meaning, not structure.** Same block, different interpretations per community.
4. **Blocks are shared truth; links to blocks are subjective.** Personal state (ratings, progress, likes) lives in your perspective as links to blocks, not on blocks.
5. **Component packages are UI, not data.** Installing a music app gives you new renderers and interaction logic, not a new data model.
6. **Schemas are the composition layer.** JSON-declarative, AI-modifiable, shareable, remixable.
7. **Graceful degradation everywhere.** Unknown block types show a placeholder with install prompt. Unknown components show a fallback. Experiences always render something.
8. **The user's root schema is sovereign.** It's their personal workspace composition. Apps are things you open or splice elements from. Undo, version history, reset-to-default must feel safe.

---

## Example: Spotify Alternative (End to End)

### Builder creates the experience:

1. **No models to define** — AudioBlock and CollectionBlock already exist
2. **Writes components**: `MusicPlayer` (playback controls, progress bar), `TrackList` (sortable list of AudioBlocks), `PlaylistSidebar` (list of CollectionBlocks with role `music://playlist`), `AlbumGrid` (grid of CollectionBlocks with role `music://album`)
3. **Writes PlayerStore** via `defineAppStore()`: manages HTML Audio element, queue, shuffle, repeat, volume, progress tracking. Declares dependency on `query` service to read AudioBlocks.
4. **Composes schema**: DefaultTemplate with PlaylistSidebar in sidebar slot (data via `$query`), routed content (TrackList, AlbumGrid, PlaylistView), MusicPlayer in persistent footer slot (state via `$store: "player.*"`)
5. **Publishes**: `@we-pkg/music` component package (components + PlayerStore) + experience schema

### User receives it:

1. Gets a link/share from the builder
2. WE installs `@we-pkg/music` (components + PlayerStore)
3. Opens the Harmony experience — full music player
4. Adds AudioBlocks to their perspective (their music library)
5. Creates CollectionBlocks with `music://playlist` role (their playlists)
6. Decides to add the music player footer to their main WE template
7. Tells AI: "Add a persistent music player at the bottom of my workspace"
8. AI modifies root schema — music plays while browsing spaces, chatting, etc.

### Someone else builds a competing music app:

1. Imports `@we-pkg/music` OR writes their own components
2. Uses the same `$query`: `{ model: "AudioBlock", where: { semanticRole: { contains: "music://track" } } }`
3. **Same Ad4mModel query, same music library, different UI**
4. User can mix components: one app's TrackList, another's MusicPlayer
5. AI splices them together in the root schema — they both use `$query` against the same block types

---

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
│            Application Framework                │
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

- **Shareable** — Templates can be distributed as simple files
- **AI-friendly** — LLMs can generate and modify schemas
- **Framework-agnostic** — Same schema works across implementations
- **Version-controllable** — Track changes to coordination structures
- **Composable** — Schemas can reference and include other schemas

### Why SolidJS?

- **Fine-grained reactivity** — Efficient updates without virtual DOM
- **Simple mental model** — Close to vanilla JavaScript
- **Web component friendly** — Works well with design system
- **Performance** — Fast enough for real-time coordination

### Why Web Components?

- **Framework-agnostic** — Can be used anywhere (React, Vue, vanilla)
- **Encapsulation** — Styles and behavior contained
- **Future-proof** — Built on web standards

### Why Monorepo?

- **Coordinated changes** — Update schema renderer and components together
- **Shared tooling** — Build scripts, testing, deployment
- **Discoverability** — All modules in one place
- **Version coherence** — Ensure compatible module versions
