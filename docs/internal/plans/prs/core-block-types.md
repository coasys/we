# Plan: Core Block Types

> Expand the block type set from 3 to 13, covering the 80% of use cases for WE apps. Each block type is an AD4M model + a SolidJS editor component, wired together via `registerBlock()`.

---

## Context

WE currently has 3 block types (TextBlock, ImageBlock, CollectionBlock). These work for basic document composition but don't cover the breadth of content needed for apps like music players, calendars, project managers, etc.

Every block type added to a perspective automatically gets SHACL MCP tools (`{block}_create`, `_query`, `_get`, `_delete`, `_set_{property}`), so AI agents can immediately CRUD instances.

**Prerequisite:** [block-model-migration](block-model-migration.md) (models must live in `@we/models`).

---

## Architecture Principle

**Three layers, one generic editor node.** Each block type has:

1. **Model** (`@we/models`) — pure AD4M data with semantic fields, meaningful to any app via `$query`
2. **Component** (`@we/components` or `@we/widgets`) — SolidJS UI that renders the block. Used in both the editor (via `GenericBlockNode`) and schema-rendered apps. Editor-agnostic.
3. **Editor registration** (`@we/block-system`) — `registerBlock()` call that wires model + component together. `GenericBlockNode` handles embedding in the Lexical composition surface.

No custom Lexical nodes needed for new block types — `GenericBlockNode` handles all non-text blocks. Only **TextBlock** has a dedicated Lexical node because inline rich text formatting requires Lexical's internal text node system.

**TextBlock is the catch-all for rich text content.** Paragraphs, headings, quotes, lists, callouts, and dividers are all TextBlock variants distinguished by the `type` field. This avoids model proliferation for content that is fundamentally "styled text." AD4M's graph storage means null fields don't cost storage — unset properties simply have no link.

**CodeBlock is separate** because it's genuinely distinct: monospace, syntax highlighting, no inline rich text formatting, and `language` is queryable metadata.

---

## Core Block Types (13)

### Existing (3)

#### 1. TextBlock

Rich text content. Covers paragraphs, headings, quotes, lists, callouts, and dividers via `type` discriminator.

```typescript
@Model({ name: 'TextBlock' })
class TextBlock extends WeNode {
  @Property({ through: 'we://has_type' }) type: string = 'paragraph'; // paragraph | heading | quote | list | listitem | callout | divider
  @Property({ through: 'we://has_text' }) text: string = '';
  @Property({ through: 'we://has_text_format' }) textFormat: number = 0; // bitmask for inline styles
  @Property({ through: 'we://has_text_style' }) textStyle: string = '';
  @Property({ through: 'we://has_tag' }) tag: string = ''; // h1, h2, blockquote, etc.
  @Property({ through: 'we://has_format' }) format: string = '';
  @Property({ through: 'we://has_direction' }) direction: string = '';
  @Property({ through: 'we://has_indent' }) indent: number = 0;
  @Property({ through: 'we://has_list_type' }) listType: string = ''; // bullet | number (lists only)
  @Property({ through: 'we://has_start' }) start: number = 0; // ordered list start (lists only)
  @Property({ through: 'we://has_variant' }) variant: string = ''; // info | warning | tip | danger (callouts only)
  @Property({ through: 'we://has_icon' }) icon: string = ''; // callout icon
  @Property({ through: 'we://has_style' }) style: string = ''; // solid | dashed | dotted (dividers only)
}
```

Lexical: Uses Lexical's built-in `ParagraphNode`, `HeadingNode`, `QuoteNode`, `ListNode`, `ListItemNode`, plus custom `CalloutNode` and `HorizontalRuleNode`. These are the only blocks requiring dedicated Lexical nodes (because they're rich text).

#### 2. ImageBlock

```typescript
@Model({ name: 'ImageBlock' })
class ImageBlock extends WeNode {
  @Property({ through: 'we://has_src', required: true }) src: string = '';
  @Property({ through: 'we://has_alt_text' }) altText: string = '';
  @Property({ through: 'we://has_width' }) width: number = 0;
  @Property({ through: 'we://has_height' }) height: number = 0;
}
```

#### 3. CollectionBlock

Groups blocks together with layout options.

```typescript
@Model({ name: 'CollectionBlock' })
class CollectionBlock extends WeNode {
  @Property({ through: 'we://has_display' }) display: string = 'list'; // list | grid | carousel | masonry
  @Property({ through: 'we://has_direction' }) direction: string = 'vertical'; // vertical | horizontal (list only)
  @Property({ through: 'we://has_columns' }) columns: number = 0; // grid/masonry column count (0 = auto-fit)
  @Property({ through: 'we://has_gap' }) gap: string = 'md'; // spacing token: none | xs | sm | md | lg | xl
}
```

