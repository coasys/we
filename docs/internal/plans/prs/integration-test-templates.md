# Plan: Integration Test Templates

> Add 3 new schema templates that exercise the full breadth of implemented schema tokens, components, and store interactions — validating the system end-to-end before building AI tooling on top.

---

## Problem

The two existing templates (`weNativeAppTemplateSchema` and `defaultTemplateSchema`) only exercise a narrow slice of the schema system:

| Token           | weNativeApp | DefaultTemplate |
| --------------- | ----------- | --------------- |
| `$store`        | ✓           | ✓               |
| `$action`       | ✓           | ✓               |
| `$concat`       | ✓           | ✓               |
| `$if` (prop)    | ✓           | —               |
| `$if` (node)    | —           | ✓               |
| `$each`         | —           | ✓               |
| `$map`          | ✓           | —               |
| `$eq`           | ✓           | —               |
| `$routes`       | ✓           | ✓               |
| `$pick`         | —           | —               |
| `$ne`           | —           | —               |
| `$not`          | —           | —               |
| `$and`          | —           | —               |
| `$or`           | —           | —               |
| `$query`        | —           | —               |
| `$arg`          | —           | —               |
| Nested `$each`  | —           | —               |
| Theme overrides | —           | —               |
| Web components  | —           | —               |

Meanwhile, the following shipped PRs have zero template-level integration:

- **#5c** `$query` reactive data binding — never used in any template
- **#4b** `$concat` — used only for URL building, not for display text composition
- **#10** 34 new components — only 7 of the 42 registered components appear in templates
- **#2c** Web component prop delivery — never tested in a schema context
- **#3** Theme overrides — `themeOverrides` prop exists but no template uses it
- **#4b** `$pick` — implemented, never used
- **Logical operators** (`$and`, `$or`, `$not`, `$ne`) — implemented, never composed

This matters for the upcoming PRs:

- **#8 (@we/ai-context)** will auto-extract usage patterns — richer templates = better AI training data
- **#8b Phase 2 (semantic validation)** validates component/prop references — more surface = more validation confidence
- **#9 (MCP tools)** exposes schema generation — the AI needs realistic patterns to learn from

## Design

Three new templates, each targeting a different archetype and exercising different token coverage gaps:

### Template 1: Data Dashboard (`dataDashboardTemplateSchema`)

**Archetype:** Read-heavy data display with filtering and conditional rendering
**Exercises:** `$query`, `$each`, `$if` (node + prop), `$and`/`$or`, `$not`, `$map`, `$pick`, `$concat`, theme overrides

**Structure:**

```
Column (root, themeOverrides for dashboard styling)
├── Row (header)
│   ├── we-text (title via $concat)
│   └── Row (filters)
│       ├── we-button (active filter via $eq)
│       └── we-button (active filter via $eq)
├── Grid (main content)
│   └── $each (items from $query)
│       └── Card
│           ├── we-text (title)
│           ├── we-text (description, $if non-empty)
│           ├── Tag ($pick status field, conditional color via $if)
│           └── Row (actions)
│               ├── we-button ($action)
│               └── we-button ($if condition via $and)
├── $if (empty state — $not + $query length)
│   └── Column (empty message)
└── Row (footer stats via $concat)
```

**Key patterns:**

- `$query` for reactive data subscription with `where` filter params
- `$each` iterating query results with `$item.*` context
- `$and` combining multiple filter conditions
- `$not` for empty-state detection
- `$pick` extracting specific fields from query results
- `$map` transforming query results for display
- `themeOverrides` on root node
- Multiple web components (`we-text`, `we-button`, `we-input`) via hyphenated tag delivery

### Template 2: Interactive Form (`formTemplateSchema`)

**Archetype:** Multi-step form with validation, conditionals, and submission
**Exercises:** `$store`, `$action`, `$if` (prop + node), `$eq`, `$ne`, `$or`, `$concat`, `$arg`, web components

**Structure:**

```
Column (root)
├── Row (step indicator)
│   └── Stepper (steps from store)
├── $routes (step content)
│   ├── /step-1 — Column
│   │   ├── FormField + we-input (name)
│   │   ├── FormField + we-textarea (description)
│   │   └── we-button (next, disabled via $eq empty check)
│   ├── /step-2 — Column
│   │   ├── FormField + we-select (category)
│   │   ├── FormField + we-checkbox (options)
│   │   ├── $if ($eq category "advanced")
│   │   │   └── FormField + we-input (extra config)
│   │   └── Row (back + next buttons)
│   └── /step-3 — Column (review)
│       ├── Card (summary via $concat)
│       ├── $if ($ne status "submitting")
│       │   └── we-button (submit, $action with $arg)
│       └── $if ($eq status "submitting")
│           └── ProgressBar
├── $if (success toast)
│   └── Alert (success message)
└── $if ($or [error conditions])
    └── Alert (error message, variant danger)
```

**Key patterns:**

- `$routes` for multi-step wizard navigation
- `$eq` / `$ne` for step-dependent conditional rendering
- `$or` combining multiple error conditions
- `$arg` extracting callback values from form events
- `$action` with `args` referencing store values
- Web components: `we-input`, `we-textarea`, `we-select`, `we-checkbox`
- Component library: FormField, Stepper, Card, Alert, ProgressBar

