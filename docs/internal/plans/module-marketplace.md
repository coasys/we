# Module Marketplace — Design Conclusions

## Overview

A decentralised marketplace enabling the community to publish, discover, rate, and install four module types: **Components**, **Blocks**, **Templates**, and **Themes**. The goal is to let communities extend WE independently of the core team, with AD4M as the distribution layer rather than npm.

---

## Module Types & Distribution Strategy

### Templates

- Pure JSON schema data — no code execution risk
- Distribute entirely via AD4M (`FILE_STORAGE_LANGUAGE`) from day one
- Install: fetch expression → deserialise → add to local `templateRegistry`
- Persisted in agent's local perspective to survive restarts

### Themes

- Pure data: CSS string + structured token overrides
- Distribute entirely via AD4M (`FILE_STORAGE_LANGUAGE`) from day one
- Install: fetch expression → deserialise → add to local `themeRegistry`

### Blocks

- Have a clean, stable interface contract (`registerBlock(nodeType, { model, displayComponent, inputComponent })`)
- Distribute as compiled ESM bundles stored as `FILE_STORAGE_LANGUAGE` expressions
- Install: fetch JS bundle expression → `import(expressionUrl)` dynamically → `registerBlock()`
- Store expression URL locally to re-register on next boot
- **Skip npm entirely**

### Components

- Hardest due to framework coupling (currently Solid.js JSX)
- **Phase 1**: Web Components (Custom Elements) as the exchange format — framework-agnostic, sandboxed by default, weaker authoring experience but safe
- **Phase 2** (later): Federated ESM with Solid runtime as external peer dep, for tighter integration
- **Skip npm entirely** — design architecture npm-free from the start; an npm bridge adapter can be added later if needed without rearchitecting

---

## Infrastructure

### Marketplace Location

- **Dedicated marketplace neighbourhood**, not the global neighbourhood
- Global neighbourhood holds a pointer to it
- Clean governance: separate permission model (not everyone in the global neighbourhood can publish)
- `we-seed.json` references the marketplace neighbourhood URL as a known constant so all WE clients find it automatically

### Module Metadata Schema

Each marketplace entry is a `FILE_STORAGE_LANGUAGE` expression containing:

```json
{
  "id": "unique-module-id",
  "type": "block | template | theme | component",
  "name": "...",
  "description": "...",
  "icon": "<FILE_STORAGE expression URL>",
  "screenshots": ["<URL>", "..."],
  "author_did": "did:key:...",
  "version": "1.2.0",
  "we_compatibility": ">=0.4.0",
  "content_url": "<FILE_STORAGE expression URL for the actual module>",
  "tags": ["layout", "cards"],
  "license": "MIT",
  "dependencies": ["<other-module-id>"]
}
```

Ratings and reviews are triples on the metadata expression:

- `we://rating` — integer 1–5, one per agent DID
- `we://review` — text review, linked to reviewer's public profile
- Aggregates computed client-side

### Developer On-Ramp (CLI)

- `we-module create <type> <name>` — scaffold from a template with correct folder structure and build config
- `we-module build` — compile to correct output format (ESM for blocks/components, validated JSON/CSS for templates/themes)
- `we-module publish` — upload to `FILE_STORAGE_LANGUAGE`, create/update marketplace entry, sign with author's DID
- `we-module.json` manifest at module project root (like `package.json` but WE-specific)

### Dependency Resolution

- Depth-first install of declared dependencies
- A lockfile concept can come later; ordered install is sufficient to start

---

## UI

### Marketplace Browser (dedicated route in global neighbourhood)

- Filter by type, tags, rating
- Module cards: icon, name, author handle + DID badge, star rating, install count, type chip
- Module detail: full description, screenshots carousel, version history, reviews, author profile, one-click install
- Compatibility indicator (works with current WE version or not)

### My Modules (Settings)

- Installed list grouped by type
- Update available indicator
- Enable/disable toggles
- Uninstall

### Publisher Dashboard

- List of published modules with install stats and ratings
- Edit metadata, upload new version
- Basic analytics (installs per day)

---

## Open Questions / Future Work

1. **Security sandbox** — untrusted component/block code must not be able to exfiltrate agent credentials or corrupt the host. Web Workers + CSP are the main levers; trust model needs deliberate design.
2. **Marketplace neighbourhood bootstrapping** — who creates it, how is its address distributed, who are the initial moderators?
3. **Update policy** — auto-update vs user-approved. Given code execution risk, user-approved updates are safer.
4. **Offline/caching** — installed modules must work without network access; local persistence strategy needed.
5. **npm bridge** — if ever needed, add as a thin adapter layer that mirrors npm publishes into the marketplace. Don't design for it upfront.

---

## Implementation Order

**Do this before the marketplace:**

→ **Per-neighbourhood templates** (see `per-neighbourhood-templates.md`) — spaces need to be able to define their own template. The marketplace itself needs a custom UI, so this is a prerequisite. Building it also solves template distribution on-demand, which is the core of the marketplace applied to templates specifically.

**Recommended marketplace build order:**

1. Templates (data-only, proves the schema + UI)
2. Themes (also data-only, minimal delta)
3. Blocks (first code-execution module, proves the dynamic import pattern)
4. Components (Web Components phase first, native Solid phase later)
