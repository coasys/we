# @we/graph-protocol

The graph system's contract package — types only, erased at build time.

## What belongs here

- The **address scheme** (`src/address.ts`): every node's single stable
  string address, minted and parsed only here. The load-bearing decision of
  the whole system — see `../README.md`.
- The plugin contracts: `Expander`, `Layout`, `Behaviour`, seed sources,
  style rules, and the JSON spec (`GraphSpec`) a template's `GraphView`
  props conform to.
- The engine-facing data shapes: `GraphNode`, `GraphEdge`, `PointerInput`,
  `ExpanderContext`/`ExpanderQuery` (the three-function data port a host
  binds).

## What does not

- Implementations. The engine is `@we/graph-core`; first-party plugins are
  `@we/graph-expanders` / `@we/graph-layouts`; the Solid adapter is
  `@we/graph-solid`. This package depends on nothing and everything in the
  graph system depends on it.

Tests: `pnpm --filter @we/graph-protocol test` (the address round-trip).
