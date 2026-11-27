/**
 * What templates and themes have in common about being shared: publishing one to the marketplace,
 * taking a listing down, putting a copy into a space, and installing a listing — into the agent's own
 * library or into the space on screen, after asking first where the kind asks.
 *
 * The two stores wrote this twice, side by side, and the copies had drifted: one set a loading key
 * the other did not, one checked a space before installing and the other said nothing at all when the
 * library was missing, and each phrased its failures its own way. Written once, the flow is the same
 * for both, and what really differs is passed in — the record type, what is written for one, how a
 * listing is judged, and what installing one does.
 *
 * The flow owns the stores' `operationLoading`: every long action either store runs says what it is
 * doing through the same signal, so a template shows one spinner whichever kind it is listing.
 */
import { asFileField, compressImageToFileData, ImageBlock } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';

import { distinctSignal } from '../distinctSignal';
import type { Toasts } from '../toasts';
import { explain } from '../userMessage';

/** The fields of a stored template or theme the flow reads and writes. */
export interface LibraryRecord {
  id: string;
  slug?: string;
  name: string;
  author?: string;
  version?: number;
  description?: string;
  icon?: string;
  save(): Promise<unknown>;
  delete(): Promise<unknown>;
  setScreenshots(images: unknown[]): Promise<unknown>;
}

/** The record type: what the flow finds and makes them with. */
export interface LibraryEntity<R extends LibraryRecord> {
  findOne(dataset: unknown, query: { where: Record<string, unknown> }): Promise<R | null | undefined>;
  create(dataset: unknown, data: Record<string, unknown>): Promise<R>;
}

/** Where an install goes: the agent's own library, or the space on screen for every member. */
export type InstallDestination = 'personal' | 'space';

export interface LibraryFlowDeps<R extends LibraryRecord, J> {
  reactivity: ReactivityPort;
  toasts: Toasts;
  entity: LibraryEntity<R>;
  /** What one is called in a sentence — `'template'`, `'theme'`. */
  noun: string;
  /** The marketplace dataset's handle, when one is connected. */
  marketplace: () => unknown;
  /** The space on screen, when there is one — where a space install goes. */
  space: () => unknown;
  /** The joined dataset with this id, for sharing into one that is not on screen. */
  datasetOf: (id: string) => unknown;
  /** Who is signed in; only they may update a listing they published. */
  me: () => string | undefined;
  /**
   * Judge a listing before it is installed: what installing it will write, or the reason it will not
   * be installed. A template is accepted at the space tier here; a theme passes as it is.
   */
  judge: (listing: R, destination: InstallDestination) => J | { refused: string };
  /**
   * Whether a person is asked before it is written. A template is — the dialog names what it will
   * be able to do — so the judgement waits in `pendingInstall`; a theme carries no grants to name.
   */
  asks: boolean;
  /** Write what was judged. Throws when it could not, which the flow reports. */
  apply: (judged: J, destination: InstallDestination) => Promise<void>;
  /** Said once a person confirms, before writing — a template some of which will not run here. */
  confirmNote?: (judged: J) => string | undefined;
}

export interface PublishRequest {
  name: string;
  description: string;
  icon: string;
  /** Already worked out: the listing's address in the marketplace. */
  slug: string;
  /** What the listing holds — a template's schema, a theme's overrides and CSS. */
  content: Record<string, unknown>;
  /** Uploaded to the marketplace as the listing's pictures. */
  screenshots: File[];
}

export interface ShareRequest {
  datasetId: string;
  spaceName: string;
  name: string;
  slug: string;
  /** What the space's copy holds, beside its name and slug. */
  content: Record<string, unknown>;
}

export interface LibraryFlow<J> {
  /** What a long action is doing right now — `'publish-marketplace'`, `'marketplace-install:<id>'` — or null. */
  operationLoading: () => string | null;
  setOperationLoading: (key: string | null) => void;
  /** Publish to the marketplace, updating this agent's own listing under the slug. */
  publish: (request: PublishRequest) => Promise<boolean>;
  /** Take a listing down. */
  removeListing: (listingId: string) => Promise<void>;
  /** Put a copy into a joined space, unless it holds one under the slug already. */
  share: (request: ShareRequest) => Promise<boolean>;
  /** Install a listing, asking first where the kind asks. */
  install: (listingId: string, destination: InstallDestination) => Promise<void>;
  /** The judged listing waiting on a person's answer, while the dialog is up. */
  pendingInstall: () => J | null;
  /** Install what is waiting. */
  confirmInstall: () => Promise<void>;
  /** Drop what is waiting without installing it. */
  cancelInstall: () => void;
}

