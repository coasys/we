# Plan: Core Component Library Expansion

> Fills the gaps between the current ~29 components and the set needed for schema-first apps to be viable without custom components.

---

## Problem

The schema-first architecture's viability depends on a comprehensive core component library. If users hit "missing component" placeholders frequently, they fall back to SolidJS components for everything — defeating the declarative model.

The current inventory has good primitives (Button, Input, Icon, Modal, Popover, Tooltip, Tabs, Avatar, Badge, Spinner, Image, Text, Menu) and layout basics (Column, Row), but significant gaps in forms, data display, layout composition, and feedback.

## Current inventory

### Primitives (`@we/primitives` — Lit Web Components)

Avatar, Badge, Button, Icon, IFrame, Image, Input, Menu, Menu-Group, Menu-Item, Modal, Popover, Spinner, Tab, Tabs, Text, Tooltip

### Components (`@we/components` — SolidJS)

CircleButton, IconLabelButton, Column, Row, PostCard, PopoverMenu, PopoverToggleMenu

### Widgets (`@we/widgets` — domain-specific SolidJS)

CreateSpaceModalWidget, SpaceSidebarWidget, CollapsibleSidebar, CesiumGlobe, GraphWidget

## Gap analysis by category

### Forms & Inputs — largest gap, highest impact

| Component         | Priority | Notes                                                                                             |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------- |
| **Select**        | P0       | Dropdown select with options. Foundational for any form.                                          |
| **Textarea**      | P0       | Multi-line text input.                                                                            |
| **Checkbox**      | P0       | Single checkbox with label.                                                                       |
| **Radio**         | P0       | Radio button group.                                                                               |
| **Switch/Toggle** | P1       | Boolean toggle. Could be a variant of Checkbox but visually distinct.                             |
| **Slider**        | P1       | Range input. Needed for settings-type UIs.                                                        |
| **DatePicker**    | P2       | Date/time selection. Complex but common.                                                          |
| **FileUpload**    | P2       | File input with drag-and-drop zone.                                                               |
| **ColorPicker**   | P3       | Color selection. Niche but useful for theme/customization UIs.                                    |
| **FormField**     | P0       | Wrapper: label + input + error message + help text. Schema renderer maps `$validate` errors here. |

### Layout — missing composition primitives

| Component       | Priority | Notes                                                                                                           |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| **Grid**        | P0       | CSS Grid container with responsive columns.                                                                     |
| **Stack**       | P1       | Vertical/horizontal stack with consistent gap. May overlap with Column/Row — evaluate whether to extend or add. |
| **Divider**     | P1       | Horizontal/vertical separator line.                                                                             |
| **Card**        | P0       | Generic content container with padding, border, optional header/footer. PostCard is too specific.               |
| **Accordion**   | P1       | Collapsible content sections.                                                                                   |
| **ScrollArea**  | P2       | Custom-styled scrollable container.                                                                             |
| **AspectRatio** | P2       | Fixed aspect ratio container for media.                                                                         |

### Data Display — needed for any list/detail app

| Component           | Priority | Notes                                                           |
| ------------------- | -------- | --------------------------------------------------------------- |
| **Table**           | P0       | Data table with headers, rows, optional sorting.                |
| **List**            | P0       | Styled list (ordered/unordered) with consistent item spacing.   |
| **Tag/Chip**        | P1       | Small label for categories, tags, filters.                      |
| **ProgressBar**     | P1       | Linear progress indicator.                                      |
| **Stat/Metric**     | P2       | Number + label display for dashboards.                          |
| **DescriptionList** | P2       | Key-value pair display.                                         |
| **EmptyState**      | P1       | Placeholder for empty lists/views with icon + message + action. |
| **Timeline**        | P3       | Vertical timeline for event sequences.                          |
| **Calendar**        | P3       | Calendar grid view. Complex.                                    |

### Feedback & Status — mostly covered, some gaps

