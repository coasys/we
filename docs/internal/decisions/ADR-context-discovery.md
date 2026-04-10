# ADR: Context Discovery Architecture

**Date:** 2025-04-09
**Status:** Accepted
**Relates to:** PR #11 — Declarative Context Discovery

## Context

`@we/ai-context` generates AI context (instruction files, `schemaContext.ts`, `context.json`) by extracting type information from design-system packages and models. The extraction uses CEM parsing (primitives) and ts-morph AST analysis (components, widgets, tokens, models).

The original `generate.ts` hardcodes all package paths. Adding a new package requires modifying the central file.

## Decision

**Use glob-based discovery with per-package `"context"` declarations in `package.json`.**

`generate.ts` scans `packages/*/package.json` and `packages/*/*/package.json` for a `"context"` field, then calls the appropriate extractor for each discovered package. Extraction still happens centrally — only discovery is decentralized.

## Alternatives Considered

### 1. Per-package CLI bin (`we-generate-context`)

Each package runs a CLI tool during its own build to produce a `context.json` fragment. A post-build aggregator merges fragments.

**Rejected because:**

- **3-phase build ordering:** `@we/ai-context` must build first (provides the bin), DS packages build second (run the bin), aggregation runs third (reads all fragments). Today it's one self-contained step. The post-build step is easy to forget.
- **Reverse dependency:** Every DS package must add `@we/ai-context` as a devDep just for the bin. Currently no DS package depends on `@we/ai-context`.
- **Complexity for 5 packages:** The system has 5 context providers that change infrequently. A CLI + 3-phase build is over-engineered for this scale.
- **Not actually needed for community packages:** Community packages outside the workspace won't follow our `*.types.ts` / `@Model` conventions — our extractors won't work on them. They'll ship pre-built `context.json` files instead, which the glob approach can also read from `node_modules` when that need arises.

### 2. Per-package `generate-context.ts` scripts

Each package has its own script that imports extractors from `@we/ai-context`.

**Rejected because:**

- Every script is identical boilerplate (import extractor, call it, write JSON).
- Extractors become part of the public API, locking their signatures.
- Same build ordering problems as the CLI approach.

### 3. Keep hardcoded paths (do nothing)

**Rejected because:**

- Adding `@we/block-solid` as a context provider requires modifying `generate.ts`.
- Doesn't scale to future packages or community contributions.
- Violates single responsibility — `generate.ts` knows every package's internal structure.

## Consequences

**Positive:**

- Adding a new context-providing package = add `"context": { "type": "..." }` to its `package.json`. No other files touched.
- No build pipeline changes. `generate.ts` runs during `@we/ai-context`'s existing `build:steps`, same as today.
- Extractors stay internal — their APIs can evolve without breaking anything.
- The `"context"` config format is forward-compatible with a CLI approach if we ever need it.

**Negative:**

- `@we/ai-context` still reads source files from other packages at build time (the dependency direction hasn't changed, only the discovery mechanism).
- Community packages outside the monorepo can't use our extractors directly — they must ship pre-built `context.json` files.

**Neutral:**

- The glob adds ~10ms to build time. Negligible.
- ts-morph is still a devDep of `@we/ai-context`, not a runtime dep. No package size impact.
