# Session

`SessionStore` connects to the backend once and keeps the **boot state**: `initialising`, `login`, `createAgent`, `finishing`, `ready` or `error`. The boot screen does not read the boot state directly. It reads one **sign-in step**, which `signInStep` computes from the boot state and the account flags. When the session unlocks, `BootController` loads the person's data and opens the first space.

**Why:** A boot screen that computes its own step from several flags must exclude each branch by hand. A screen that a deployment redraws must then repeat every exclusion, or it shows two steps or none (`shared/signInStep.ts`). The password is not template state: the host's `CredentialField` writes it to `credential.ts`, and `sessionStore.unlock` and `profileStore.completeAccountSetup` read it from there, so no action takes the password as an argument. A template sees only booleans, for example that something is entered.

**Parent:** [Boot](README.md)

<details><summary>How it works</summary>

1. `createEffect(initialise)` runs once. It calls `firstScreen.hold()` and starts the [app bridge](../platform/embedded-apps.md) before the first `await`.
2. It calls `backend.initialize({selfId, afterFirstScreen})` and keeps the result: client, ports, connection, host, account, guest flag and `disconnect`.
3. `session.status()` sets the state: no agent gives `createAgent`, a locked agent gives `login`, and an unlocked agent runs the post-unlock load. A failure sets `error` and keeps the boot error.
4. `login(password)` calls `session.signIn`. `unlock()` reads `credential.read()` and then calls `credential.clear()`. `createAgent` calls `session.signUp`, then `finishing` holds while the profile is published.
5. On unlock, `BootController` runs: `refreshMe`, `readDatasets`, `prepareSpaceAt`, then the system datasets and the opening space in parallel, `loadDatasets`, `subscribeToChanges` and `markReady`. After the first screen opens, it runs `loadSpaces`.
6. It navigates to the saved deep link, to `/space/<id>` for a guest whose link says `autoJoin`, or to `/`.

| Sign-in step | Shown when |
|---|---|
| `starting`, `failed` | the data layer comes up, or cannot be reached |
| `unlock`, `create` | the account is locked, or has no identity yet |
| `settingUp`, `setUpAi` | a new account's identity is made; then the AI choice (`aiSetupStep.ts`) |
| `switching`, `preparing` | another account is chosen, or a new account directory is made |
| `ready` | signed in |

</details>

<details><summary>Where in the code</summary>

- [stores/SessionStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/SessionStore.tsx): `BootState`, `initialise`, `login`, `unlock`, `createAgent`, `markReady`.
- [providers/BootController.tsx](../../../packages/app-shell/src/frameworks/solid/providers/BootController.tsx): the post-unlock load and the first navigation.
- [shared/signInStep.ts](../../../packages/app-shell/src/shared/signInStep.ts): `SignInStep`, `signInStep`; [shared/aiSetupStep.ts](../../../packages/app-shell/src/shared/aiSetupStep.ts): the AI step of a first run.
- [credential.ts](../../../packages/app-shell/src/frameworks/solid/credential.ts) and [components/CredentialField.tsx](../../../packages/app-shell/src/frameworks/solid/components/CredentialField.tsx): the credential field.
- The boot screen's schema: [Interface](../../interface/README.md).

</details>
