# Decision: JSON Schemas as the App Definition Layer

## Status

**Accepted** — foundational architectural decision. All plan documents build on this.

## Context

WE uses a JSON schema system to define app UIs. Schemas reference components by name, bind to data via tokens like `$query` and `$store`, and support iteration (`$forEach`), conditionals (`$if`), routing (`$routes`), and transformations (`$map`, `$pick`). The system currently has 14 operators — an expression language embedded in JSON.

The question is whether this is the right architectural direction, or whether WE should use code-based templates (JSX/TSX), a visual builder, a compiled DSL, or some other approach.

This is the most consequential architectural decision in WE. If it's wrong, everything built on top — the apps ecosystem, MCP tooling, section-level sharing, AI editing — is built on the wrong foundation.

## The Concern

JSON/XML DSLs that grow into programming languages have a rough history. XSLT, BPEL, Salesforce formulas, and SharePoint CAML all started as declarative data formats and became unmaintainable as they accumulated operators. They suffered from: no debugger, no stack traces, no IDE autocomplete, terrible error messages, and manual find-and-replace refactoring.

If WE's schema system follows this trajectory, we'd end up with an unmaintainable custom language embedded in JSON — the worst of both worlds.

## Why the XSLT Comparison Is Misleading

Those systems failed for a specific reason: **they tried to replace general-purpose programming.** They became Turing-complete, had loops and recursion and string manipulation and error handling, and humans had to write and maintain them by hand. That combination is genuinely terrible.

WE's schema system is architecturally different in three ways:

### 1. Deliberately non-Turing-complete

No loops, no recursion, no variables, no general computation. `$expr` (arbitrary JS via `new Function()`) was specifically identified and removed. The operators are declarative bindings (connect data to UI), not imperative instructions (do X then Y). They're closer to HTML attributes than to a programming language.

### 2. The component escape hatch prevents language bloat

When something is genuinely complex (audio playback, drag reordering, rich text editing), it becomes a SolidJS component — NOT a new operator. This is what XSLT lacked. XSLT kept adding to the language because there was no escape. WE's schema says "I can't express this" and delegates to code.

The gating principle ("new tokens require 3+ real templates AND can't be done with existing tokens") is the formal rule that prevents the XSLT trajectory. The moment you'd add a 20th operator to avoid writing a custom component, you're on the wrong path. The escape hatch to real code must remain the preferred path for complex behavior.

### 3. AI is the primary author, not humans

This genuinely changes the calculus. The historical complaint about JSON DSLs is that humans can't read, write, or debug them. If the primary interaction is "tell AI what you want → AI generates JSON → system validates and renders," human readability is secondary. The format optimizes for machine generation and consumption, which JSON is ideal for.

## Why JSON Schemas Are Specifically Right for WE

WE has three constraints that together make JSON schemas almost the only viable choice:

### Constraint 1: Decentralized template sharing requires safety

Templates are received from strangers via AD4M. Whatever format they use must be **safe to receive and render without trust.** JSON is inert — it can't execute code, access cookies, or phone home. A React component can. A SolidJS file can. An ESM bundle can. JSON can't.

This isn't a preference — it's a security requirement for decentralized template distribution. The alternative is sandboxing code in iframes with postMessage bridges, which adds enormous complexity.

### Constraint 2: Section-level remixability requires transparency

You can't share "part of a React component." Components are opaque — you can compose them but not decompose them. JSON schemas are transparent — you can extract a route section, a sidebar section, a theme section. You can splice sections from different templates into your own layout.

This is one of WE's most compelling features and it _only works_ because schemas are data, not code. Code is opaque. Data is transparent.

### Constraint 3: AI as the primary builder requires structured output

LLMs are significantly better at generating structured JSON than arbitrary TypeScript/JSX. JSON has a fixed grammar, schemas have a validatable structure, and the MCP validate loop can catch errors before rendering. Generating a valid SolidJS component requires understanding reactivity, lifecycle, imports, CSS, and the full JavaScript language surface. Generating a valid schema node requires knowing ~14 operators and a component list.

## Alternatives Considered

| Approach                            | Safe to share?      | Section-remixable?          | AI-friendly?                    | Full expressiveness?     |
| ----------------------------------- | ------------------- | --------------------------- | ------------------------------- | ------------------------ |
| **JSON schemas + component escape** | ✅ Inert data       | ✅ Sections are JSON chunks | ✅ Structured, validatable      | ✅ Via custom components |
| Code templates (JSX/TSX)            | ❌ Arbitrary code   | ❌ Opaque                   | ⚠️ Harder to generate correctly | ✅ Full language         |
| Visual builder (Webflow-style)      | ✅ State, not code  | ⚠️ Possible but complex     | ❌ AI can't "click buttons"     | ⚠️ Limited logic         |
| Compiled DSL (Svelte-style)         | ❌ Compiles to code | ⚠️ Pre-compilation only     | ⚠️ Custom syntax                | ✅ Full language         |
| Web Components as sharing format    | ❌ JS bundles       | ❌ Opaque                   | ⚠️ Harder                       | ✅ Full language         |
| MDX (Markdown + components)         | ⚠️ Can embed code   | ⚠️ Text-level only          | ⚠️ Unstructured                 | ⚠️ Limited logic         |

Nothing else hits all three constraints. Code-based approaches sacrifice safety. Visual builders sacrifice AI authoring. Compiled DSLs require tooling investment comparable to building a language. JSON schemas with a component escape hatch are the Pareto-optimal point for WE's specific requirements.

## Load-Bearing Dependencies

The schema system's viability depends on three supports that must all be solid:

### 1. Component library coverage

The core library must be comprehensive enough that schemas handle 80%+ of UI needs without custom components. If users constantly need custom components, the schema becomes boilerplate glue rather than the primary app definition. This is the highest practical risk.

### 2. AI tooling pipeline

If AI is the primary schema author, the quality of AI output determines the entire system's viability. The ai-context → MCP → validate loop is **load-bearing infrastructure**, not Phase D polish. If it's flaky, users are stuck hand-editing JSON with 14 operators and no tooling — which is exactly the XSLT failure mode.

### 3. Token set boundary discipline

The gating principle must hold: "New tokens require demonstrated need across 3+ real templates, AND cannot be reasonably expressed with existing tokens." The escape hatch to SolidJS components is the defense against DSL bloat. Complex behavior should become components, not operators.

## Decision

JSON schemas with a component escape hatch are the right architecture for WE. The approach uniquely satisfies WE's three constraints (decentralized sharing safety, section-level remixability, AI-first authoring) that no alternative approach handles simultaneously.

The architecture is sound. The execution risks — component coverage, AI tooling reliability, and token boundary discipline — are real but addressable, and are specifically targeted by the PR roadmap.
