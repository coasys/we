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

  // Capture the URL the user landed on before any boot-time navigation.
  // Used to restore deep links after auth completes (e.g. refresh on /space/uuid/flux).
  const initialPath = window.location.pathname;

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
    routeStore.navigate(initialPath || '/');
  });

  return null;
}