### New: Media (3)

#### 4. AudioBlock

```typescript
@Model({ name: 'AudioBlock' })
class AudioBlock extends WeNode {
  @Property({ through: 'we://has_title', required: true }) title: string = '';
  @Property({ through: 'we://has_artist' }) artist: string = '';
  @Property({ through: 'we://has_audio_url', required: true }) audioUrl: string = '';
  @Property({ through: 'we://has_duration' }) duration: number = 0;
  @Property({ through: 'we://has_album_art' }) albumArt: string = '';
}
```

Editor component: `AudioPlayer` — inline player with waveform/controls. Registered via `registerBlock()`, rendered by `GenericBlockNode`.

#### 5. VideoBlock

```typescript
@Model({ name: 'VideoBlock' })
class VideoBlock extends WeNode {
  @Property({ through: 'we://has_title' }) title: string = '';
  @Property({ through: 'we://has_url', required: true }) url: string = '';
  @Property({ through: 'we://has_duration' }) duration: number = 0;
  @Property({ through: 'we://has_thumbnail' }) thumbnail: string = '';
  @Property({ through: 'we://has_provider' }) provider: string = ''; // local | youtube | vimeo
}
```

Editor component: `VideoPlayer` — embedded player with thumbnail preview.

#### 6. FileBlock

```typescript
@Model({ name: 'FileBlock' })
class FileBlock extends WeNode {
  @Property({ through: 'we://has_name', required: true }) name: string = '';
  @Property({ through: 'we://has_url', required: true }) url: string = '';
  @Property({ through: 'we://has_mime_type' }) mimeType: string = '';
  @Property({ through: 'we://has_size' }) size: number = 0;
}
```

Editor component: `FileAttachment` — attachment chip with icon, name, size, download link.

### New: Structured Data (3)

#### 7. EventBlock

```typescript
@Model({ name: 'EventBlock' })
class EventBlock extends WeNode {
  @Property({ through: 'we://has_title', required: true }) title: string = '';
  @Property({ through: 'we://has_description' }) description: string = '';
  @Property({ through: 'we://has_start_date', required: true }) startDate: string = ''; // ISO 8601
  @Property({ through: 'we://has_end_date' }) endDate: string = '';
  @Property({ through: 'we://has_location' }) location: string = '';
  @Property({ through: 'we://has_all_day' }) allDay: boolean = false;
}
```

Editor component: `EventCard` — compact card with date, time, location.

#### 8. TaskBlock

```typescript
@Model({ name: 'TaskBlock' })
class TaskBlock extends WeNode {
  @Property({ through: 'we://has_title', required: true }) title: string = '';
  @Property({ through: 'we://has_description' }) description: string = '';
  @Property({ through: 'we://has_status' }) status: string = 'todo'; // todo | in-progress | done
  @Property({ through: 'we://has_priority' }) priority: string = 'medium'; // low | medium | high | urgent
  @Property({ through: 'we://has_due_date' }) dueDate: string = ''; // ISO 8601
  @Property({ through: 'we://has_assignee' }) assignee: string = ''; // DID
}
```

Editor component: `TaskItem` — checkbox with title, status badge, due date.

#### 9. LocationBlock

```typescript
@Model({ name: 'LocationBlock' })
class LocationBlock extends WeNode {
  @Property({ through: 'we://has_name' }) name: string = '';
  @Property({ through: 'we://has_latitude', required: true }) latitude: number = 0;
  @Property({ through: 'we://has_longitude', required: true }) longitude: number = 0;
  @Property({ through: 'we://has_address' }) address: string = '';
}
```

Editor component: `LocationCard` — map pin card with name and address.

### New: Rich Content (2)

#### 10. LinkBlock

Bookmark/OpenGraph preview for shared URLs.

```typescript
@Model({ name: 'LinkBlock' })
class LinkBlock extends WeNode {
  @Property({ through: 'we://has_url', required: true }) url: string = '';
  @Property({ through: 'we://has_title' }) title: string = '';
  @Property({ through: 'we://has_description' }) description: string = '';
  @Property({ through: 'we://has_thumbnail' }) thumbnail: string = '';
}
```

Editor component: `LinkPreview` — OG card with thumbnail, title, description, domain.

#### 11. CodeBlock

Separate from TextBlock because: syntax highlighting, no inline rich text, `language` is queryable metadata.

```typescript
@Model({ name: 'CodeBlock' })
class CodeBlock extends WeNode {
  @Property({ through: 'we://has_code', required: true }) code: string = '';
  @Property({ through: 'we://has_language' }) language: string = '';
  @Property({ through: 'we://has_title' }) title: string = '';
}
```