/** A screenshot, as the image record the marketplace holds for a listing. */
async function uploadScreenshot(marketplace: unknown, file: File): Promise<unknown> {
  return ImageBlock.create(marketplace, {
    src: asFileField(await compressImageToFileData(file, `screenshot-${Date.now()}`)),
    altText: 'Screenshot',
    version: 1,
  });
}

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export function createLibraryFlow<R extends LibraryRecord, J>(deps: LibraryFlowDeps<R, J>): LibraryFlow<J> {
  const { reactivity, toasts, entity, noun } = deps;
  const Noun = capitalised(noun);
  const [operationLoading, setOperationLoading] = distinctSignal<string | null>(reactivity, null);
  const [pending, setPending] = reactivity.signal<{
    judged: J;
    listingId: string;
    destination: InstallDestination;
  } | null>(null);

  async function publish(request: PublishRequest): Promise<boolean> {
    const marketplace = deps.marketplace();
    if (!marketplace) {
      toasts.error('Marketplace not connected');
      return false;
    }
    const existing = await entity.findOne(marketplace, { where: { slug: request.slug } });
    if (existing && existing.author !== deps.me()) {
      toasts.error(`A ${noun} with slug "${request.slug}" already exists in the marketplace by a different author`);
      return false;
    }

    setOperationLoading('publish-marketplace');
    try {
      /*
        The new pictures are uploaded before the old ones are let go.

        This used to clear the listing's screenshots and then add one file at a time, so an upload
        that failed part way through reported "failed to publish" and left the listing with none: the
        working listing destroyed by the attempt to update it. Built first and assigned as one list,
        a failed upload never reaches the assignment and the listing keeps what it had.
      */
      const uploaded = await Promise.all(request.screenshots.map((file) => uploadScreenshot(marketplace, file)));
      if (existing) {
        existing.name = request.name;
        existing.description = request.description;
        existing.icon = request.icon;
        existing.version = (existing.version || 1) + 1;
        Object.assign(existing, request.content);
        await existing.save();
        // Only when there are new ones: an update with none picked keeps the pictures it has.
        if (uploaded.length) await existing.setScreenshots(uploaded);
        toasts.success(`${Noun} "${request.name}" updated in marketplace (v${existing.version})`);
      } else {
        const listing = await entity.create(marketplace, {
          name: request.name,
          description: request.description,
          icon: request.icon,
          slug: request.slug,
          origin: 'marketplace',
          version: 1,
          ...request.content,
        });
        if (uploaded.length) await listing.setScreenshots(uploaded);
        toasts.success(`${Noun} "${request.name}" published to marketplace`);
      }
      return true;
    } catch (error) {
      toasts.error(explain(error, `Could not publish that ${noun} to the marketplace`));
      return false;
    } finally {
      setOperationLoading(null);
    }
  }

  async function removeListing(listingId: string): Promise<void> {
    const marketplace = deps.marketplace();
    if (!marketplace) {
      toasts.error('Marketplace not connected');
      return;
    }
    setOperationLoading(`marketplace-delete:${listingId}`);
    try {
      const listing = await entity.findOne(marketplace, { where: { id: listingId } });
      if (!listing) {
        toasts.error(`${Noun} not found in marketplace`);
        return;
      }
      await listing.delete();
    } catch (error) {
      toasts.error(explain(error, `Could not delete that ${noun}`));
    } finally {
      setOperationLoading(null);
    }
  }

  async function share(request: ShareRequest): Promise<boolean> {
    const dataset = deps.datasetOf(request.datasetId);
    if (!dataset) {
      toasts.error('Space not found');
      return false;
    }
    const existing = await entity.findOne(dataset, { where: { slug: request.slug } });
    if (existing) {
      toasts.error(`${Noun} "${request.name}" is already in "${request.spaceName}"`);
      return false;
    }
    setOperationLoading('publish-space');
    try {
      await entity.create(dataset, {
        name: request.name,
        slug: request.slug,
        origin: 'shared',
        version: 1,
        ...request.content,
      });
      toasts.success(`${Noun} "${request.name}" shared to space "${request.spaceName}"`);
      return true;
    } catch (error) {
      toasts.error(explain(error, `Could not share that ${noun} to the space`));
      return false;
    } finally {
      setOperationLoading(null);
    }
  }

  const loadingKey = (listingId: string, destination: InstallDestination) =>
    `${destination === 'space' ? 'space' : 'marketplace'}-install:${listingId}`;

  async function applyJudged(judged: J, destination: InstallDestination, key: string): Promise<void> {
    setOperationLoading(key);
    try {
      await deps.apply(judged, destination);
    } catch (error) {
      toasts.error(
        explain(
          error,
          destination === 'space' ? `Could not install that ${noun} into this space` : `Could not install that ${noun}`,
        ),
      );
    } finally {
      setOperationLoading(null);
    }
  }

  /*
    The fetch and the judgement happen before anybody is asked rather than after, so what the dialog
    shows is what will be written, not a promise about it.
  */
  async function install(listingId: string, destination: InstallDestination): Promise<void> {
    const marketplace = deps.marketplace();
    if (!marketplace) {
      toasts.error('Cannot install: marketplace not connected');
      return;
    }
    if (destination === 'space' && !deps.space()) {
      toasts.error('Cannot install: no active space');
      return;
    }
    const key = loadingKey(listingId, destination);
    let judged: J;
    setOperationLoading(key);
    try {
      const listing = await entity.findOne(marketplace, { where: { id: listingId } });
      if (!listing) {
        toasts.error(`${Noun} not found in marketplace`);
        return;
      }
      const verdict = deps.judge(listing, destination);
      if (verdict && typeof verdict === 'object' && 'refused' in verdict) {
        toasts.error(verdict.refused);
        return;
      }
      judged = verdict;
    } catch (error) {
      toasts.error(explain(error, `Could not read that ${noun}`));
      return;
    } finally {
      setOperationLoading(null);
    }
    if (deps.asks) {
      setPending({ judged, listingId, destination });
      return;
    }
    await applyJudged(judged, destination, key);
  }

  async function confirmInstall(): Promise<void> {
    const waiting = reactivity.untrack(pending);
    if (!waiting) return;
    setPending(null);
    const note = deps.confirmNote?.(waiting.judged);
    if (note) toasts.warning(note);
    await applyJudged(waiting.judged, waiting.destination, loadingKey(waiting.listingId, waiting.destination));
  }

  return {
    operationLoading,
    setOperationLoading,
    publish,
    removeListing,
    share,
    install,
    pendingInstall: () => pending()?.judged ?? null,
    confirmInstall,
    cancelInstall: () => setPending(null),
  };
}
