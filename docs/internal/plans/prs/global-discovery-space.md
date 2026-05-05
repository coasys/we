# PR Plan: Global Discovery Space

## Overview

Introduce a shared global neighbourhood that users can optionally join, enabling public discovery of spaces and agents via a Cesium globe. When users make a space "public" or join the global neighbourhood, lightweight profile/space entries are published there. The globe becomes the primary discovery UI — pins for users and spaces, click-to-modal details, and signals for community interaction.

---

## Motivation

Currently users can create spaces (AD4M perspectives) and view their own in the default or custom templates, but there is no mechanism to discover what other users and communities exist. This feature introduces opt-in public discoverability while preserving full privacy for personal and shared-but-unlisted spaces.

---

## Design Decisions

### Space Visibility: Three-Way Split

The current `visibility` field on `Space` is a plain string, so the model change is minimal. Proposed semantics:

| Value      | Meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `personal` | Local perspective only, not published                               |
| `shared`   | Published as neighbourhood, discoverable via direct link            |
| `public`   | Published as neighbourhood + mirrored entry in global neighbourhood |

`public` is a strict superset of `shared` — it creates a neighbourhood AND registers the space in the global discovery layer. The `CreateSpaceModal` uses **two dependent toggles**:

1. **"Shared with network"** — toggle 1, personal ↔ shared. Publishes the space as a joinable neighbourhood.
2. **"Listed in Global Discovery"** — toggle 2, hidden ↔ public. Disabled (and reset to hidden) when toggle 1 is personal. Registers the space in the global neighbourhood so it appears on the globe.

This makes the dependency visually explicit: you can't list a space globally if it isn't a neighbourhood first. If toggle 1 is turned off after toggle 2 was enabled, toggle 2 retains its last value so the choice is preserved if the user re-enables sharing. The two boolean `$local` values are combined into the final `visibility` string (`personal` / `shared` / `public`) at submit time.

### Global Neighbourhood Bootstrapping

- The WE team publishes the canonical global neighbourhood once and hard-codes its URL (similar to how link language templates are bootstrapped in AD4M).
- The URL lives in `we-seed.json` (or a constants file) so enterprise deployments can override it with their own.
- On boot, `initSystemPerspectives` gains a `we-global` case: if `agentSettings.globalSpaceJoined === true`, join/connect to the stored URL. No automatic join — always opt-in.
- The opt-in prompt lives on the **home route**, not in the boot flow. Boot is already fragile.

### Dev / Test Mode — Local `we-global`

Following the same pattern as `we-test`, `initSystemPerspectives` checks whether a `globalSpaceUrl` is present in the seed config:

- **No URL (dev / self-hosted)**: auto-create a local `we-global` perspective, register `Space` and `AgentProfile` models on it, and skip the neighbourhood publish step entirely. This gives a fully functional local sandbox — `Space.findAll(globalPerspective)` works identically regardless of whether the perspective is networked.
- **URL present (prod / staging)**: join the real neighbourhood via `client.neighbourhood.joinFromURL(url)` as normal.

The `agentSettings.globalSpaceJoined` opt-in flag still applies in both cases — the "join" UX flow still runs in dev, it just operates on the local perspective under the hood.

For multi-user integration testing (two agents discovering each other on the globe), a separately published test neighbourhood is needed — this is an integration test concern and doesn't need to be solved in PR 1.

The local `we-global` perspective should also be seeded with a handful of synthetic `Space` and `AgentProfile` records (like `we-test` seeds data for `$query` testing) so the globe route renders something meaningful immediately without requiring a second user.

### Global Entries — Full Model Copies

The global neighbourhood stores full `Space` and `AgentProfile` instances rather than lightweight stubs. The key reason: both models store images via `resolveLanguage: FILE_STORAGE_LANGUAGE`, so `FILE_STORAGE_LANGUAGE` must be registered in the global perspective regardless. Since that registration cost is unavoidable, there's no meaningful saving in stripping fields down to a stub — and full copies give the discovery UI (cards, globe pins, modals) complete fidelity including thumbnails, cover images, and descriptions with no extra model classes to maintain.

`AgentProfile.coverImage` is included in the sync so discovery cards can render a full profile layout.

Sync happens in `createSpace` (for spaces) and `updateAgentProfile` (for agent data) when the global neighbourhood is joined. The sync is a straightforward copy — `new Space(globalPerspective)` / `new AgentProfile(globalPerspective)` — using the same save/query API as any other perspective.

### Coordinates on Models

