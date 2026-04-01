# Schema Customization (#6) — Review Notes

> Review of [schema-customization-architecture.md](schema-customization-architecture.md) against current codebase state.

## Architecture pivot: Monolith + computed index

**Key change from original plan:** Instead of splitting templates into stored `SchemaSection` entities with a `$section` token and assembly step, we store the **full template as a single JSON blob** (via file-storage language) and compute section indexes at read time by tree-walking.

This eliminates: `SchemaSection` model, `$section` token, sectionizing algorithm, `resolveSection`, assembly step, section key naming/stability concerns.

This keeps: `Template` model (simplified, renamed from `TemplateInstall`), file-storage pattern, gallery, sharing, theme, section taxonomy (computed, not stored).

See [point 5](#5-sectionizing-algorithm-revised--monolith--computed-index) for full rationale.

---

## 1. ~~Schema size is ~320 lines, not 900~~ RESOLVED

`weNativeApp.ts` is actually **1,519 lines** — even larger than the plan's 900-line estimate. The sectioning rationale is strongly justified. Sections of ~50–150 lines each will be a major improvement for AI context windows.

**Action:** None — plan's reasoning is sound. The 900-line figure could be updated to ~1,500 but the architecture holds regardless.

---

## 2. Template schema storage — file-storage language

AD4M's `Literal` system supports `literal://json:%7B...%7D` — objects are URL-encoded JSON strings in link targets. `@Property` is type-agnostic at decoration time; all values serialize to `literal://` URIs.

### The problem with inline JSON

The full template is ~1,519 lines of JSON. As a `literal://json:` link target that's ~50–100KB URL-encoded in the perspective's link store. Even individual sections would be 5–30KB each. This bloats the graph and prevents lazy loading.

### Recommendation: **File-storage language**

Store the full template blob via AD4M's existing file-storage language. The `Template.schema` property holds a content-addressed URI. `resolveLanguage: FILE_STORAGE_LANGUAGE` + `transform` auto-resolves on read.

This pattern is already proven in the codebase — `ImageBlock` uses it. Benefits:

- Graph stays tiny (just a URI link, not a 100KB encoded blob)
- Content-addressed = free deduplication
- Single blob = single fetch (no N+1 section loading)
- Proven pattern, zero new infrastructure

```typescript
@Property({
  through: 'we://has_template_schema',
  resolveLanguage: FILE_STORAGE_LANGUAGE,
  transform: (data: FileData | string | null) => {
    if (data && typeof data === 'object' && 'data_base64' in data) {
      return JSON.parse(atob(data.data_base64));
    }
    return typeof data === 'string' ? JSON.parse(data) : data ?? {};
  }
})
schema: TemplateSchema = {} as TemplateSchema;
```

**Action:** Use file-storage language for the template schema blob on `Template`.

---

## 3. ~~`TemplateInstall.active` is `string` instead of `boolean`~~ RESOLVED

AD4M fully supports boolean properties — stored as `literal://boolean:true|false`. The AD4M test suite uses `completed: boolean = false` directly. The plan's `active: string = 'false'` was likely a conservative choice.

**Action:** Use `active: boolean = false` in the model.

---

## 4. `$section` resolves at assembly time, not render time — CONFIRMED

The plan's `assembleTemplate` (section 6 of the architecture doc) already shows `$section` being resolved before the schema reaches the renderer. `resolveSection` replaces `{ $section: "navigation:left" }` with the actual section JSON, producing a plain `TemplateSchema` tree. The SchemaRenderer never sees `$section` tokens — no renderer changes needed.

If we later want **reactive section swapping** (hot-swap one section without re-assembling the full template), we could add `$section` as a render-time token. But that's a future optimization — re-assembly of ~10 sections is cheap.

**Action:** None — plan is correct as-is. Worth adding an explicit note in the architecture doc that `$section` is assembly-time only, to avoid confusion with the render-time tokens (`$if`, `$each`, `$routes`).

---

## 5. ~~Sectionizing algorithm~~ REVISED — Monolith + computed index

### Original plan: stored sections

The original architecture proposed splitting templates into stored `SchemaSection` entities with a `$section` token for assembly. Investigating actual template structure revealed problems:

- `route:/` is 630 lines with deep nesting — naive direct-child splitting fails
- Recursive sub-sectioning works but introduces naming stability risks (comment-based keys are fragile)
- Section drift: edits that reorganize the tree (moving nodes between sections, merging panels) require updating both section content AND the skeleton's `$section` references — a parallel tree maintenance burden
- Structural rigidity: reorganization (moving a panel from one route to another, adding a new route with content from existing sections) fights the section boundaries

### Revised recommendation: Monolith + computed index

Store the **full template as a single JSON blob** in file-storage. Sections become a **read-time computed concept**, not a storage concept.

#### How it works

1. **Storage:** One blob per template, stored via file-storage language (content-addressed URI)
2. **Index:** A tree-walk function computes a section index on read — identifying navigable regions by tree structure (routes, sidebars, large child groups)
3. **Section access:** `loadSection(key)` extracts a subtree by path from the blob. `saveSection(key, json)` patches it back in. No stored section entities.
4. **Full access:** `loadTemplate()` / `saveTemplate(schema)` for operations that need the whole tree (reorganization, structural changes, full export)

#### Data model

```typescript
@Model({ name: 'Template' })
class Template extends WeNode {
  @Property({ through: 'we://template_name' })
  name: string = '';

  @Property({ through: 'we://template_origin' })
  origin: string = '';  // 'built-in' | 'shared' | 'custom'

  @Property({ through: 'we://template_active' })
  active: boolean = false;

  @Property({ through: 'we://template_version' })
  version: number = 1;

  @Property({
    through: 'we://has_template_schema',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: (data) => /* decode base64 → JSON */
  })
  schema: TemplateSchema = {} as TemplateSchema;
}

// Computed at read time, NOT stored
interface TemplateIndex {
  sections: SectionEntry[];
}

interface SectionEntry {
  key: string;        // e.g. "route:/", "navigation:left", "route:/:stats-cards"
  type: string;       // "route" | "navigation" | "panel"
  path: number[];     // tree path for extraction: [2, 0, 1, 3]
  lineEstimate: number;
}
```

#### API surface

```typescript
// Section-level (targeted edits — most common AI operation)
listSections(templateId): SectionEntry[]       // tree-walk, compute index
loadSection(templateId, key): SchemaNode       // extract subtree by path
saveSection(templateId, key, json): void       // patch subtree back, save blob

// Template-level (reorganization, structural changes)
loadTemplate(templateId): TemplateSchema       // full blob
saveTemplate(templateId, schema): void         // replace entire blob

// History
pushHistory(templateId, patch): void           // JSON patch diff for undo
undo(templateId): void                         // apply inverse patch
```

#### Why this is better

| Concern                  | Stored sections                                                                       | Monolith + computed index                                   |
| ------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Reorganization**       | Move nodes between sections → update content + skeleton refs + possibly rename keys   | Just edit the tree — sections recompute                     |
| **Adding routes**        | Create new section + add `$section` ref to skeleton                                   | Add route node to tree — index auto-discovers it            |
| **Naming stability**     | Keys must survive re-sectionization; comment-based naming is fragile                  | Keys are computed fresh each read — renaming is free        |
| **Section drift**        | Content can desync from skeleton refs                                                 | No refs to desync — single source of truth                  |
| **AI editing**           | AI loads one section, edits, saves section                                            | Same — `loadSection` / `saveSection` scoped read/write      |
| **Full template export** | Must assemble all sections                                                            | Already a blob — just read it                               |
| **Storage overhead**     | N section blobs + skeleton                                                            | 1 blob (simpler, same total size)                           |
| **Complexity**           | SchemaSection model, `$section` token, sectionize algorithm, resolveSection, assembly | Template model, tree-walk indexer, path-based extract/patch |

#### What this eliminates from the original plan

- `SchemaSection` model — gone
- `$section` token — gone
- `sectionizeTemplate` algorithm — gone (replaced by computed index)
- `resolveSection` / `assembleTemplate` — gone (no assembly needed)
- Section key naming/stability concerns — gone

#### What stays

- `Template` model (simplified — schema is the blob, not section refs)
- File-storage language pattern (now for whole template, not per-section)
- Gallery, sharing, activation — unchanged
- Theme system — unchanged
- Section _taxonomy_ (route, navigation, panel) — used for computed index classification, not storage

#### Section index computation

The tree-walk indexer identifies sections by structural cues:

1. **Routes:** nodes inside a `$routes` array → each gets `route:<path>`
2. **Navigation:** `CollapsibleSidebar` or similar landmark components → `navigation:left`, `navigation:right`
3. **Panels:** within a route, children exceeding ~200 lines get recursively indexed as `panel:<route>:<qualifier>`
4. **Qualifier inference:** component type, distinguishing prop value, or child index as fallback

This is the same taxonomy as the original plan — it's just computed on read instead of baked into storage.

#### Section sharing

Sharing a section works naturally with the monolith approach — a "section" for sharing is just an extracted JSON subtree:

1. `loadSection(templateId, "route:/:stats-cards")` → extract subtree JSON
2. Package as a sharing payload: `{ key, type, schema: <subtree>, meta: { author, description } }`
3. Send via AD4M's social layer (neighbourhood post, direct message, or exported file/URI)
4. Recipient calls `importSection(templateId, targetKey, receivedJson)` → path-based patch into their template blob

No stored section entities needed — the subtree IS the shareable unit. AD4M provides the transport: neighbourhoods for community sharing, DM languages for 1:1, or plain JSON export.

#### Naming: `Template` not `TemplateInstall`

The original plan distinguished gallery listings from installed copies. Since we don't have a separate gallery-listing entity — `origin` (`'built-in' | 'shared' | 'custom'`) captures provenance — the simpler name `Template` is sufficient. If a gallery-listing model is needed later, it can be named specifically (`TemplateListing`, `SharedTemplate`, etc).

**Action:** Rewrite the architecture plan around monolith + computed index. Remove SchemaSection, $section, sectionize, and assembly. Add tree-walk indexer and path-based extract/patch.

---

## 6. Scope — single PR, separate commits DECIDED

All in one PR with separate commits for logical groupings:

1. **Commit: Model** — `Template` model (file-storage backed)
2. **Commit: Indexer** — tree-walk section indexer, `SectionEntry` types
3. **Commit: API** — `loadSection`/`saveSection`, `loadTemplate`/`saveTemplate`
4. **Commit: Store integration** — TemplateStore reads/writes from AD4M Spaces instead of localStorage
5. **Commit: Gallery** — Gallery UI, built-in template browsing/activation
6. **Commit: Sharing** — sharing payloads, import/merge
7. **Commit: History** — version history + undo

**Action:** None — decided.

---

## 7. ~~`@HasMany` on `TemplateInstall` — manual hydration~~ SUPERSEDED

The original plan used `sections: string[]` with `@HasMany({ through: 'we://has_section' })` to link `TemplateInstall` → `SchemaSection` entities.

With the monolith + computed index approach, there are no stored `SchemaSection` entities. `Template.schema` is a single file-storage blob containing the full template. No `@HasMany`, no section UUIDs, no hydration queries.

**Action:** None — this concern is eliminated by the architecture change.

---

## 8. ~~No migration path for localStorage templates~~ DECIDED — drop entirely

localStorage template saving is dropped. Templates are stored in AD4M perspectives (Spaces). The main We app will let users create perspectives on boot (saved as Spaces). When saving a template, users choose which Space to store it in, or create a new one.

This also answers the AD4M perspective question (Q2 below) — no single dedicated perspective. Templates live in user-created Spaces, giving users control over organization and sharing scope.

**Action:** Remove all localStorage template persistence. TemplateStore reads/writes from AD4M Spaces.

---

## Questions — RESOLVED

1. **Scope** — One PR, separate commits. ✅
2. **AD4M perspective** — No dedicated perspective. Templates stored in user-created Spaces. Users choose where to save (or create a new Space). ✅
3. **Priority** — Primary motivation: **sharable, remixable UIs**. This drives the architecture — sections as shareable subtrees, gallery for discovery, import/merge for remixing. ✅