| Component              | Priority | Notes                                                                            |
| ---------------------- | -------- | -------------------------------------------------------------------------------- |
| **Toast/Notification** | P0       | Temporary message. Spinner and Badge exist but no toast system.                  |
| **Alert/Banner**       | P1       | Persistent message block (info/warning/error/success).                           |
| **Skeleton**           | P1       | Loading placeholder shapes. Better UX than Spinner for layout-aware loading.     |
| **Dialog**             | P1       | Confirmation dialog (Modal exists but Dialog is a focused variant with actions). |

### Navigation — Tabs exist, but gaps remain

| Component       | Priority | Notes                                  |
| --------------- | -------- | -------------------------------------- |
| **Breadcrumbs** | P1       | Path navigation.                       |
| **Pagination**  | P2       | Page navigation for large lists.       |
| **Link**        | P1       | Styled anchor with router integration. |
| **Stepper**     | P3       | Multi-step wizard progress indicator.  |

### Typography — Text covers basics

| Component      | Priority | Notes                                                                                                                    |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Heading**    | P1       | Could be a variant of Text, but explicit heading levels (h1-h6) with consistent spacing are useful for schema rendering. |
| **Code**       | P2       | Inline and block code display with syntax highlighting.                                                                  |
| **Blockquote** | P2       | Styled quote block.                                                                                                      |

## Phasing

### Phase 1 — P0: schema-first minimum viable set (~15 components)

These are needed before schema-first apps can cover basic archetypes (todo list, form, data table, dashboard):

**Forms:** Select, Textarea, Checkbox, Radio, FormField
**Layout:** Grid, Card
**Data Display:** Table, List
**Feedback:** Toast

~10 new components. Without these, even simple apps hit missing-component walls.

### Phase 2 — P1: comfortable coverage (~12 components)

Fills out the UX to the point where apps feel polished, not just functional:

**Forms:** Switch, Slider
**Layout:** Stack (or extend Column/Row), Divider, Accordion
**Data Display:** Tag/Chip, ProgressBar, EmptyState
**Feedback:** Alert, Skeleton, Dialog
**Navigation:** Breadcrumbs, Link
**Typography:** Heading

### Phase 3 — P2/P3: comprehensive (~10 components)

Niche but valuable. These can land incrementally as real templates demand them:

DatePicker, FileUpload, ColorPicker, ScrollArea, AspectRatio, Stat/Metric, DescriptionList, Pagination, Code, Blockquote, Timeline, Calendar, Stepper

## Where do new components live?

Follow existing conventions:

- **Simple, stateless, reusable across frameworks** → `@we/primitives` (Lit Web Components)
- **SolidJS-specific, composed from primitives** → `@we/components`
- **Complex, domain-specific, feature-rich** → `@we/widgets`

Most Phase 1/2 components are primitives or simple components. DatePicker, Calendar, and FileUpload might be widgets due to complexity.

## Schema renderer integration

Each component needs a `type` string the schema renderer recognises. The renderer already maps `type` → component via a lookup. New components register in the same lookup.

Example — a schema using new components:

```json
{
  "type": "FormField",
  "label": "Priority",
  "error": { "$local": "priorityError" },
  "children": [
    {
      "type": "Select",
      "options": ["Low", "Medium", "High"],
      "value": { "$local": "priority" },
      "onChange": { "$setLocal": { "key": "priority" } }
    }
  ]
}
```

## Sizing

- **Phase 1:** ~2-3 days. Most are thin wrappers — Input already exists, so Select/Textarea/Checkbox/Radio follow the same pattern. Table and Grid are slightly more work. FormField is critical for `$validate` integration.
- **Phase 2:** ~2 days. Individually small components.
- **Phase 3:** Variable. DatePicker and Calendar are multi-day each. Others are small.

## Dependencies

- No hard blockers for Phase 1. Can start immediately.
- Phase 1 FormField integrates with `$validate` from the local-schema-state PR (#4), but the component itself can land first with manual error passing. `$validate` wiring is additive.
- Phase 1 Table benefits from `$query` (#5c) for data binding, but works with static data or `$store` initially.

## Risk

Low. These are standard UI components — well-understood patterns, no architectural novelty. The design token system (`@we/tokens`) and existing primitives establish the styling patterns. Main risk is scope creep — Phase 1 should be strict about the P0 set.
