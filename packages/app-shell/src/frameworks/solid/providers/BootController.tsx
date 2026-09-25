/**
 * BootController — the post-unlock boot sequence.
 *
 * Loading user data spans several stores (system datasets, the dataset list, spaces, the own
 * profile), so no single store can own it without becoming a hub again. This component sits
 * beneath every store provider, composes the sequence, and registers it with SessionStore —
 * which runs it on boot when the agent is already unlocked, and again after login().
 *
 * Renders nothing.
 */
import { consumeGuestBootTarget } from '@shared/guestLink';
import { wireIdentityModule } from '@shared/identity';

import { useDatasetStore } from '../stores/DatasetStore';
import { useProfileStore } from '../stores/ProfileStore';
import { useRouteStore } from '../stores/RouteStore';
import { useSessionStore } from '../stores/SessionStore';
import { useSpaceStore } from '../stores/SpaceStore';

export function BootController() {
  const session = useSessionStore();
  const datasetStore = useDatasetStore();
  const profileStore = useProfileStore();
  const spaceStore = useSpaceStore();
  const routeStore = useRouteStore();

  /*
    The URL the user landed on, captured before any boot-time navigation and spent once.

    Held as a `let` and cleared on use, because this handler runs on *every* unlock rather than only
    the first. Signing out and back in within one session re-ran it against the path the app was
    opened at half an hour earlier — so coming back landed you wherever you started, quite possibly
    a space you have since left, rather than where you were. Once it has been spent, the second
    unlock reads the location as it is now, which is the honest answer.

    The search string travels with it: a deep link is routinely `?type=posts&sort=new`, and
    restoring only the pathname put somebody back on the page they linked to with every filter reset.
  */
  let pendingDeepLink: string | null = window.location.pathname + window.location.search;

  // Read the guest target before any async work — the entry point sets it synchronously, and
  // reading it removes it, so a remount cannot join a second time.
  const guestBoot = consumeGuestBootTarget();

  session.onSessionUnlocked(async () => {
    if (!session.lifecycle()) return;

    // initSystemDatasets must complete before loadDatasets/loadSpaces so that the
    // dataset snapshot always includes we-root and we-test — even on first boot when
    // they don't exist yet and have to be created.
    await Promise.all([session.refreshMe(), datasetStore.initSystemDatasets()]);
    await datasetStore.loadDatasets();
    await spaceStore.loadSpaces();
    datasetStore.subscribeToChanges();
    session.markReady();

    // Seed own profile into the cache from the public dataset
    const ownDid = session.me()?.did;
    if (ownDid) profileStore.fetchProfile(ownDid);

    // Wire the identity module — connect store signals to the executor's identity RPC handlers.
    // Non-blocking: the identity section degrades to a loading spinner until data arrives.
    if (ownDid && session.port()) {
      const serverUrl = session.serverUrl() ?? `http://localhost:${session.port()}`;
      const wsUrl = serverUrl.replace(/^http/, 'ws') + '/api/v1/ws';
      wireIdentityModule({ wsUrl, token: session.token() ?? '' }, ownDid).catch((err) =>
        console.warn('BootController: identity wiring failed', err),
      );
    }

    /*
      Somebody arrived on a guest invite link.

      Only a session this link created joins on its own — see `GuestBootTarget.autoJoin`. Anybody
      who already had an identity is taken to the space's own join gate, which is what the ordinary
      share link does and what the invite copy promises.

      The navigation happens either way, including after a failure: `/space/<id>` IS the join gate,
      and it states the reason (`joinError`, matched against this route segment) beside a Join
      button. Landing there is how a guest whose join did not complete finds out and retries;
      nothing else on the page could have told them. `/space/<id>` accepts a local uuid and a
      neighbourhood CID alike, so the shared id the link carries resolves.

      `replace`, not push: `/join/<id>` must not stay in the history. Backing onto it puts the app
      on a path no route claims, and reloading there re-runs the whole guest flow.
    */
    if (guestBoot) {
      if (guestBoot.autoJoin) {
        await spaceStore.joinSpace(guestBoot.spaceId).catch((err) => {
          console.error('BootController: guest join failed', err);
        });
      }
      routeStore.navigate(`/space/${guestBoot.spaceId}`, { replace: true });
      return;
    }

    // Restore the original URL (e.g. a deep link opened via refresh), falling back to '/'
    const target = pendingDeepLink ?? window.location.pathname + window.location.search;
    pendingDeepLink = null;
    routeStore.navigate(target || '/');
  });

  return null;
}
