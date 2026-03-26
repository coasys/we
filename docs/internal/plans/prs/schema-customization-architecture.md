# Schema Customization Architecture

> Plan for AI-driven template customization, sectioned storage in AD4M, built-in template gallery, and template sharing between users.

## Problem Statement

The current `weNativeApp` template schema is a single ~900-line JSON tree. Users want AI-driven modifications at any granularity — from tweaking a color to adding an entire page. The system needs to:

1. **Store** customizations efficiently in AD4M
2. **Scope** changes so they compose cleanly
3. **Share** fragments with others selectively
4. **Merge** received fragments into an existing schema
5. **Ship** a curated set of built-in templates users can browse and activate
6. **Version** changes so users can undo AI edits

---

## Core Decision: Layered Fragment Architecture

Rather than storing one monolithic schema or decomposing every `SchemaNode` into fine-grained AD4M links, use a **segmented JSON blob approach with AD4M links as the index/relationship layer**.

**Why JSON blobs, not graph decomposition:**

- A single route like `/globe` has ~100 nested nodes. Decomposing each `SchemaNode` into links would create 500+ links per route — expensive to query, impossible for AI to reason about, and tree ordering would need explicit `we://has_child_index` links.
- JSON blobs preserve structure, are fast to load (one link target read), and AI models work natively with JSON.
- The AD4M graph layer provides the _index_ — which sections exist, their relationships, versioning, authorship — while JSON provides the _content_.

**Why not one giant blob:**

- AI must load and rewrite the entire 900+ line schema for any change — slow, expensive, error-prone.
- Sharing requires sending the whole template even when only one page is relevant.
- No granular versioning or undo.

**Sections hit the sweet spot:** ~50–150 lines each, small enough for AI context windows, large enough to be meaningful units.

---

## 1. Section Type Taxonomy

A small, stable set of `sectionType` values that describe _what role_ a section plays. These are not fixed section names — they are classification labels.

| `sectionType`  | Description                                                    | Examples                                         |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `"layout"`     | The root skeleton — slots where other sections plug in         | The outer `Row` with `$section` refs             |
| `"navigation"` | Any navigation structure (sidebar, topbar, tabbar, bottom nav) | `CollapsibleSidebar`, top navbar, mobile tab bar |
| `"route"`      | A routable page                                                | `/`, `/globe`, `/settings`                       |
| `"panel"`      | A non-routed content area (widget panel, detail pane)          | Right detail panel, floating widget              |
| `"theme"`      | Style/token overrides                                          | Color, font, spacing overrides                   |
| `"meta"`       | Template metadata                                              | Name, description, icon                          |

---

## 2. Section Key Generation

Section keys are **auto-generated** from the template's actual structure, not hardcoded. Format: `{sectionType}:{qualifier}`.

### Examples Across Different Templates

```
weNativeApp template:
  meta                      // always one
  layout                    // always one
  navigation:left           // CollapsibleSidebar on left
  navigation:right          // CollapsibleSidebar on right
  route:/                   // home route
  route:/globe              // globe route
  route:/list               // list route
  route:/graph              // graph route
  route:/new-post           // new post route
  theme                     // style overrides

twitter template (top bar + 3 columns):
  meta
  layout
  navigation:topbar         // top navigation bar
  panel:feed                // center feed column
  panel:trending            // right trending panel
  route:/
  route:/profile
  theme

minimal template (single column, no nav):
  meta
  layout
  route:/
  theme
```

**Key insight:** A template with no sidebar simply has **no `navigation:*` sections** — there's nothing empty to fill. A template with a top bar gets `navigation:topbar` naturally. A template with three sidebars gets `navigation:left`, `navigation:right`, `navigation:bottom`. The AI knows what sections exist because it queries them, not because it assumes a fixed set.

---

## 3. The `$section` Token and Layout Skeleton

The `layout` section is the only one that references other sections. It uses a new `$section` token to declare where other sections plug in:

```json
{
  "key": "layout",
  "sectionType": "layout",
  "schemaJson": {
    "type": "Row",
    "props": { "width": "100%", "height": "100%" },
    "children": [
      { "$section": "navigation:left" },
      {
        "type": "Column",
        "props": { "zIndex": 1, "width": "100%", "height": "100%", "bg": "ui-50", "px": "66px" },
        "children": [{ "type": "$routes" }]
      },
      { "$section": "navigation:right" }
    ]
  }
}
```

This means:

- The AI can **add a section** by creating it + adding a `$section` ref to the layout.
- The AI can **remove a section** by deleting it + removing its `$section` ref.
- The layout clearly declares the template's topology.

---

## 4. AD4M Storage Model

### SchemaSection Model

