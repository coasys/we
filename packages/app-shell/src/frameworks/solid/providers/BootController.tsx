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
import { useDatasetStore } from '../stores/DatasetStore';
import { useProfileStore } from '../stores/ProfileStore';
import { useRouteStore } from '../stores/RouteStore';
import { useSessionStore } from '../stores/SessionStore';
import { useSpaceStore } from '../stores/SpaceStore';

/**
 * Read the guest join target set by the entry point, if present.
 *
 * The entry point writes `__weGuestJoinTarget` on `window` when the URL matches `/join/<id>`.
 * Read once, consumed once — after the join the property stays inert and the user navigates
 * normally inside the space.
 */
function consumeGuestJoinTarget(): string | null {
  const w = window as unknown as { __weGuestJoinTarget?: string };
  const target = w.__weGuestJoinTarget ?? null;
  delete w.__weGuestJoinTarget;
  return target;
}

export function BootController() {
  const session = useSessionStore();
  const datasetStore = useDatasetStore();
  const profileStore = useProfileStore();
  const spaceStore = useSpaceStore();
  const routeStore = useRouteStore();

  // Capture the URL the user landed on before any boot-time navigation.
  // Used to restore deep links after auth completes (e.g. refresh on /space/uuid/flux).
  const initialPath = window.location.pathname;

  // Read the guest target before any async work — the entry point sets it synchronously.
  const guestJoinTarget = consumeGuestJoinTarget();

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

    // Guest mode: join the target space and navigate into it.
    // The join call handles dedup (already-joined spaces just get focused), SDNA install, and
    // dataset tracking. `focus: true` switches the active dataset so the user sees the space.
    if (guestJoinTarget) {
      try {
        await spaceStore.joinSpace(guestJoinTarget, true);
      } catch (err) {
        console.error('BootController: guest join failed', err);
      }
      // Navigate directly into the joined space. The `/space/<id>` route works with both
      // a local uuid and a neighbourhood CID — the router resolves either through the
      // dataset list. This replaces the /join/ URL so a reload does not re-trigger the flow.
      routeStore.navigate(`/space/${guestJoinTarget}`);
      return;
    }

    // Restore the original URL (e.g. a deep link opened via refresh), falling back to '/'
    routeStore.navigate(initialPath || '/');
  });

  return null;
}