Neither `AgentProfile.location` (free text) nor `Space.locations` (`string[]`) carries structured coordinates for globe pins. Rather than adding raw `latitude`/`longitude` fields to these entities, structured location data is stored via the existing `LocationBlock` model.

`LocationBlock` already has `latitude`, `longitude`, `name`, and `address`. It needs two new optional properties: `city?: string` and `country?: string`. These enable globe filtering and grouping (e.g. "show all spaces in Germany") that a free-text `address` field cannot support.

**Relations:**

- `AgentProfile` → `HasOne` location (`LocationBlock`) — a user has a single home base. `HasOne` is a native AD4M decorator that enforces scalar cardinality.
- `Space` → `HasMany` locations (`LocationBlock`), **multiple entries permitted** (a community may have chapters in several cities, each showing as a distinct globe pin).

The existing `Space.locations: string[]` HasMany (using `we://has_location`) is already present on the model — this becomes the typed `LocationBlock` relation. `AgentProfile` gains a `HasOne` typed location relation.

For PR 2, a `LocationPicker` component (click-to-place pin on a simplified globe) handles input. For PR 1, a plain text input for manual lat/lng entry is acceptable as a placeholder.

### Privacy / Consent

When a user joins the global neighbourhood, their full `AgentProfile` instance (including name, handle, images, bio, coordinates) is written into the global perspective. This must be:

- Explicitly confirmed at time of joining, not implicit
- Reversible: leaving the global space removes their `AgentProfile` entry from the global perspective

### Signals in the Global Space

`Signal`/`SignalType` instances already work per-perspective. The global neighbourhood gets its own set of `SignalType` instances (seeded with defaults on first join: 👍, ⚡, etc.). Key constraints:

- Signals on a public space or user are attached **in the global neighbourhood perspective** — global reputation, not local interaction.
- The signal target uses a stable identifier: agent DID for users, space UUID/URL for spaces.

---

## Open Questions

1. **Global neighbourhood scale** — _Deferred. Infrastructure will be adapted as needed when scale becomes a concern; no premature optimisation in PR 1–3._
2. **`AgentProfile` extends `Ad4mModel` not `WeNode`** — _Resolved._ Migrate `AgentProfile` to `extends WeNode` (same as `Space`). Extend the same treatment to `SignalType` — people may want to react to and comment on signal types, which requires full `WeNode` capability. `Signal` (the reaction event itself) remains `extends Ad4mModel` as it is a lightweight edge record, not a node people navigate to or embed.
3. **Joining without a neighbourhood URL** — _Resolved._ See Dev / Test Mode section above.  
   **Sub-question:** Should `we-global` be initialised with a root `Space` model instance representing the global space itself? _Yes._ A consistent `Space`-at-root structure enables holonic / fractal organisation — spaces containing subspaces at every level of the hierarchy. The UI can reuse the same map-with-members rendering at each level, and `we-global` becomes the outermost `Space` in a uniform hierarchy rather than a special case.
4. **Removing public status** — If a user sets a space back from `public` to `shared`, the `Space` copy in the global neighbourhood must be deleted. Needs a removal path in `createSpace` / a new `updateSpaceVisibility` action.

---

## Implementation Plan

One PR, delivered in logical commits so the history is readable and any phase is independently revertable.

### Commit 1 — Model migrations (`AgentProfile`, `SignalType` → `WeNode`)

_Isolated prep commit. Touches existing functionality; easiest to revert if regressions appear._

- [ ] Migrate `AgentProfile` from `extends Ad4mModel` to `extends WeNode`
- [ ] Migrate `SignalType` from `extends Ad4mModel` to `extends WeNode` (`Signal` stays `extends Ad4mModel`)

### Commit 2 — Location model extensions

- [ ] Add `city?: string` and `country?: string` properties to `LocationBlock`
- [ ] Update `Space.locations` HasMany to use typed `LocationBlock` relation (predicate already exists: `we://has_location`)
- [ ] Add `location` `HasOne` (`LocationBlock`) to `AgentProfile`

### Commit 3 — Global neighbourhood bootstrap

- [ ] Add `globalSpaceJoined: boolean` and `globalSpaceUrl: string` to `AgentSettings`
- [ ] Extend `initSystemPerspectives` in `AdamStore` to handle `we-global`: auto-create local perspective (no URL) or join real neighbourhood (URL present), both gated on `agentSettings.globalSpaceJoined`
- [ ] On first `we-global` create/join, write a root `Space` instance representing the global space itself (holonic pattern — `we-global` is the outermost `Space` in a uniform hierarchy)
- [ ] Register `Space`, `AgentProfile`, `SignalType`, and `FILE_STORAGE_LANGUAGE` models on `we-global` perspective
- [ ] Seed synthetic `Space` / `AgentProfile` records into local `we-global` for dev testing (mirrors `we-test` seed data approach)
- [ ] Add `joinGlobalSpace` action to `AdamStore`
- [ ] Add `globalSpaceUrl` constant to `we-seed.json`