```typescript
@Model({ name: 'SchemaSection' })
class SchemaSection extends WeNode {
  @Property({ through: 'we://has_section_key', required: true })
  key: string = ''; // e.g. "route:/globe", "navigation:left"

  @Property({ through: 'we://has_section_type', required: true })
  sectionType: string = ''; // "route" | "navigation" | "layout" | "meta" | "theme" | "panel"

  @Property({ through: 'we://has_schema_json', required: true })
  schemaJson: string = ''; // The actual SchemaNode JSON blob

  @Property({ through: 'we://has_version' })
  version: number = 0; // Incremented on each AI edit

  @Property({ through: 'we://has_author_did' })
  authorDid: string = ''; // Who created/last modified

  @Property({ through: 'we://has_description' })
  description: string = ''; // Human-readable description of this section
}
```

### TemplateInstall Model

```typescript
@Model({ name: 'TemplateInstall' })
class TemplateInstall extends WeNode {
  @Property({ through: 'we://has_template_name', required: true })
  name: string = '';

  @Property({ through: 'we://has_origin' })
  origin: string = ''; // 'builtin:weNative' | 'shared:<did>'

  @Property({ through: 'we://has_active' })
  active: string = 'false'; // Is this the currently active template?

  @HasMany({ through: 'we://has_section' })
  sections: string[] = []; // UUIDs of SchemaSection instances
}
```

### Link Structure in a Perspective

```
<template-uuid>  --we://has_section-->       <section-uuid>
<section-uuid>   --we://has_section_key-->   "route:/globe"
<section-uuid>   --we://has_section_type-->  "route"
<section-uuid>   --we://has_schema_json-->   literal://json:{...the SchemaNode...}
<section-uuid>   --we://has_version-->       "3"
```

---

## 5. Sectionizing Algorithm

When a built-in template is first activated, a deterministic function walks the schema tree and produces sections:

```typescript
function sectionizeTemplate(template: TemplateSchema): SchemaSection[] {
  const sections: SchemaSection[] = [];

  // 1. Extract meta
  sections.push({ key: 'meta', sectionType: 'meta', schemaJson: template.meta });

  // 2. Extract routes
  for (const route of template.routes ?? []) {
    sections.push({
      key: `route:${route.path}`,
      sectionType: 'route',
      schemaJson: route,
    });
  }

  // 3. Walk top-level children, classify by component type
  const layoutChildren = [];
  for (const child of template.children ?? []) {
    const nodeType = child.type;

    if (isNavigationComponent(nodeType)) {
      // CollapsibleSidebar, TopNavBar, TabBar, etc.
      const qualifier = inferQualifier(child); // 'left', 'right', 'topbar', etc.
      const key = `navigation:${qualifier}`;
      sections.push({ key, sectionType: 'navigation', schemaJson: child });
      layoutChildren.push({ $section: key });
    } else if (isPanelComponent(nodeType, child)) {
      const qualifier = inferPanelName(child);
      const key = `panel:${qualifier}`;
      sections.push({ key, sectionType: 'panel', schemaJson: child });
      layoutChildren.push({ $section: key });
    } else {
      // Keep inline in layout (e.g., the main content column with $routes)
      layoutChildren.push(child);
    }
  }

  // 4. Build layout skeleton
  sections.push({
    key: 'layout',
    sectionType: 'layout',
    schemaJson: { type: template.type, props: template.props, children: layoutChildren },
  });

  return sections;
}
```

Helper classification functions:

```typescript
function isNavigationComponent(type: string): boolean {
  return ['CollapsibleSidebar', 'TopNavBar', 'TabBar', 'BottomNav'].includes(type);
}

function inferQualifier(node: SchemaNode): string {
  // For sidebars, use the 'side' prop
  if (node.props?.side) return node.props.side as string; // 'left', 'right'
  // For top/bottom bars, use position
  if (node.props?.position === 'top') return 'topbar';
  if (node.props?.position === 'bottom') return 'bottombar';
  return 'primary';
}
```

---

## 6. Schema Assembly at Runtime

A `SchemaAssembler` reads all sections from the perspective and composes them into a `TemplateSchema`:

```typescript
async function assembleTemplate(perspectiveUuid: string, templateUuid: string): Promise<TemplateSchema> {
  const sections = await SchemaSection.findByTemplate(perspectiveUuid, templateUuid);
  const sectionMap = new Map(sections.map((s) => [s.key, JSON.parse(s.schemaJson)]));

  // Get layout skeleton
  const layout = sectionMap.get('layout');

  // Resolve $section references in layout
  const resolvedChildren = resolveSection(layout.children, sectionMap);

  return {
    meta: sectionMap.get('meta'),
    type: layout.type,
    props: layout.props,
    children: resolvedChildren,
    routes: sections
      .filter((s) => s.sectionType === 'route')
      .map((s) => ({ path: s.key.replace('route:', ''), ...JSON.parse(s.schemaJson) })),
  };
}

function resolveSection(children: any[], sectionMap: Map<string, any>): any[] {
  return children
    .map((child) => {
      if (child.$section) {
        return sectionMap.get(child.$section) ?? null;
      }
      return child;
    })
    .filter(Boolean);
}
```

