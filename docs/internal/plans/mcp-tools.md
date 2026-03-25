# Plan: WE MCP Tools for On-Demand AI Context

> Separate follow-up PR after `@we/ai-context` lands. This plan covers exposing WE knowledge and validation capabilities through MCP tools instead of relying only on a large static prompt.

---

## Why this should be a separate PR

The `@we/ai-context` work and the MCP work are related but not the same:

- **PR 1:** build the source-of-truth context assembly layer
- **PR 2:** expose that assembled context as tools

Keeping them separate reduces risk, makes review easier, and lets us validate the extracted context model before freezing an MCP surface around it.

---

## Problem

A static prompt like `schemaContext.ts` works at small scale, but it has hard limits:

1. **Context bloat** — every session pays for the full dump whether it needs it or not
2. **Poor targeting** — asking about one component still requires shipping everything
3. **Weak validation loop** — prompts can describe rules, but cannot enforce them as precisely as tools
4. **No discoverability primitives** — agents should be able to ask focused questions like:
   - “what components are available?”
   - “what props does `PopoverMenu` accept?”
   - “is this schema valid?”
   - “what store actions can I call?”

MCP gives us an on-demand interface for those questions.

---

## Goal

Expose WE's assembled AI context through a small set of MCP tools that support:

- targeted component lookup
- store and token discovery
- schema validation
- future contribution and module-registry workflows

The key principle: **the MCP tools should read from the same `AssembledContext` object produced by `@we/ai-context`**.

---

## Architecture

```text
Source code
  └─> extractors (`@we/ai-context`)
        └─> AssembledContext
              ├─> assemblePrompt()         # static prompt path
              └─> MCP tool handlers        # on-demand path
```

This means:
- one source of truth
- no duplicated descriptions between prompt and tools
- prompt-first today, tool-first later if/when desired

---

## Proposed MCP Tool Set (v1)

### 1. `list_components`

**Purpose:** discover schema-renderable components.

**Input:**
- optional `category` (`primitive`, `component`, `widget`, `layout`, etc.)
- optional `schemaRenderableOnly` boolean

**Returns:**
- component type names
- short descriptions
- category
- whether schema-renderable or programmatic-only

---

### 2. `get_component`

**Purpose:** inspect a specific component deeply.

**Input:**
- `type` (e.g. `we-button`, `PopoverMenu`, `CollapsibleSidebar`)

**Returns:**
- description
- prop list with types and required/default info
- slot conventions
- usage notes / `@ai` notes
- schema-renderable flag
- related store patterns if relevant

---

### 3. `list_stores`

**Purpose:** discover available stores.

**Input:** none

**Returns:**
- all store names
- one-line descriptions
- major state domains they expose

---

### 4. `get_store_api`

**Purpose:** inspect one store in detail.

**Input:**
- `store` name

**Returns:**
- state keys
- action signatures
- important usage patterns
- notes on reactive access in schema operators

---

### 5. `list_tokens`

**Purpose:** discover design tokens.

**Input:**
- optional category (`spacing`, `color`, `radius`, `typography`, etc.)

**Returns:**
- token groups and values
- brief usage notes where helpful

---

### 6. `validate_schema`

**Purpose:** verify whether a schema is valid and explain why not.

**Input:**
- schema JSON

**Returns:**
- valid / invalid
- structured errors
- human-readable explanation
- optionally warnings / best-practice notes

This is likely the highest-value tool after `get_component`.

---

### 7. `list_operators`

**Purpose:** expose schema-system operators and rendering rules.

**Input:** none or optional operator name

**Returns:**
- supported operators (`$store`, `$if`, `$map`, `$pick`, `$expr`, `$action`, `$routes`, etc.)
- expected shapes
- caveats / rules

---

## Likely Future MCP Tools (not v1)

- `get_widget_examples`
- `suggest_component_for_goal`
- `list_modules`
- `get_module_manifest`
- `create_schema_patch`
- `explain_validation_error`
- contributor workflow tools for module packaging / publishing

These should wait until the core v1 surface proves useful.

---

## Package Location

Recommended home:

- tool definitions and handlers live in **`packages/ai-context/`** or an adjacent package like `packages/ai-context-mcp/`
- initial recommendation: keep them in `@we/ai-context` unless that package starts feeling too mixed

Rule of thumb:
- if the package only exposes context + handlers, keeping them together is fine
- if transport/server concerns grow, split out `ai-context-mcp`

---

## Transport / Integration

AD4M already ships MCP support, so WE should plug into that rather than inventing a parallel serving layer.

The WE side should provide:
- tool definitions
- handler implementations
- serialization of `AssembledContext` lookups

AD4M / surrounding runtime should provide:
- the actual MCP server transport and registration environment

That keeps WE focused on domain knowledge, not protocol plumbing.

---

## Validation Strategy

For `validate_schema`, the MCP layer should reuse existing schema-system validation rather than duplicating logic.

Sources to leverage:
- schema-system validators
- operator shape definitions
- component registry metadata
- assembled context descriptions for nicer explanations

This should produce two levels of output:

1. **machine-usable structured result**
2. **assistant-friendly explanation text**

---

## Design Constraints

1. **No duplicated source-of-truth docs**
   - tools must read from assembled context, not separate hard-coded strings

2. **Prefer small focused responses**
   - MCP should reduce context usage, not recreate giant prompt dumps via tool output

3. **Schema-renderable vs programmatic-only must be explicit**
   - critical for widgets like Cesium / advanced components

4. **Tool names should be stable and boring**
   - predictable names age better than clever ones

5. **Do not overbuild v1**
   - lookup + validation first, authoring automation later

---

## PR Scope for the Future MCP PR

### In scope
- [ ] define MCP tool surface
- [ ] implement handlers backed by `AssembledContext`
- [ ] wire schema validation tool to existing validators
- [ ] add tests for tool outputs
- [ ] add docs and examples for agent usage

### Out of scope
- [ ] module marketplace publishing flow
- [ ] auto-fixing / code-writing tools
- [ ] contribution workflow automation
- [ ] UI for browsing MCP-exposed data

---

## Open Questions

1. Should validation return only errors, or also “best practice” warnings?
2. Should `get_component` include example schema snippets in v1?
3. Should MCP expose raw token sets, normalized token sets, or both?
4. Do we want one `search_context` tool, or several explicit tools only?
   - current instinct: explicit tools first

---

## Success Criteria

This later PR is successful if an agent can reliably:

- discover available components without reading a giant prompt
- inspect exact props for one component
- inspect stores and token sets on demand
- validate a candidate schema before suggesting it to the user

At that point, the static prompt becomes a convenience layer rather than the only interface.
