# First screen

The **first screen** is one gate for the work that the opening page does not need. At cold boot, `SessionStore` holds the gate. Work such as the space list, presence, interpretation reads and the editor's model status starts only after the gate opens.

**Why:** One executor answers the requests in turn. When the app sent every request at cold boot, the page that the person opened came back behind all of them (`shared/firstScreen.ts`). The gate is not a scheduler and has no queue. Each piece of work reads `open()` in the effect that starts it, or awaits `whenOpen()`, so it reads the current state when it starts.

**Parent:** [Boot](README.md)

<details><summary>How it works</summary>

The gate opens on the first of these:

1. The Feed's first read lands or fails. The Feed calls `waiting()` when its first read leaves and `answered()` when it ends, through its module store deps.
2. `TemplateLayout` calls `drawn()` and nothing on the screen said `waiting()`. `drawn()` looks again after the current turn.
3. The ceiling: `FIRST_SCREEN_CEILING_MS` (8000 ms) after `hold()`.

The gate holds once. A later space switch does not close it. A host that never calls `hold()` gets an open gate from the start. The backend connector also gets `afterFirstScreen`, so the AD4M adapter can defer its own work.

</details>

<details><summary>Where in the code</summary>

- [shared/firstScreen.ts](../../../packages/app-shell/src/shared/firstScreen.ts): `FirstScreen`, `createFirstScreen`, `FIRST_SCREEN_CEILING_MS`.
- [frameworks/solid/firstScreen.ts](../../../packages/app-shell/src/frameworks/solid/firstScreen.ts): `firstScreen`, the one gate per app, over a Solid signal.
- [stores/SessionStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/SessionStore.tsx): `firstScreen.hold()` and `afterFirstScreen`.
- [layouts/TemplateLayout.tsx](../../../packages/app-shell/src/frameworks/solid/layouts/TemplateLayout.tsx): `firstScreen.drawn()`.
- [module-system/feed/src/feedStore.ts](../../../packages/module-system/feed/src/feedStore.ts): `waiting()` and `answered()`; `ModuleStoreDeps.firstScreen` in [module-system/shared/src/module.ts](../../../packages/module-system/shared/src/module.ts).

</details>