---

## 7. AI Customization Flow

### Single-Section Change

```
User: "Make the globe page header purple and add a search bar"

AI Agent flow:
1. Identify affected section → "route:/globe"
2. Load that section's JSON (~50 lines, not 900)
3. Modify the JSON (change bg color, add search input node)
4. Write back the updated section JSON
5. Increment version
6. UI re-renders reactively
```

### Cross-Section Change

```
User: "Create a calendar page and add it to the sidebar"

AI Agent flow:
1. Create new section: key="route:/calendar", sectionType="route"
   → Generate SchemaNode JSON for the calendar page
2. Load section: key="navigation:left"
   → Add new nav item { id: 'calendar', icon: 'calendar', label: 'Calendar', ... }
   → Write back
3. Both sections update, UI re-renders
```

**Key benefit:** The AI only loads and modifies the relevant section(s), not the entire 900+ line schema. This is cheaper, faster, less error-prone, and fits within smaller context windows.

---

## 8. Three-Tier Template Model

```
┌─────────────────────────────────────────────────────┐
│  BUILT-IN (read-only, shipped with WE)              │
│  Stored: Code registry (templateRegistry)           │
│  Examples: weNative, twitter, minimal, dashboard    │
│  Status: Browse, preview, activate                  │
├─────────────────────────────────────────────────────┤
│  INSTALLED (customizable, user's local copy)        │
│  Stored: AD4M perspective (sectioned)               │
│  Origin: Activated from built-in OR received share  │
│  Status: Active, AI-editable, shareable             │
├─────────────────────────────────────────────────────┤
│  RECEIVED (pending installation)                    │
│  Stored: AD4M expression (inbox/DM)                 │
│  Origin: Another user shared it                     │
│  Status: Preview, install, discard                  │
└─────────────────────────────────────────────────────┘
```

### Built-in Templates (Gallery)

Ship a curated set in the code registry:

```typescript
// templateRegistry.ts
export const builtinTemplates: Record<string, TemplateSchema> = {
  weNative: weNativeAppTemplateSchema, // Full-featured native app
  twitter: twitterTemplateSchema, // Social feed layout
  minimal: minimalTemplateSchema, // Clean single-column
  dashboard: dashboardTemplateSchema, // Data-heavy grid layout
  wiki: wikiTemplateSchema, // Knowledge base style
};
```

These are **read-only blueprints**. Users browse them in a gallery UI, preview them, and "activate" one to make it their own.

### Activation Flow (Built-in → Installed)

```
User browses gallery → picks "weNative" → clicks "Use this template"

1. sectionizeTemplate(weNativeAppTemplateSchema)
   → Produces ~8-10 SchemaSection objects

2. Create/reuse a personal "we-templates" perspective in AD4M
   → One perspective holds ALL installed templates

3. Create a TemplateInstall model instance with sections

4. Save each SchemaSection as a model instance in the perspective
   → Links: <template-uuid> --we://has_section--> <section-uuid>

5. Mark this template as active, deactivate others

6. SchemaAssembler reads sections → produces TemplateSchema → renders
```

**Why copy on activate, not reference?** Because the user is about to customize it. Their version diverges from the built-in immediately. The built-in is just the starting point.

---

## 9. Sharing Architecture

### Share Payload Format

```typescript
interface SharedSchemaPayload {
  sections: Array<{
    key: string;
    sectionType: string;
    schemaJson: string; // The SchemaNode JSON
    description: string;
  }>;
  meta: {
    sharedBy: string; // Agent DID
    sharedAt: string; // ISO timestamp
    templateName: string;
  };
}
```

This travels as a single AD4M expression through any AD4M language (direct message, neighbourhood post, etc.).

### Three Sharing Granularities

**a) Share a single section (most common)**

```
User: "Share my globe page with Marcus"

→ Export SchemaSection where key="route:/globe"
→ Send as an AD4M expression (JSON blob with metadata)
→ Marcus receives it, previews, and can:
   - Import as a new route in his template
   - Merge/replace his existing globe route
```

**b) Share a section group**

```
User: "Share my entire sidebar setup"

→ Export navigation:left + navigation:right sections
→ Bundle as a JSON array of SchemaSections
→ Recipient imports both
```