### Template 3: Nested Data Browser (`dataBrowserTemplateSchema`)

**Archetype:** Hierarchical data with nested iteration and complex transforms
**Exercises:** Nested `$each`, `$map` with complex `select`, `$pick`, `$concat`, `$if` (nested), `$eq`, `$action`

**Structure:**

```
Row (root)
├── CollapsibleSidebar
│   ├── we-input (search, with $arg for onInput)
│   └── $each (categories from store)
│       └── Column (category group)
│           ├── we-text (category name)
│           └── $each (items in category — nested iteration)
│               └── Row (item row)
│                   ├── we-text ($item.name)
│                   ├── Tag ($pick status)
│                   └── we-button (select, $action, highlight via $eq)
├── Column (detail panel)
│   ├── $if (item selected)
│   │   └── Column
│   │       ├── Row (header)
│   │       │   ├── we-text (title via $concat)
│   │       │   └── Breadcrumbs ($map path segments)
│   │       ├── Divider
│   │       ├── Table ($map item properties into rows)
│   │       ├── Accordion (expandable sections)
│   │       │   └── $each (sections)
│   │       │       └── Timeline (history entries)
│   │       └── Row (actions)
│   │           ├── we-button (edit)
│   │           └── we-button (delete, $if permissions via $and)
│   └── $if ($not item selected)
│       └── Column (placeholder)
│           └── we-text ("Select an item to view details")
```

**Key patterns:**

- Nested `$each` (categories → items within each category) with `as` bindings
- `$map` with multi-field `select` for table row transformation
- `$pick` for extracting display fields
- `$arg` for search input handling
- Complex `$if`/`$not` for detail panel state
- `$and` for permission-gated actions
- Components: CollapsibleSidebar, Table, Accordion, Timeline, Breadcrumbs, Divider, Tag

## Token Coverage Matrix (After)

| Token           | weNativeApp | Default | Dashboard | Form | Browser |
| --------------- | ----------- | ------- | --------- | ---- | ------- |
| `$store`        | ✓           | ✓       | ✓         | ✓    | ✓       |
| `$action`       | ✓           | ✓       | ✓         | ✓    | ✓       |
| `$concat`       | ✓           | ✓       | ✓         | ✓    | ✓       |
| `$if` (prop)    | ✓           | —       | ✓         | ✓    | ✓       |
| `$if` (node)    | —           | ✓       | ✓         | ✓    | ✓       |
| `$each`         | —           | ✓       | ✓         | —    | ✓       |
| `$map`          | ✓           | —       | ✓         | —    | ✓       |
| `$eq`           | ✓           | —       | ✓         | ✓    | ✓       |
| `$routes`       | ✓           | ✓       | —         | ✓    | —       |
| `$pick`         | —           | —       | ✓         | —    | ✓       |
| `$ne`           | —           | —       | —         | ✓    | —       |
| `$not`          | —           | —       | ✓         | —    | ✓       |
| `$and`          | —           | —       | ✓         | —    | ✓       |
| `$or`           | —           | —       | —         | ✓    | —       |
| `$query`        | —           | —       | ✓         | —    | —       |
| `$arg`          | —           | —       | —         | ✓    | ✓       |
| Nested `$each`  | —           | —       | —         | —    | ✓       |
| Theme overrides | —           | —       | ✓         | —    | —       |
| Web components  | —           | —       | ✓         | ✓    | ✓       |

**100% token coverage** across the 5 templates (every implemented token exercised in at least one).

## Scope

### New files

| File                                                                | Description                  |
| ------------------------------------------------------------------- | ---------------------------- |
| `packages/app-framework/src/shared/schemas/DataDashboard.schema.ts` | Data dashboard template      |
| `packages/app-framework/src/shared/schemas/Form.schema.ts`          | Interactive form template    |
| `packages/app-framework/src/shared/schemas/DataBrowser.schema.ts`   | Nested data browser template |

### Modified files

| File                                                     | Change                                      |
| -------------------------------------------------------- | ------------------------------------------- |
| `packages/app-framework/src/shared/schemas/index.ts`     | Re-export new templates                     |
| Template store or provider (if templates are registered) | Register new templates as available options |

### Not in scope

- New components — uses only existing registered components
- Store changes — templates bind to existing store shapes
- Schema system changes — pure consumers of existing token set
- `$localState` — deferred to #4, templates will use `$store` for now
- `$query` backend wiring — template declares `$query` tokens; actual query resolution depends on model registration which exists from #5c

## Implementation order

1. **Data Dashboard** — broadest token coverage, validates `$query` + `$each` + conditionals
2. **Interactive Form** — validates `$arg` + `$routes` + web component integration
3. **Nested Data Browser** — validates nested `$each` + `$map`/`$pick` transforms + complex composition

## Risk

**Low.** Pure additive work — new files only, no modifications to existing runtime code. Templates are schema JSON objects; if a token doesn't work correctly, the template simply exposes the bug (which is the point). No risk of regression to existing functionality.

## Validation

- Templates render without runtime errors
- Each token resolves correctly (reactive updates propagate)
- Web component props are delivered via property assignment
- Theme overrides apply scoped CSS variables
- Nested `$each` correctly propagates `$item` / `as` context at each level
- `$query` subscriptions clean up on unmount
