# PR Plan: Flexible Signal System

## Summary

A community-configurable signalling system that lets users design the signals they want to use — including name, icon, numeric range, and display style. A `SignalType` is a community-authored schema that defines _what_ is being measured and _how_; a `Signal` is an instance of a user applying that schema to a node. Because each `SignalType` carries a declared range and semantics, signals from different communities can be normalised and compared, enabling cross-community interoperability.

---

## Motivation

All current social platforms hardcode their signal vocabulary (likes, upvotes, stars). There is no mechanism for:

- Communities to define domain-appropriate signals (e.g. a research community wanting "methodology quality" vs "relevance")
- Cross-community content aggregation where signals from different communities can be meaningfully combined or approximated
- Progressive migration — a community could start with a simple like and evolve to a weighted vote without losing historical data

WE's perspective-based architecture is uniquely suited to this. Signal instances live as links in the perspective graph, `SignalType` definitions are expressions that can be shared or referenced across perspectives, and the AD4M model layer provides the persistence primitives.

---

## Core Concepts

### SignalType (community-defined schema)

A `SignalType` defines a measurement scale. It lives in a community's perspective and is authored by community moderators.

```ts
@Model({ name: 'SignalType' })
class SignalType extends Ad4mModel {
  @Property() name: string = '';
  @Property() description: string = '';
  @Property() icon: string = ''; // emoji char or design-system icon name e.g. "thumbs-up"
  @Property() rangeMin: number = 0;
  @Property() rangeMax: number = 1;
  @Property() display: string = 'icon'; // 'icon' | 'vertical-icons' | 'horizontal-icons' | 'slider'
  @Property() aggregate: string = 'count'; // 'count' | 'mean' | 'sum' | 'median'
  @Property() semantic: string = 'custom'; // 'approval' | 'quality' | 'relevance' | 'agreement' | 'custom'
  @Property() allowChange: boolean = true; // whether a user can update their existing signal
}
```

**Display modes:**

| Display            | Typical use                     | Controls rendered                    |
| ------------------ | ------------------------------- | ------------------------------------ |
| `icon`             | Like / boost                    | Single clickable icon (toggle 0↔max) |
| `vertical-icons`   | Up/downvote                     | Two icons, +/-                       |
| `horizontal-icons` | N-star rating                   | Row of N clickable icons             |
| `slider`           | Weighted vote / relevance score | Continuous slider                    |

### Signal (instance — a user's act of signalling)

```ts
@Model({ name: 'Signal' })
class Signal extends Ad4mModel {
  @Property() signalTypeId: string = ''; // expression URI of the SignalType
  @Property() value: number = 0;
  @Property() authorDid: string = '';
}
```

`WeNode.reactions: string[]` becomes `WeNode.signals: string[]` (via renamed predicate `we://has_signals`), each entry pointing to a `Signal` expression.

### Normalisation

To compare or aggregate signals across communities, a signal value can be normalised to `[0, 1]`:

```
normalised = (value - rangeMin) / (rangeMax - rangeMin)
```

Where both endpoints are identical (rangeMin === rangeMax, e.g. a pure veto at `-1`), normalisation is by convention. When a `semantic` field is shared between two `SignalType`s, normalised values can be combined meaningfully.

---

## Built-in Presets

Shipped as default `SignalType` seeds — communities can use these as-is or as starting points.

| Preset            | Range    | Display          | Aggregate | Semantic  |
| ----------------- | -------- | ---------------- | --------- | --------- |
| Like              | [0, 1]   | icon             | count     | approval  |
| Upvote / Downvote | [-1, 1]  | vertical-icons   | sum       | approval  |
| 5-Star Rating     | [0, 5]   | horizontal-icons | mean      | quality   |
| Weighted Vote     | [0, 100] | slider           | sum       | agreement |
| Boost             | [0, 1]   | icon             | count     | approval  |

---

## Deferred: Categorical Signals