**c) Share full template**

```
→ Export all sections
→ Recipient gets a complete template they can adopt wholesale
```

### Installation Options for Received Templates

| Option                      | Behavior                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Install as new template** | Create new `TemplateInstall` in templates perspective. For missing sections, use defaults from a base.  |
| **Merge into current**      | Show diff/preview per section. User picks which to accept. Overwrite those sections, increment version. |
| **Save to library**         | Store the payload in the templates perspective as a saved share. User can browse and install later.     |

---

## 10. Version History & Undo

Since each section has a `version` field, optionally store history:

```
<section-uuid>  --we://has_history-->           <history-entry-uuid>
<history-entry-uuid>  --we://has_schema_json-->          literal://json:{...previous version...}
<history-entry-uuid>  --we://has_version-->              "2"
<history-entry-uuid>  --we://has_timestamp-->             "2026-03-19T..."
<history-entry-uuid>  --we://has_change_description-->   "Made header purple, added search bar"
```

This lets users undo AI changes per-section without affecting anything else.

---

## 11. Theme/Style Overrides Layer

A special `theme` section type stores design token overrides separately from structural schema:

```json
{
  "key": "theme",
  "sectionType": "theme",
  "schemaJson": {
    "colorOverrides": {
      "primary-500": "#8b5cf6",
      "ui-50": "#1a1a2e"
    },
    "fontOverrides": {
      "heading": "Inter",
      "body": "system-ui"
    },
    "spacingScale": 1.0
  }
}
```

When the user says "make everything darker" or "use purple as my accent color", only the theme section changes — no route schemas are touched.

---

## 12. The Templates Perspective

One dedicated AD4M perspective per user stores everything:

```
Perspective: "we-templates" (created on first use)
│
├── TemplateInstall: "My Custom WE"  (active: true, origin: builtin:weNative)
│   ├── SchemaSection: meta
│   ├── SchemaSection: layout
│   ├── SchemaSection: navigation:left
│   ├── SchemaSection: navigation:right
│   ├── SchemaSection: route:/
│   ├── SchemaSection: route:/globe
│   ├── SchemaSection: route:/list
│   ├── SchemaSection: route:/graph
│   ├── SchemaSection: route:/new-post
│   └── SchemaSection: theme
│
├── TemplateInstall: "Marcus's Explorer"  (active: false, origin: shared:did:key:marcus...)
│   ├── SchemaSection: ...
│   └── ...
│
└── SavedShare: (not yet installed)
    └── payload JSON
```

---

## 13. Integration with Current Code

The existing `TemplateStore` already manages `currentTemplate` and `switchTemplate()`. The migration path:

```
Current:  templateRegistry (code) + localStorage (saved)
Proposed: templateRegistry (built-in gallery) + AD4M perspective (installed)
```

### New TemplateStore Methods

```typescript
// Assembly
assembleActiveTemplate(): TemplateSchema       // Read sections from AD4M, assemble

// Built-in gallery
listBuiltinTemplates(): TemplateMeta[]         // List available built-ins
activateBuiltinTemplate(id: string): void      // Sectionize + save to AD4M

// Sharing
exportSections(keys: string[]): SharedSchemaPayload    // Share selected sections
importSharedSections(payload: SharedSchemaPayload): void // Install received share

// AI editing
loadSection(key: string): SchemaSection        // Load one section for AI
saveSection(key: string, json: string): void   // Write back modified section
```

`TemplateProvider` continues to work unchanged — it renders whatever `currentTemplate` resolves to.

---

## Summary Table

| Concern              | Approach                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------- |
| **Storage format**   | JSON blobs for section content, AD4M links for indexing/relationships                       |
| **Granularity**      | Sections (~50–150 lines each) — small enough for AI, large enough to be meaningful          |
| **Section naming**   | Type taxonomy + auto-generated qualifier keys from actual template structure                |
| **Absent features**  | Templates with no sidebar simply have no `navigation:*` sections — nothing empty to fill    |
| **AI efficiency**    | Load only affected section(s), not entire schema                                            |
| **Built-in gallery** | Ship as read-only `TemplateSchema` in code registry. Copy-on-activate into AD4M.            |
| **Sharing**          | Export section(s) as JSON payload via AD4M expressions. Install, merge, or save on receipt. |
| **Composability**    | Sections are independent; swapping a route doesn't break sidebars                           |
| **Versioning**       | Per-section version counter + optional history links                                        |
| **Reactivity**       | Section change → reassemble → schema renderer picks up diff                                 |
| **Migration**        | Current monolithic schemas trivially split into sections at the natural boundaries          |
