> **Archived: unimplemented plan.** Proposes MCP tools for on-demand AI context; nothing in
> the codebase implements it. The shipped approach is `@we/ai-context`'s generated reference.

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

### AD4M MCP Server — Investigation Findings

AD4M ships an MCP server at `/mcp` (HTTP Streamable transport, port 3001). Investigation of the Rust codebase reveals:

**Static tools (57 built-in):** Hardcoded in `ToolRouter` at compile time. Perspectives, links, subjects, flows, auth, profiles, subscriptions, neighbourhoods. **No plugin API** — adding a static tool requires modifying `rust-executor` and recompiling.

**Dynamic tools (SHACL-generated):** Auto-generated from SHACL Subject Classes in perspectives. For every `@Model` class, AD4M generates:

- `{class}_create`, `{class}_query`, `{class}_list`, `{class}_get`, `{class}_delete`
- `{class}_set_{property}` for scalar properties
- `{class}_get_{property}`, `{class}_add_{property}`, `{class}_remove_{property}` for collections

Registration is automatic — define a model, add it to a perspective via `add_model`, tools appear on the next `list_tools` call. No restart required.

**Perspective selection:** Per-request via `perspective_id` parameter on every tool call. Not globally configured.

### What This Means for WE

WE's MCP tools fall into **two distinct categories** with different integration paths:

#### Category 1: Schema Section Operations (SHACL-derived)

The `SchemaSection` and `TemplateInstall` models from the schema-customization-architecture plan are standard AD4M models. Once defined and added to the templates perspective, AD4M **automatically generates** CRUD tools:

```
schemasection_create          → create a new section
schemasection_get             → load one section's full data
schemasection_query           → list all sections in perspective
schemasection_list            → list sections under a parent (template)
schemasection_set_schemajson  → update a section's JSON content
schemasection_set_version     → increment version
schemasection_delete          → remove a section
templateinstall_create        → create a new template install
templateinstall_get           → load template metadata
templateinstall_list          → list all installed templates
```

These cover the **section editing operations** the AI agent needs — load a section, modify it, write it back. No custom tool code needed. The agent can:

1. `schemasection_query` to discover available sections
2. `schemasection_get` to load a specific section's JSON
3. Modify the JSON
4. `schemasection_set_schemajson` to write it back

**Limitation:** SHACL tools are generic CRUD only. They can't do complex queries (e.g. "find section by key where sectionType = 'route'") — the agent would need to query all sections and filter client-side, or WE could expose a convenience wrapper.

#### Category 2: Knowledge Tools (WE-specific, not SHACL-derivable)

The component/token/store/validation tools from this plan (`list_components`, `get_component`, `validate_schema`, `list_tokens`, etc.) are **not derivable from SHACL models**. They:

- Read from `AssembledContext` (build-time extracted data), not AD4M perspectives
- Return curated, AI-optimized responses, not raw model data
- Include computed information (prop types, descriptions, validation results)
- Have custom query logic (filter by category, search by name)

AD4M has **no plugin API** for registering custom static tools. These tools cannot be added to AD4M's MCP server without modifying the Rust executor.

### Integration Strategy: Two Options

#### Option A: Extend AD4M with a custom tool registration API

Add a new capability to AD4M's MCP server that allows external code to register custom tools at runtime:

```rust
// New AD4M MCP capability (requires AD4M PR)
// GraphQL mutation or MCP tool:
register_custom_tool(name: string, description: string, schema: JSON, handler_url: string)
```

WE would register its knowledge tools at startup. When called, AD4M's MCP server would proxy the request to WE's handler (HTTP callback, IPC, or in-process function).

**Pros:** Single MCP endpoint for agents. Clean separation. Agent sees all tools in one place.
**Cons:** Requires an AD4M PR. Design complexity around handler transport (HTTP callback? WebSocket? In-process?).

#### Option B: WE runs its own MCP server alongside AD4M

WE exposes a second MCP endpoint for knowledge tools. Agent connects to both.

