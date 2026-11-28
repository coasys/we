# Panels

A **panel** is a surface that a module, the editor or a template opens beside the content, for example the call stage, notes or the editor's inspector. The code also calls a panel a **dock**. A **panel lane** is a row of panels along one axis: a band at a window edge, or a `$panels` outlet in a template. Panels in one panel lane that share a place are a **group**, drawn as tabs.

**Why:** A panel says what it has and the size it wants, and the host chooses where it goes, because only the host can see the other panels. The position of a panel and whether it takes room are two separate questions, so a small panel can float over the content without taking a full column (`chrome-and-panels.md`).

**Parent:** [Chrome](README.md)

<details><summary>How it works</summary>

| State | What it means |
|---|---|
| Floating | A card over the content. It takes no room. |
| Snapped | Floating, at one of eight snap points (four corners, four edge centres). |
| Displacing | At an edge-centre snap, it spans its panel lane and moves the content edge inward. |
| Maximised | The full window. The other panels, the sidebar and the rail hide, but stay mounted. |

1. `PanelHost` draws the content of each panel one time. A place holds a `PanelSlot`, and the host moves the panel's element into the slot that shows it, with `moveBefore` where the browser has it. So a panel keeps its state when it moves.
2. Each panel has one frame (`frameBox`). `PanelFrame` is `window` (a titlebar), `flush` (part of the page) or `none`.
3. A placement has two coordinates on an edge: `band` (which panel lane, counting inward) and `order` (where along the panel lane). Panels with the same `band` and `order` share a seat as tabs. The panel that was touched most recently shows, and paints on top (`layerOrder`).
4. Below `NARROW_VIEWPORT_PX` (900px) no panel displaces, and every panel floats.
5. Who moves for whom: chrome at an edge moves inward for a displacing panel; a floating panel clears the chrome itself; nothing moves for a floating panel. The rail moves down to clear the call bar (`railBand`).
6. The shell publishes the result as CSS variables (`--we-chrome-<edge>`, `--we-chrome-rail-width`, `--we-panel-chrome-top`). Chrome reads these variables and does not calculate them again (`chromeInsets.test.ts`).
7. A template declares its panels in `meta.panels`. An entry with `home: '<outlet name>'` starts inline in that `$panels` outlet. The semantic validator gives an error for a `$panels` inside a panel's node, so a panel lane holds sections and a section holds no panel lane.
8. `shellStore.openPanel(panel, inputs)` opens one more instance of a template's panel. `saveLayout` and `applyLayout` keep named layouts. Each panel body starts with `panelShell` or `panelHeader` from `@we/schema-kit`.

What a module declares (`panels`, `close`, `reserve`): [Contributions](../../modules/contract/contributions.md).

</details>

<details><summary>Where in the code</summary>

- [dockGeometry.ts](../../../packages/app-shell/src/shared/dockGeometry.ts): the geometry rules as pure functions (`SNAP_POINTS`, `EDGES`, `FloatPlacement`, `chooseTarget`, `layerOrder`, `railBand`).
- [packages/app-shell/src/shared/registries/](../../../packages/app-shell/src/shared/registries): [dockRegistry.ts](../../../packages/app-shell/src/shared/registries/dockRegistry.ts) (`dockRegistry`, `frameBox`), [templatePanels.ts](../../../packages/app-shell/src/shared/registries/templatePanels.ts), [homeLanes.ts](../../../packages/app-shell/src/shared/registries/homeLanes.ts), [panelInstances.ts](../../../packages/app-shell/src/shared/registries/panelInstances.ts), [shellDocks.ts](../../../packages/app-shell/src/shared/registries/shellDocks.ts), [editorDocks.ts](../../../packages/app-shell/src/shared/registries/editorDocks.ts).
- [packages/app-shell/src/frameworks/solid/components/](../../../packages/app-shell/src/frameworks/solid/components): `PanelHost`, `PanelGroup`, `PanelLane`, `EdgeLanes`, `LaneDivider`, `PanelMotion`.
- [ShellStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/ShellStore.tsx): the panel state and the CSS variables.
- [panelShell.ts](../../../packages/schema-system/kit/src/layout/panelShell.ts).
- [docs/architecture/chrome-and-panels.md](../../../docs/architecture/chrome-and-panels.md).

</details>
