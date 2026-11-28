# Session start

Session start takes the session from the first connection to the first space. `SessionStore.initialise` connects through the backend connector once and sets the **boot state**: `initialising`, `login`, `createAgent`, `finishing`, `ready` or `error`. The boot screen reads one **sign-in step**, which `signInStep` computes from the boot state and four flags. When the session unlocks, `BootController` loads the person's data and opens the first space.

**Why:** A boot screen that computes its own step from several flags must exclude each branch by hand. A screen that a deployment redraws must then repeat every exclusion, or it shows two steps or none. So `signInStep` computes the step once, and a screen draws the step that it gets. The password is not template state: the [credential field](../../interface/chrome/protected-pieces.md) holds it, and no action that a template can call takes the password as an argument.

**Parent:** [Boot](README.md)

<details><summary>How it works</summary>

1. When `SessionStore` mounts, it starts the [app bridge](../platform/embedded-apps.md). `createEffect(initialise)` then starts the boot.
2. `initialise` calls `firstScreen.hold()`, then `backend.initialize({ selfId, afterFirstScreen })`.
3. `session.status()` sets the state: no agent gives `createAgent`, a locked agent gives `login`, and an unlocked agent runs the post-unlock load. A failure sets `error` and keeps `bootError`.
4. `unlock()` reads `credential.read()`, calls `login`, and then calls `credential.clear()`. `login` calls `session.signIn`. `profileStore.completeAccountSetup` calls `createAgent`, which calls `session.signUp`. After a first run's load, `markReady` sets `finishing` until `finishSetup` sets `ready`.
5. On unlock, `BootController` runs: `refreshMe` and `readDatasets`, `prepareSpaceAt`, then the system datasets and the opening space in parallel, `loadDatasets`, `subscribeToChanges` and `markReady`. After the first screen opens, it runs `loadSpaces`.
6. A guest goes to `/space/<id>`, and joins first when the guest link says `autoJoin`. Any other session goes to the saved deep link, or to `/`.

| Sign-in step             | Shown when                                                              |
| ------------------------ | ----------------------------------------------------------------------- |
| `starting`, `failed`     | the data layer comes up, or cannot be reached                           |
| `unlock`, `create`       | the account is locked, or has no identity yet                           |
| `settingUp`, `setUpAi`   | a new account's identity is made; then the AI choice (`aiSetupStep.ts`) |
| `switching`, `preparing` | another account is chosen, or a new account directory is made           |
| `ready`                  | signed in                                                               |

</details>

<details><summary>Where in the code</summary>

- [stores/SessionStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/SessionStore.tsx): `BootState`, `initialise`, `login`, `unlock`, `createAgent`, `markReady`, `finishSetup`. The store itself: [Session store](../../data/stores/session.md).
- [providers/BootController.tsx](../../../packages/app-shell/src/frameworks/solid/providers/BootController.tsx): the post-unlock load and the first navigation.
- [shared/signInStep.ts](../../../packages/app-shell/src/shared/signInStep.ts): `SignInStep`, `signInStep`; [shared/aiSetupStep.ts](../../../packages/app-shell/src/shared/aiSetupStep.ts): the AI step of a first run.
- [components/CredentialField.tsx](../../../packages/app-shell/src/frameworks/solid/components/CredentialField.tsx) and [credential.ts](../../../packages/app-shell/src/frameworks/solid/credential.ts): the credential field.

</details>
