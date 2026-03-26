# Deferred Work

> Small improvements to revisit when the project has evolved enough to justify them. Each entry includes a trigger condition — when that condition is met, promote into a proper plan doc and remove from here.

---

## Design Tokens

- **Opacity tokens** — A scale (e.g. `0`, `10`, `20`, ..., `100`) maps to `0`–`1` floats. Adds indirection over raw `number`. **Revisit when:** a design review requests named opacity presets.
- **ZIndex tokens** — Named layers (`dropdown: 100`, `modal: 200`, `tooltip: 300`). **Revisit when:** the component library has enough overlapping z-index concerns to warrant a managed layer stack.
- **Border preset tokens** — Named borders (`'subtle'`, `'strong'`). **Revisit when:** patterns emerge from Component Library Expansion (#10) that show repeated border definitions.
