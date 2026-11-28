# Web

The web target (`@we/app-web`) runs WE in a browser tab. It connects through ad4m-connect to an executor on this computer or on a remote host, and it offers none of the optional platform parts. A **guest link** opens a guest session on a host without an account.

**Why:** A browser tab has no file system for accounts and does not start an executor, and ad4m-connect already decides which executor the tab talks to (`AccountHost` in `shared/platform/types.ts`). A guest link writes the same `localStorage` keys that every boot reads. So the target uses the guest connector only when no session is stored, and an agent with a session keeps that session and goes to the space's join gate (`src/index.tsx`).

**Parent:** [Targets](README.md)

<details><summary>How it works</summary>

1. `parseGuestParams()` reads a guest link from the URL. `hasStoredSession()` checks for a stored ad4m-connect session.
2. The connector is `createGuestConnector(hostUrl)` for a guest link without a stored session, else `ad4mConnector` ([Backend connector](../platform/backend-connector.md)).
3. With `ad4mConnector`, the target calls `registerHostChromeReserve('ad4m-connect', {bottom: 54})`, because ad4m-connect draws its settings button in the bottom-right corner of the window.
4. For a guest link, `writeGuestBootTarget({spaceId, autoJoin})` tells `BootController` which space to open. `autoJoin` is true only when no session is stored.
5. It renders `PlatformProvider` with `webPlatform` and `App`.

</details>

<details><summary>Where in the code</summary>

- [src/index.tsx](../../../apps/we-web/src/index.tsx): the entry.
- [src/platform/](../../../apps/we-web/src/platform/): `webPlatform`, `ad4mConnector`, `createGuestConnector`, `parseGuestParams`, `hasStoredSession`, `randomUuidPolyfill`.
- [public/_redirects](../../../apps/we-web/public/_redirects): the single-page-app rule of the deployed site.
- [e2e/](../../../apps/we-web/e2e/): the journeys, which run against this target ([End-to-end tests](development/e2e.md)).

</details>
