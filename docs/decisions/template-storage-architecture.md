# Decision: Template Storage Architecture — Monolith + Stored Index

## Status

**Accepted** — implementation in progress on `feat/schema-customization`.

## Context

WE's schema customization feature allows users (and AI) to edit, share, and remix UI templates. The main template (`weNativeApp.ts`) is ~1,519 lines of JSON — too large to edit as a single unit, especially for AI context windows. We need a way to:

1. **Store** templates persistently in AD4M (replacing localStorage)
2. **Scope** edits to manageable sections (~50–150 lines each)
3. **Share** templates and template sections between users
4. **Support** reorganization — moving panels between routes, adding routes, merging sections

Three approaches were evaluated.

## Approaches Considered

### Approach 1: Stored Sections with `$section` Token

The original architecture proposal. Templates are split into stored `SchemaSection` entities. A skeleton template references them via `$section` tokens that get resolved at assembly time.

```
Template (skeleton with $section refs)
  ├── SchemaSection "navigation:left"   → stored blob
  ├── SchemaSection "route:/"           → stored blob
  ├── SchemaSection "route:/list"       → stored blob
  └── ...
```

**Assembly:** `assembleTemplate()` walks the skeleton, replaces `$section` tokens with the referenced section JSON, producing a complete schema tree for the renderer.

#### Why it was rejected

1. **Deep nesting breaks naive splitting.** The `route:/` subtree is 630 lines with deep nesting. Splitting only at direct children produces sections that are still too large. Recursive sub-sectioning works but introduces naming stability problems.

2. **Section drift.** The skeleton and sections are separate stored entities that must stay in sync. Edits that reorganize the tree — moving a panel from one route to another — require updating both the section content AND the skeleton's `$section` references. This is a parallel tree maintenance burden that's easy to get wrong.

3. **Structural rigidity.** Reorganization fights the section boundaries. Adding a new route means creating a new section entity AND adding a `$section` ref to the skeleton. Merging two panels means deleting a section, merging its content into another, and updating the skeleton. Every structural change is a multi-entity transaction.

4. **Naming stability.** Section keys must survive re-sectionization. If you add a child above an existing section, does the key change? Comment-based naming (from `// @section` annotations) is fragile. Any rename scheme risks breaking references in shared templates, undo history, and AI conversations that reference sections by key.

5. **Complexity budget.** Requires: `SchemaSection` model, `$section` token, sectionize algorithm, `resolveSection`, `assembleTemplate`, section UUID management, `@HasMany` hydration. Each is small individually, but the aggregate is a significant surface area to maintain.

### Approach 2: Monolith + Computed Index (read-time)

Store the full template as a single JSON blob. Compute the section index on every read by tree-walking the schema. No stored sections, no `$section` token.

```
Template
  └── schema (single blob via file-storage language)
      └── Full JSON tree (~1,519 lines)

Index computed at read time:
  route:/           → path [1, -1, 0]
  navigation:left   → path [1, 0]
  panel:/:stats     → path [1, -1, 0, 0, 0, 1, 0]
  ...
```

**Section access:** `loadSection(key)` tree-walks the blob, computes the index, extracts the subtree at the indexed path. `saveSection(key, json)` patches it back.

#### Why it was refined

The core idea is sound — a single blob eliminates section drift, structural rigidity, and the entire `$section`/assembly machinery. But computing the index on every read has a collaboration problem:

- **Key divergence.** If two clients independently compute sections from the same tree, they'll produce identical results. But if the indexer algorithm is ever updated (bug fix, new heuristic), clients on different versions could compute different keys for the same template. A section reference in a shared conversation ("edit `panel:/:stats-cards`") becomes ambiguous.

- **No stable contract.** The section index is an emergent property of the algorithm, not a stored fact. There's no way to inspect what sections a template "has" without running the algorithm — which means the answer depends on which version of the algorithm you're running.

For a single-user system this is fine. For a collaborative system where templates are shared and AI conversations reference sections by key, it's a latent fragility.

### Approach 3: Monolith + Stored Index (chosen)

Same single-blob storage as Approach 2, but the section index is computed once (at creation time, and after structural edits) and **stored alongside the schema** in the blob.

```
Template
  └── schema (single blob via file-storage language)
      └── StoredTemplate {
            schema: { ... full JSON tree ... },
            sections: [
              { key: "route:/",         type: "route",      path: [1, -1, 0], sizeEstimate: 630 },
              { key: "navigation:left", type: "navigation", path: [1, 0],     sizeEstimate: 120 },
              { key: "panel:/:stats",   type: "panel",      path: [...],      sizeEstimate: 85  },
              ...
            ]
          }
```

**Section access:** `loadSection(key)` looks up the path in the stored index, extracts the subtree. `saveSection(key, json)` patches the subtree back, saves the blob. No tree-walk needed for reads.

**Re-indexing:** Only runs when the tree structure changes (add/remove/move nodes). Targeted edits within a section (changing props, swapping a component) don't trigger re-indexing.

## Why Approach 3 Is Best For Now