```
AD4M MCP (port 3001)         → perspectives, links, SHACL CRUD (incl. SchemaSection)
WE MCP   (port 3002 or unix) → list_components, get_component, validate_schema, etc.
```

**Pros:** No AD4M changes needed. WE fully owns its tools. Ship independently.
**Cons:** Agent must be configured with two MCP servers. Two endpoints to discover, authenticate, manage.

#### Option C (Recommended): Hybrid — SHACL for data, AD4M extension for knowledge

Use SHACL auto-generated tools for all section/template CRUD (free, automatic, already works). For knowledge tools, propose a lightweight custom tool registration API in AD4M.

The AD4M extension doesn't need to be complex — a simple mechanism where:

1. WE registers tool definitions + a handler callback at startup
2. AD4M's `list_tools` includes registered custom tools alongside static and SHACL tools
3. AD4M's `call_tool` dispatches to the registered handler

This is a natural evolution for AD4M anyway — other apps beyond WE will want custom MCP tools.

**Recommended phasing:**

1. **Immediate:** Use SHACL tools for section CRUD. No custom tools needed for basic AI editing.
2. **Soon:** Implement Option B (WE's own MCP server) for knowledge tools. Gets the tools working without blocking on AD4M.
3. **Later:** Propose Option A to AD4M. Migrate WE's knowledge tools to the unified endpoint once the registration API exists.

This way WE is never blocked, but converges on a single endpoint over time.

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

### Phase 1: SHACL section tools (ships with schema-customization PR)

- [ ] Define `SchemaSection` and `TemplateInstall` AD4M models
- [ ] Verify auto-generated SHACL tools cover section CRUD needs
- [ ] Test agent workflow: query sections → get section → modify → set back
- [ ] Document SHACL tool names and usage patterns for agents

### Phase 2: WE knowledge MCP server

- [ ] Stand up lightweight MCP server in WE (separate endpoint)
- [ ] Implement knowledge tool handlers backed by `AssembledContext`
- [ ] Implement `validate_schema` using existing schema-system validators
- [ ] Add `assemblePrompt({ mode: 'slim' })` for MCP-aware orientation prompt
- [ ] Add tests for tool outputs
- [ ] Add docs and examples for agent usage

### Phase 3: Unified endpoint (requires AD4M PR)

- [ ] Propose custom tool registration API for AD4M MCP server
- [ ] Migrate WE knowledge tools from standalone server to AD4M registration
- [ ] Deprecate standalone WE MCP endpoint

### Out of scope

- [ ] Module marketplace publishing flow
- [ ] Auto-fixing / code-writing tools
- [ ] Contribution workflow automation
- [ ] UI for browsing MCP-exposed data

---

## Open Questions

1. Should validation return only errors, or also “best practice” warnings?
2. Should `get_component` include example schema snippets in v1?
3. Should MCP expose raw token sets, normalized token sets, or both?
4. Do we want one `search_context` tool, or several explicit tools only?
   - current instinct: explicit tools first5. **AD4M custom tool registration** — what handler transport makes sense? HTTP callback adds latency; in-process function requires a shared runtime. Worth prototyping both.
5. **SHACL tool query limitations** — SHACL `{class}_query` returns all instances. For large template sets, do we need a filtered query tool? Or is the data volume small enough that agent-side filtering is fine?
6. **Auth model** — if WE runs its own MCP server (Option B), how does it authenticate? Reuse AD4M's JWT? Separate auth? Local-only?

---

## Success Criteria

This work is successful if an agent can reliably:

**Phase 1 (SHACL tools):**

- list template sections via auto-generated SHACL tools
- load a specific section's JSON
- write back a modified section
- create new sections and templates

**Phase 2 (knowledge tools):**

- discover available components without reading a giant prompt
- inspect exact props for one component
- inspect stores and token sets on demand
- validate a candidate schema before writing it to a section

At that point, the static prompt becomes a slim orientation layer and the MCP tools do the heavy lifting.