Categorical signals (Facebook-style emoji reaction sets where options are named choices that aren't ordered) are deliberately **out of scope for the initial implementation**. The current `type: 'numeric'` assumption is sufficient for v1. A `type` field should be reserved on `SignalType` so categorical support can be added without a breaking change:

```ts
@Property() type: string = 'numeric'; // 'numeric' | 'categorical' (future)
// future only:
// @Property() options: string[] = []; // e.g. ['❤️', '😂', '😮'] for categorical
```

---

## Implementation Phases

---

### Phase 1 — Core Models

**Goal:** Define the data layer. No UI yet.

#### 1.1 `Signal` model

**File:** `packages/models/src/Signal.ts`

```ts
import { Ad4mModel, Flag, Model, Property } from '@coasys/ad4m';

@Model({ name: 'Signal' })
export class Signal extends Ad4mModel {
  @Flag('we://signal') _type!: string;

  @Property() signalTypeId: string = '';
  @Property() value: number = 0;
  @Property() authorDid: string = '';
}
```

#### 1.2 `SignalType` model

**File:** `packages/models/src/SignalType.ts`

```ts
import { Ad4mModel, Flag, Model, Property } from '@coasys/ad4m';

export type SignalDisplay = 'icon' | 'vertical-icons' | 'horizontal-icons' | 'slider';
export type SignalAggregate = 'count' | 'mean' | 'sum' | 'median';
export type SignalSemantic = 'approval' | 'quality' | 'relevance' | 'agreement' | 'custom';

@Model({ name: 'SignalType' })
export class SignalType extends Ad4mModel {
  @Flag('we://signal_type') _type!: string;

  @Property() name: string = '';
  @Property() description: string = '';
  @Property() icon: string = '';
  @Property() rangeMin: number = 0;
  @Property() rangeMax: number = 1;
  @Property() display: SignalDisplay = 'icon';
  @Property() aggregate: SignalAggregate = 'count';
  @Property() semantic: SignalSemantic = 'custom';
  @Property() allowChange: boolean = true;
  @Property() type: string = 'numeric'; // reserved for future categorical support
}
```

#### 1.3 Update `WeNode`

**File:** `packages/models/src/WeNode.ts`

Rename `reactions` → `signals` and update the predicate from `we://has_reactions` to `we://has_signals`. Keep `reactions` as a deprecated alias until all callsites are migrated.

```ts
@HasMany({ through: 'we://has_signals' })
signals: string[] = [];
```

#### 1.4 Export from models index

**File:** `packages/models/src/index.ts`

Add `Signal` and `SignalType` to the barrel exports.

#### 1.5 Normalisation utility

**File:** `packages/models/src/utils/signalNormalize.ts`

```ts
export function normalizeSignal(value: number, rangeMin: number, rangeMax: number): number {
  if (rangeMax === rangeMin) return 0;
  return (value - rangeMin) / (rangeMax - rangeMin);
}

export function denormalizeSignal(normalized: number, rangeMin: number, rangeMax: number): number {
  return normalized * (rangeMax - rangeMin) + rangeMin;
}
```

---

### Phase 2 — SignalType Management (Community Config)

**Goal:** Community moderators can create, edit, and delete `SignalType`s for their community. Presets are provided.

#### 2.1 `SignalTypeModal` component

**File:** `packages/design-system/5-widgets/SignalTypeModal/`

A modal form for creating or editing a `SignalType`. Fields:

- **Name** — text input
- **Description** — text input
- **Icon** — emoji picker or icon name input with preview
- **Type** — (v1: always `numeric`, displayed as read-only label; reserved for categorical in future)
- **Range** — dual number input for `rangeMin` / `rangeMax`, with validation (`rangeMin < rangeMax`)
- **Display** — segmented control: `icon` / `vertical-icons` / `horizontal-icons` / `slider`
  - Disabled states applied automatically: `slider` requires float range; `vertical-icons` requires negative `rangeMin`; `horizontal-icons` requires integer `rangeMax ≤ 10`
- **Aggregate** — dropdown: `count` / `mean` / `sum` / `median`
- **Semantic** — dropdown: `approval` / `quality` / `relevance` / `agreement` / `custom`
- **Allow user to change their signal** — toggle

A live preview renders the actual signal control (the same component used in the signal bar) beneath the form, updating as the user edits settings.

**Preset selector:** A row of preset cards at the top of the modal. Selecting a preset populates all fields; the user can then customise. Custom preset clears all fields.

#### 2.2 `SignalTypeList` component

**File:** `packages/design-system/5-widgets/SignalTypeList/`

A settings panel listing all `SignalType`s in the current community. Each row shows the icon, name, range, display, and action buttons (edit, delete). An "Add Signal Type" button opens `SignalTypeModal` in create mode.

Delete is guarded: if any `Signal` instances reference the `SignalType`, the user is warned that existing signals will be orphaned.

#### 2.3 Community settings integration

The `SignalTypeList` widget is added to the community settings view (wherever general community settings live in the app). Gate creation/deletion behind a moderator permission check.

---

### Phase 3 — Signal Interaction (Per-Node UI)

**Goal:** Users can signal on any `WeNode` content. Signal counts/aggregates are displayed. Signals update in real time.

#### 3.1 Signal aggregation logic

**File:** `packages/models/src/utils/signalAggregate.ts`

```ts
export function aggregateSignals(signals: Signal[], signalType: SignalType): number {
  const values = signals.map((s) => s.value);
  switch (signalType.aggregate) {
    case 'count':
      return values.length;
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'mean':
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    case 'median': {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
  }
}
```

#### 3.2 Upsert semantics

When a user submits a signal:

1. Query existing `Signal` instances on the node where `authorDid === currentUser.did` and `signalTypeId === signalType.baseExpression`
2. If one exists and `signalType.allowChange === true`: update the `value` property in place
3. If one exists and `allowChange === false`: no-op (or show a toast "you have already signalled this")
4. If none exists: create a new `Signal` and add to `weNode.signals`

This upsert logic should live in a shared hook/utility, not in UI components.

#### 3.3 `SignalControl` component

**File:** `packages/design-system/4-elements/SignalControl/`

A pure presentational component that renders a single signal action based on the `SignalType.display` value. Receives the `SignalType`, the current user's existing signal value (or `null`), and the aggregate. Emits a `signal` event with the new value.

| Display            | Rendered as                                                                     |
| ------------------ | ------------------------------------------------------------------------------- |
| `icon`             | Icon button; toggles between `0` and `rangeMax`; shows aggregate count          |
| `vertical-icons`   | Two icon buttons (up/down); clicking the active one resets to 0; shows net sum  |
| `horizontal-icons` | Row of `rangeMax` icon buttons; clicking the Nth sets value to N; shows average |
| `slider`           | Labelled range input between `rangeMin` and `rangeMax`; shows average or sum    |

#### 3.4 `SignalBar` widget

**File:** `packages/design-system/5-widgets/SignalBar/`

Composes one `SignalControl` per `SignalType` defined in the community. Receives a `WeNode` base expression and handles all data loading and signal submission. Intended to be embedded at the bottom of any block or post card.

Signals load lazily — the bar renders skeleton controls until signal data is fetched. Real-time updates are subscribed via the AD4M perspective link subscription.

#### 3.5 Integration into block renderer

The `SignalBar` is added as an optional slot in the block renderer. A community toggle enables or disables signal display per view. Individual blocks can suppress the SignalBar via a block-level setting (e.g. divider blocks and spacers should not be signallable).

---

### Phase 4 — Cross-Community Interoperability

**Goal:** When content from one community is visible in another (e.g. a post bubbled up from a subcommunity into a parent), the signals from the source community are displayed and optionally aggregated with the target community's signals using normalisation.

#### 4.1 Cross-community signal mapping

**File:** `packages/models/src/utils/signalCrossMap.ts`

```ts
export interface MappedSignal {
  sourceSignalTypeId: string;
  targetSignalTypeId: string;
  normalizedValue: number;       // source value normalised to [0,1]
  mappedValue: number;           // denormalised into target range
  confidence: 'high' | 'medium' | 'low';
  // 'high'   = same semantic + same aggregate
  // 'medium' = same semantic, different aggregate
  // 'low'    = different semantic (approximate only)
}

export function mapSignal(
  signal: Signal,
  sourceType: SignalType,
  targetType: SignalType
): MappedSignal { ... }
```

The `confidence` field tells UI components whether to display mapped signals prominently or with a caveat indicator.

#### 4.2 Aggregate display for cross-community content

When a node has signals from multiple communities, the `SignalBar` can show:

- Native signals (from the current community) displayed normally
- Mapped signals (from foreign communities) displayed in a grouped overflow indicator: "42 signals from other communities" which expands to show each community's aggregate with a small community avatar
- A combined view (only shown when confidence is `high` or `medium`) that normalises and sums across communities

The default is to show native signals prominently and foreign signals in the overflow. Communities can configure this behaviour in their signal settings.

#### 4.3 Signal schema version field

Add a `schemaVersion: number = 1` property to `SignalType`. If the schema evolves in ways that break normalisation (e.g. changing `rangeMin`/`rangeMax` after signals exist), the version bump signals to consumers that historical data may not be comparable with the current schema. Migration utilities should handle version gaps.

---

### Phase 5 — Future / Post-MVP

These are intentionally deferred. Document here so they are not designed out by earlier phases.

#### 5.1 Categorical signals

Add `type: 'categorical'` to `SignalType` with an `options: string[]` field (ordered array of emoji or label strings). A categorical `Signal` stores the selected option index as its `value`. The `display` for categorical is always `icon-set` (a new display mode: a row of labelled icons, one per option). Categorical signals cannot be normalised to numeric — cross-community mapping is by label string matching only.

#### 5.2 Signal history / timeline

Per-node signal history: query all `Signal` instances sorted by creation timestamp to visualise sentiment shift over time. Useful for long-lived content (proposals, research posts).

#### 5.3 Community signal analytics

Aggregate signal activity across a community: most-signalled content, signal distribution over time, per-author signal behaviour. Out of scope for the core model but enabled by it.

#### 5.4 Signal-weighted content ranking

A community feed ranking algorithm that weights content by aggregate signal scores. Because signals carry a `semantic` field and a normalised value, a ranking function can weight by semantic category — e.g. weight `quality` signals 2× over `approval` signals.

#### 5.5 Anonymous / pseudonymous signalling

Currently `Signal.authorDid` is always set. Some communities may want anonymous or pseudonymous signalling (a vote that is counted but whose author is not revealed). This requires a ZK-proof or threshold scheme at the AD4M layer — noted here as a future protocol requirement.

---

## Migration Notes

- The predicate `we://has_reactions` is deprecated in favour of `we://has_signals`. The old predicate should continue to be read for backwards compatibility until a migration is shipped that rewrites existing links.
- Any `WeNode` subclass that currently reads `.reactions` should be updated to `.signals`. A TypeScript deprecation annotation on the old field will surface these callsites at compile time.
- `SignalType` expressions are perspective-scoped by default. There is no global registry in v1. Cross-community mapping works by inspecting the `SignalType` properties at query time, not by a shared ID.

---

## Open Questions

1. **Who can create `SignalType`s?** Moderator-only (safest) vs any member (most flexible). Recommend moderator-only for v1 with the door open to member-authored signal types behind a community toggle.
2. **SignalType ownership.** Should a `SignalType` expression be owned by the perspective (community) or by the author DID? If a moderator leaves, the expression should remain. Perspective ownership is correct — verify this is handled by the AD4M model layer.
3. **Real-time subscription granularity.** Subscribing to link changes on every visible `WeNode` simultaneously may have performance implications. Profile early and consider debouncing or batching signal queries for nodes in a feed view.
4. **Upsert atomicity.** AD4M link operations are not transactional. A race between two devices updating the same signal may create duplicate `Signal` instances. Consider a last-writer-wins merge strategy based on link timestamp.
