/**
 * A space's settings, docked beside the space rather than over it.
 *
 * ## Why a panel and not the settings overlay
 *
 * The chrome rail's gear used to call `openShellView('settings', '/spaces/<id>')` — which is to say
 * it opened *global* settings and then navigated, inside that overlay's own router, to the page for
 * the space you happened to be in. Everything about that read as an exit: the "Settings" heading and
 * its Account / Appearance / Spaces & data nav appeared, the space vanished behind a full-window
 * overlay, and the thing you were configuring was no longer on screen while you configured it.
 *
 * It was also the one surface that could not follow you. `navigateToSpace` closes shell views, so
 * walking to another space closed the settings you had open for the last one.
 *
 * A dock fixes all of that for free, because the host already owns it: drag and eight snap
 * positions, resize, float or displace, maximise, one close button on one titlebar, and a remembered
 * placement per device. Nothing here positions itself — see `docs/architecture/chrome-and-panels.md`.
 *
 * ## What it is *not*
 *
 * Not a second definition. The body is {@link spaceSettingsBody}, the same nodes the page in
 * Settings → Spaces & data renders, given the open dataset instead of a route segment. The page
 * stays, because configuring a space you are not standing in is a different act and the panel cannot
 * express it; see the docblock in `SpaceSettings.ts`.
 *
 * ## Modals from inside a panel
 *
 * Vocabulary opens modals — the model wizard, the signal-type form — and a panel is a `position:
 * fixed` box with `overflow: hidden` that becomes a containing block for fixed descendants the
 * moment it is floating and blurred. Every overlay primitive promotes itself into the browser's top
 * layer (`OverlayElement` calls `showPopover`) precisely so that cannot clip them, which is what
 * makes this tab usable in here at all.
 *
 * Named `.schema.ts` so `pnpm --filter @we/schema-shared validate` checks it. The validator walks
 * files by that name and descends into what they import, and nothing else imports this — a dock node
 * is reached from a registry, not from another schema — so under any other name a typo'd prop here
 * would show up only as part of a panel silently not rendering.
 */
import type { SchemaNode } from '@we/schema-shared';

import { spaceIdentity, spaceSettingsBody } from './SpaceSettings.ts';

/**
 * What the panel says when there is no space to configure.
 *
 * Reachable, and not only in theory: the rail's gear exists only inside a space, but the panel is
 * the user's to leave open, and the spaces list, a profile overlay or an embedded app all take the
 * current dataset away underneath it. An empty box would read as a panel that had broken.
 *
 * Said rather than self-closed. A panel that vanished when you walked out of a space would take its
 * position and size with it, and the way back would be a gear that is also no longer on screen —
 * whereas this recovers by itself the moment a space is open again.
 */
const noSpaceOpen: SchemaNode = {
  type: 'Column',
  props: { gap: '200', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
  children: [
    { type: 'we-text', props: { variant: 'label' }, children: ['No space open'] },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint' },
      children: ['Open a space and its settings appear here.'],
    },
  ],
};

export const spaceSettingsPanel: SchemaNode = {
  type: 'Column',
  props: {
    /*
      Fills the box the host gave it, and clips rather than growing — the same root every docked
      panel uses. What scrolls is one tab's contents, so the tab strip and the space's name stay put
      however long the tab is; see `spaceSettingsBody`'s `fill`.
    */
    width: '100%',
    height: '100%',
    p: '400',
    gap: '400',
    overflow: 'hidden',
  },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: 'datasetStore.currentDataset' },
        /*
          Keyed on the open dataset, so this panel is always about where you are standing. That is
          what lets it survive walking between spaces: the `$each` re-points at the new row and the
          controls beneath it rewrite themselves, where the overlay it replaces simply closed.
        */
        then: spaceSettingsBody({ $: 'datasetStore.currentDataset.id' }, [spaceIdentity], true),
        else: noSpaceOpen,
      },
    },
  ],
};