### vs. Stored Sections (Approach 1)

| Concern           | Stored Sections                                             | Monolith + Stored Index                    |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------ |
| Reorganization    | Multi-entity transaction (content + skeleton + key renames) | Edit tree, re-index — done                 |
| Adding routes     | Create section entity + add skeleton ref                    | Add route node, re-index — auto-discovered |
| Section drift     | Skeleton and sections can desync                            | Single source of truth                     |
| Sharing           | Must package/reassemble sections                            | Subtree extraction — JSON in, JSON out     |
| Storage           | N blobs + skeleton                                          | 1 blob                                     |
| New models/tokens | `SchemaSection`, `$section`, assembly                       | None                                       |
| Complexity        | High (5 new concepts)                                       | Low (indexer + path utilities)             |

### vs. Computed Index (Approach 2)

| Concern           | Computed (read-time)                           | Stored (creation-time)                            |
| ----------------- | ---------------------------------------------- | ------------------------------------------------- |
| Key stability     | Depends on algorithm version                   | Stored — identical across all clients             |
| Shared references | "edit panel:/:stats" might resolve differently | Same key = same path, always                      |
| Performance       | Tree-walk on every read                        | Lookup in stored array                            |
| Algorithm updates | Silently changes existing templates' sections  | Only affects new templates (or explicit re-index) |
| Inspectability    | Must run algorithm to see sections             | Sections are data — queryable, displayable        |
| Offline/async     | Both clients must agree on algorithm           | Index travels with the blob                       |

### Summary

Approach 3 gets the structural simplicity of a monolith (no section drift, no assembly, no `$section` token) with the collaboration safety of stored data (keys are facts, not computed properties). It's the minimum viable architecture that supports sharing and AI editing without latent fragilities.

## Trade-offs and Limitations

1. **Index staleness.** If an edit modifies the tree structure but doesn't trigger re-indexing, paths in the stored index become stale. The API must enforce re-indexing after structural changes. This is a correctness invariant that must be maintained by the section API — not by callers.

2. **Monolith fetch.** Every section load fetches the entire blob, then extracts a subtree. For ~1,500 lines of JSON this is negligible (<50KB). If templates grow to 10,000+ lines, lazy section loading would matter — but that's a bridge to cross later.

3. **No partial updates.** Saving a section means fetching the blob, patching the subtree, and writing the entire blob back. No partial writes. Again, fine at current scale.

4. **Path fragility.** Sections are addressed by numeric tree paths (`[1, -1, 0, 0, 1]`). If a structural edit shifts sibling indices, stored paths become wrong. This is why re-indexing must happen after structural changes — the paths are only valid for the version of the tree they were computed against.

## Future Considerations

### CRDT-based Co-editing

The current architecture assumes **last-write-wins** semantics — the most recent `saveTemplate` or `saveSection` overwrites the blob. This is fine for single-user editing and async collaboration (share a template, recipient edits their copy), but doesn't support real-time co-editing where two users edit different sections simultaneously.

To support real-time co-editing:

- **JSON CRDT** (e.g., Automerge, Yjs with JSON binding) could replace the raw JSON blob. Each section edit becomes a CRDT operation that merges automatically. The stored index would need to be derived from the CRDT state or stored as a separate CRDT document.

- **Section-level CRDTs** — each section could be an independent CRDT document, bringing back some of the multi-entity complexity of Approach 1 but with automatic merge semantics. The section index would coordinate which CRDT documents compose the template.

- **Operational Transform** — AD4M's perspective sync (p-diff-sync) already handles link-level conflict resolution. If template edits are expressed as perspective link operations rather than blob overwrites, the existing sync infrastructure might handle co-editing. This would require decomposing the monolith blob back into granular links — essentially Approach 1 at the AD4M layer.

The stored index approach doesn't preclude any of these paths. The `StoredTemplate` wrapper is an abstraction boundary — the internal representation can change from "JSON blob" to "CRDT document" without changing the section API (`loadSection`/`saveSection`).

**Recommendation:** Don't design for co-editing now. Ship with last-write-wins, which is correct for the initial use cases (personal customization, async template sharing). Add CRDT co-editing as a separate architectural decision when there's a concrete need, informed by how users actually share and remix templates.

### Section Versioning and Diff

The current plan includes `pushHistory(templateId, patch)` for undo via JSON Patch diffs. This could extend to:

- **Section-level history** — track which sections changed in each version, enabling section-scoped undo
- **Template diffing** — compare two templates section-by-section, useful for "what changed in this shared update?"
- **Merge tooling** — when importing a shared template that conflicts with local edits, show per-section diffs and let the user choose

These are additive features that build on the stored index without changing the core architecture.

### Template Composition

A future direction could allow templates to **reference** other templates — e.g., "use the navigation from Template A but the main content from Template B." This would reintroduce a form of section referencing (like Approach 1's `$section`) but at the template level rather than the section level.

The stored index makes this feasible: given two templates with known section keys, a composition operation can extract sections by key from each and assemble a new template. This is a higher-level operation that doesn't need to be built into the storage layer.