### Commit 4 — Sync & global store

- [ ] Extend `createSpace` to support `'public'` visibility: publishes neighbourhood + copies `Space` instance into global perspective; adds removal path when visibility drops back to `shared`
- [ ] Update `updateAgentProfile` to sync full `AgentProfile` copy (including images) into global perspective when joined; remove entry on leave
- [ ] New `GlobalStore` with `publicSpaces: Accessor<Space[]>` and `publicAgents: Accessor<AgentProfile[]>` (queried from global perspective), plus `selectedGlobalEntity` signal

### Commit 5 — Opt-in join UX & space visibility UI

- [ ] "Join the WE Global Space" opt-in card on the home route (dismiss-able, persists in `AgentSettings`)
- [ ] Update `CreateSpaceModal` with two dependent toggles: "Shared with network" + "Listed in Global Discovery" (disabled when personal)

### Commit 6 — Globe wiring & discovery modals

- [ ] Hook `CesiumGlobe` globe route up to `globalStore.publicSpaces` and `globalStore.publicAgents`
- [ ] Add `spaceLocationsLayer` factory to `@we/cesium-layers` for space pins
- [ ] Add `agentLocationsLayer` factory (or extend existing `userLocationsLayer`) for agent pins with distinct colour/icon
- [ ] `GlobalEntityModal` schema: renders either a `Space` card or `AgentProfile` card depending on entity type (full fidelity — thumbnail, cover image, description, bio), with a "Join Space" or "View Profile" action
- [ ] Global Space / Discover route in sidebar navigation (WeTemplate and DefaultTemplate)

### Commit 7 — `LocationPicker` component & location fields

- [ ] `LocationPicker` component — simplified globe or map, click to place pin, emits `{ latitude, longitude }`
- [ ] Add location field to `CreateSpaceModal` (uses `LocationPicker`)
- [ ] Add location fields to `Profile.schema.ts` edit section (uses `LocationPicker`)

### Commit 8 — Global signals

- [ ] Seed default `SignalType` instances in global neighbourhood on first join
- [ ] Signal attachment UI in `GlobalEntityModal` (react bar / emoji picker)
- [ ] Signal aggregation query (`aggregateSignals`) scoped to global perspective, keyed by target DID / UUID
- [ ] Display signal aggregates on globe pins (e.g., pin size or glow scale by total signal energy)

---

## Affected Files (preliminary)

| File                                                                                             | Change                                                                 |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `packages/models/src/blocks/LocationBlock.ts`                                                    | Add `city?`, `country?` properties                                     |
| `packages/models/src/entities/Space.ts`                                                          | Type `locations` HasMany as `LocationBlock`                            |
| `packages/models/src/entities/AgentProfile.ts`                                                   | Migrate to `extends WeNode`; add `location` `HasOne` (`LocationBlock`) |
| `packages/models/src/entities/SignalType.ts`                                                     | Migrate to `extends WeNode`                                            |
| `packages/models/src/entities/AgentSettings.ts`                                                  | Add `globalSpaceJoined`, `globalSpaceUrl`                              |
| `packages/app-framework/src/frameworks/solid/stores/AdamStore.tsx`                               | `joinGlobalSpace`, extend `createSpace`, `initSystemPerspectives`      |
| `packages/app-framework/src/frameworks/solid/stores/GlobalStore.tsx`                             | New store                                                              |
| `packages/app-framework/src/shared/schemas/DefaultTemplate/routes/HomeRoute/index.ts`            | Join prompt card                                                       |
| `packages/app-framework/src/shared/schemas/DefaultTemplate/routes/HomeRoute/CreateSpaceModal.ts` | Three-way visibility                                                   |
| `packages/app-framework/src/shared/schemas/shell/Profile.schema.ts`                              | Location fields                                                        |
| `packages/app-framework/src/shared/schemas/WeTemplate.schema.ts`                                 | Globe wired to globalStore                                             |
| `packages/cesium-layers/src/`                                                                    | New layer factories                                                    |
| `we-seed.json`                                                                                   | `globalSpaceUrl` constant                                              |
