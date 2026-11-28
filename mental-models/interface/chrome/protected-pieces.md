# Protected pieces

A **protected piece** is a part of the interface that no template, theme, seed or bundle can replace. There are three: the password field (`CredentialField`), the safety prompts (`PROTECTED_SLOTS`) and safe mode. The fourth rule of the same kind, what a template may reach, is the template tier ([Template tiers](../templates/tiers.md)).

**Why:** Each piece protects the person who uses the app. So each is enforced at one point that the host owns, and none asks a template, a component or a module to cooperate (`protected-pieces.md`).

**Parent:** [Chrome](README.md)

<details><summary>How it works</summary>

**The password field.**
1. A sign-in screen places `CredentialField` like a component. The value goes to the `credential` module, which is not a store, a prop or an event, so no expression can read it.
2. Input and key events stop at the field. A template gets only `onEdit`, `onSubmit`, `credentialEntered` and `credentialConfirmed`.
3. `sessionStore.unlock()` reads the held value. `login` and `createAgent` are wiring, so they are in no template bag.
4. `judgeBundle` refuses a bundle sign-in screen with no `CredentialField`. A screen that places `host.signIn.form` has the field.

**The safety prompts.**
1. `PROTECTED_SLOTS` holds `core:consentPrompt`, `core:consentSecret`, `core:removeAccount`, `core:screenSource`, `core:installPrompt`, `core:bundlePrompt` and `core:destructivePrompt`. The slot registry refuses to replace, remove or register these slots again.
2. The prompts render in their own layer. While a prompt is open, that layer holds the top layer (`top-layer.ts`) and the rest of the app is `inert`.
3. The host asks before each destructive action, and `describeDestructive` writes the question. So a space template does not show its own confirmation.

**Safe mode.**
1. Safe mode draws WE's own templates and themes for the tab, and changes or deletes nothing.
2. The ways in are `?safe` on any address, Ctrl+Alt+Shift+S (Cmd+Option+Shift+S), and a render that did not finish. `commitTemplate` writes a render record (`beginRender`) before a template that is not bundled renders, and the record is cleared after `SETTLE_MS` (4 s) of a responsive app. A record from another tab counts only after `STALE_MS` (10 s).
3. `safeMode()` decides one time, when `TemplateStore` is created.
4. In safe mode, `commitTemplate` commits the bundled template, `allThemes` lists only the built-in themes, and the app is `we-app`.
5. `templateStore.leaveSafeModeInto` leaves safe mode into the chosen app or into another app.

The desktop menu entry for safe mode: [Hosts](../../hosts/README.md).

</details>

<details><summary>Where in the code</summary>

- [CredentialField.tsx](../../../packages/app-shell/src/frameworks/solid/components/CredentialField.tsx), [credential.ts](../../../packages/app-shell/src/frameworks/solid/credential.ts).
- [slotRegistry.ts](../../../packages/app-shell/src/shared/registries/slotRegistry.ts): `PROTECTED_SLOTS`, `isProtectedSlot`.
- [TemplateProvider.tsx](../../../packages/app-shell/src/frameworks/solid/providers/TemplateProvider.tsx): the prompt layer.
- [top-layer.ts](../../../packages/design-system/3-primitives/src/shared/top-layer.ts).
- [safeMode.ts](../../../packages/app-shell/src/shared/safeMode.ts): `safeMode`, `beginRender`, `SETTLE_MS`, `STALE_MS`, `isSafeModeChord`.
- [TemplateStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/TemplateStore.tsx): `commitTemplate`, `leaveSafeModeInto`; [ThemeStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/ThemeStore.tsx): `allThemes`.
- [destructiveWording.ts](../../../packages/app-shell/src/shared/destructiveWording.ts): `describeDestructive`.
- [docs/architecture/protected-pieces.md](../../../docs/architecture/protected-pieces.md).

</details>