Editor component: `CodeEditor` — monospace editor with syntax highlighting and language selector.

### New: Organisation (1)

#### 12. TagBlock

Reusable labels across any content.

```typescript
@Model({ name: 'TagBlock' })
class TagBlock extends WeNode {
  @Property({ through: 'we://has_name', required: true }) name: string = '';
  @Property({ through: 'we://has_color' }) color: string = '';
}
```

Not a Lexical node — tags attach to other blocks via relationships (`@HasMany`), not inline in documents. No editor component needed.

### New: Embedding (1)

#### 13. EmbedBlock

Inline references to non-block entities (profiles, spaces, external resources, oEmbed content).

```typescript
@Model({ name: 'EmbedBlock' })
class EmbedBlock extends WeNode {
  @Property({ through: 'we://has_url' }) url: string = ''; // oEmbed URL (tweets, videos, etc.)
  @Property({ through: 'we://has_entity_id' }) entityId: string = ''; // DID or AD4M entity URI
  @Property({ through: 'we://has_entity_type' }) entityType: string = ''; // Profile | Space | etc.
  @Property({ through: 'we://has_display_mode' }) displayMode: string = 'card'; // card | inline | full
}
```

Editor component: `EmbedRenderer` — renders entity card or oEmbed widget based on type.

---

## Implementation

### Phase 1: Editor infrastructure (deferred from #5)

These items were originally scoped in #5 but deferred here because they're only needed when adding new block types. The existing 3-block setup works fine with direct imports and the current `ImageNode` Lexical node.

- [ ] Create `@we/block-system/shared/src/registry.ts` — `registerBlock()`, `blockRegistry` Map, `BlockRegistration` type, `resolveBlockType()` using registry lookup
- [ ] Create `@we/block-system/solid/src/GenericBlockNode.ts` — single Lexical `DecoratorNode` that looks up `editorComponent` from the registry by block type
- [ ] Extract ImageBlock SolidJS component from `@we/block-system/solid/src/components/ImageBlock/` to `@we/components` — split Lexical-coupled logic from pure display component
- [ ] Create `@we/block-system/solid/src/core-blocks.ts` — imports models + components, calls `registerBlock()` for each
- [ ] Update `@we/block-system/shared/src/serialization.ts` — use registry lookup instead of if-branches
- [ ] Update `BlockComposer.tsx` — use `GenericBlockNode` in nodes array instead of individual node classes

### Phase 2: Model definitions

- [ ] Add `variant`, `icon`, `style` fields to TextBlock for callout/divider support
- [ ] Create 10 new model files in `@we/models/src/blocks/`
- [ ] Export all from `@we/models` index
- [ ] Register all in model registry via `core-blocks.ts`

### Phase 3: Editor components (can be incremental)

Each new block type needs a SolidJS component in `@we/components` (or `@we/widgets` for complex ones) and a `registerBlock()` call in `@we/block-system/solid/src/core-blocks.ts`. All non-text blocks are rendered via `GenericBlockNode` — no custom Lexical nodes needed.

- [ ] Create editor components in `@we/components`
- [ ] Add `registerBlock()` calls to `core-blocks.ts`
- [ ] Add editor toolbar/slash command entries for inserting new block types

### Not in scope

- **TableBlock** — complex enough to defer; Lexical table support is a significant effort
- **Niche blocks** (PollBlock, DrawingBlock, ChartBlock etc.) — community/marketplace when demand exists

---

## Coverage Analysis

| App archetype    | Blocks used                                                             |
| ---------------- | ----------------------------------------------------------------------- |
| Notes / docs     | TextBlock, ImageBlock, CodeBlock, FileBlock, LinkBlock, CollectionBlock |
| Music player     | AudioBlock, ImageBlock, CollectionBlock, TagBlock                       |
| Calendar         | EventBlock, LocationBlock, TagBlock                                     |
| Project manager  | TaskBlock, TagBlock, CollectionBlock                                    |
| Social feed      | TextBlock, ImageBlock, VideoBlock, LinkBlock                            |
| Bookmarks        | LinkBlock, TagBlock, CollectionBlock                                    |
| Wiki             | TextBlock, ImageBlock, CodeBlock, EmbedBlock, LinkBlock                 |
| Chat / messaging | TextBlock, ImageBlock, FileBlock, AudioBlock, VideoBlock, EmbedBlock    |
| Blog             | TextBlock, ImageBlock, CodeBlock, LinkBlock, CollectionBlock            |

All 9 archetypes covered by the 13 core blocks.
