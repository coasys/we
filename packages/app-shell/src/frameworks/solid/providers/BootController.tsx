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
import { trace } from '@we/backend-shared';

import { firstScreen } from '../firstScreen';
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

    /*
      One list read, then everything that only needs the list, side by side.

      initSystemDatasets must complete before loadDatasets so that the published snapshot always
      includes we-root and we-test — even on first boot, when they have to be created — and it hands
      back the list with what it made, so the snapshot costs no second read. The space the address
      names starts loading its templates, its schema reads and its own record now, so the switch the
      route asks for once the list is published finds them done. The other spaces are read after.
    */
    /*
      Each step of loading somebody's data after unlock, under the `boot` scope: how long it took and
      when it ended, so a slow boot says which read it was waiting on. `timed` wraps a step without
      changing what it answers.
    */
    const sincePageStartMs = () => Math.round(performance.now());
    const timed = async <T,>(step: string, run: Promise<T>): Promise<T> => {
      const began = performance.now();
      const result = await run;
      trace('boot', step, { ms: Math.round(performance.now() - began), sincePageStartMs: sincePageStartMs() });
      return result;
    };
    trace('boot', 'unlocked', { sincePageStartMs: sincePageStartMs() });
    const me = timed('me', session.refreshMe());
    const listed = await timed('datasets:list', datasetStore.readDatasets());
    const opening = listed
      ? spaceStore.prepareSpaceAt(guestBoot ? `/space/${guestBoot.spaceId}` : (pendingDeepLink ?? ''), listed)
      : undefined;
    const [, known] = await Promise.all([
      me,
      timed('datasets:system', datasetStore.initSystemDatasets(listed)),
      opening ? timed('space', opening) : undefined,
    ]);
    await timed('datasets:load', datasetStore.loadDatasets(known));
    datasetStore.subscribeToChanges();
    session.markReady();
    trace('boot', 'ready', { sincePageStartMs: sincePageStartMs() });

    /*
      The app appears with only what the space on screen needs: the agent, the dataset list, the root
      (settings, templates, this agent's choices per space) and the open space's own record. Every
      other space's record is for the sidebar and the spaces list — a read per space, each going to
      the same backend as the Feed's first page — so they wait for the first screen, as the sidebar's
      other reads do, and fill in when they land. Until then a row shows the dataset's name and says
      it is loading (`SpaceListEntry.loading`). A failure is logged by `loadSpaces` and blocks nothing.

      Given the list read above, the open space is not read again. Without it, the published one.
    */
    void firstScreen
      .whenOpen()
      .then(() => timed('spaces', spaceStore.loadSpaces(listed)))
      .catch((error: unknown) => console.error('BootController: loading spaces failed', error));

    // Seed own profile into the cache from the public dataset
    const ownDid = session.me()?.did;
    if (ownDid) void profileStore.fetchProfile(ownDid);

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
