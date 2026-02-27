# VISION.md — Why WE Exists

## The Problem

Every application reinvents the same building blocks: user profiles, messaging, notifications, feeds, settings panels, navigation patterns. Each team rebuilds these from scratch, creating isolated silos that can't interoperate.

AI agents are accelerating this fragmentation. They can generate entire applications in minutes — but each one is a standalone island. The diversity of creation is exploding while integration collapses.

Meanwhile, the platforms that do achieve integration (social networks, app stores, cloud suites) do so through centralization — locking users into ecosystems controlled by single entities.

## The Vision

**WE is a composable module ecosystem for building decentralized applications.**

Instead of building apps, contributors build **modules** — reusable pieces at every level of abstraction:

- **Design tokens** — colors, spacing, typography that define a visual identity
- **Elements** — basic UI building blocks (buttons, inputs, cards)
- **Components** — functional units (message bubbles, user avatars, rich text editors)
- **Widgets** — self-contained features (comment threads, reaction pickers, media galleries)
- **Pages** — complete views composed from widgets (a feed page, a settings page)
- **Templates** — full application shells ready to customize (a social app, a project manager, a marketplace)

Each layer composes from the layers below. A "social app" template is just a specific arrangement of page modules, which are arrangements of widget modules, all the way down to design tokens.

## How It Works

### Schema-Driven UI

WE's `@we/schema-renderer` turns JSON schemas into live interfaces. Define your data model, and the renderer handles forms, lists, detail views, and validation — no custom UI code needed for standard patterns. When you need custom behavior, drop in a component module.

### The Seed System

Every WE deployment starts from a **seed file** (`we-seed.json`) — a single configuration that defines:
- Which modules to include
- How to arrange and theme them
- Platform-specific settings (web, desktop, mobile)

This makes white-labeling trivial. Want a community platform? Pick community modules. Want a project manager? Pick project modules. Same framework, different seeds.

### Built on AD4M

WE's data layer is [AD4M](https://ad4m.dev) — an agent-centric, distributed application meta-ontology. This means:

- **Your data stays yours** — local-first, synced peer-to-peer
- **No central servers** — communities run on shared perspectives (knowledge graphs) synced via Holochain
- **Interoperability by design** — AD4M's Social DNA (SHACL schemas) means different apps can read and write the same data patterns
- **AI-native** — AD4M's MCP server lets AI agents work directly with your data, not through brittle API wrappers

### Multi-Platform from Day One

WE runs everywhere through platform adapters:
- **Web** — browser-based, zero install
- **Electron** — full desktop experience on Linux, macOS, Windows
- **Tauri** — lightweight Rust-based desktop alternative

One codebase, one seed file, all platforms.

## The Bigger Picture

WE is the **UI layer** of a three-part stack for distributed collective intelligence:

1. **WE** — composable design system and module marketplace (what users see and interact with)
2. **AD4M** — ontological layer for data, meaning, and agent coordination (how data flows and connects)
3. **Holochain** — trust, validation, and eventually economics (how agreements are enforced)

The goal isn't just another framework. It's infrastructure for a new kind of internet — one where communities own their tools, data stays sovereign, and the building blocks are shared commons rather than corporate moats.

## How to Contribute

**Don't think "build an app." Think "contribute a module."**

The most valuable contributions fit into the composability stack:
- A better date picker element → every app that uses dates improves
- A kanban board widget → any template can drag it in
- A meditation timer page → seed it into a wellness community template

Start small, compose upward. The ecosystem gets richer with every module.

### Getting Started

1. Explore the [design system](./packages/design-system) to understand the token → element → component → widget → page → template hierarchy
2. Check the [schema-renderer](./packages/schema-renderer) for how schemas drive UI generation
3. Look at [Flux](https://github.com/juntofoundation/flux) as the reference application built on WE
4. Read [SEED-SYSTEM.md](./SEED-SYSTEM.md) to understand how modules compose into deployable apps

### For AI Agents

WE is designed to be AI-friendly:
- Schema-driven UI means agents can generate interfaces from data models
- The module system means agents can contribute composable pieces, not monolithic apps
- AD4M's MCP server provides structured tool access to the data layer
- Seed files are JSON — trivially generated and modified by agents

---

*WE exists because the tools we use to connect should be as distributed and composable as the communities that use them.*
