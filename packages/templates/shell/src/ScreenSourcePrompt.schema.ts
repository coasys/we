/**
 * Which screen or window to share, on a machine whose OS will not ask.
 *
 * ## Why this exists at all
 *
 * A browser raises its own picker for `getDisplayMedia`, and so do macOS 15+ and a Wayland portal —
 * and where they do, the source list never reaches the app, which is worth keeping. Everywhere else
 * Electron hands the decision to the app, and the app took `sources[0]`: the first screen, chosen by
 * nobody. On a two-monitor desktop that is a coin toss, and sharing the wrong screen is not a
 * mistake you can see from the sharing side.
 *
 * ## Why it is host chrome
 *
 * The host is the one asking, and it is asking on behalf of a `getDisplayMedia` that a page is
 * already awaiting — so this cannot belong to whichever surface pressed the button, and it has to
 * exist even if that surface has since been unmounted. The consent and install prompts are here for
 * the same reason and this sits beside them.
 *
 * ## Every exit answers
 *
 * There is a request outstanding the whole time this is up, so closing it has to say something
 * rather than leaving a promise hanging. Cancel, the backdrop and the close button all answer with
 * an empty id, which the host reads as a cancellation and the page receives as the same refusal a
 * browser's own picker gives when it is dismissed.
 */
import type { SchemaNode } from '@we/schema-shared';

/** Answer with nothing — the cancellation every exit shares. */
const cancel = { $action: 'shellStore.chooseScreenSource', args: [''] };

export const screenSourcePrompt: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'count(shellStore.pendingScreenSources)' },
    then: {
      type: 'we-modal',
      props: { size: 'lg', close: cancel },
      children: [
        {
          type: 'we-text',
          props: { variant: 'heading-sm', tag: 'h2' },
          slot: 'header',
          children: ['Choose what to share'],
        },
        {
          /*
            A grid of stills rather than a list of names.

            Window titles repeat and screens are called things like "Entire screen 2", so a name
            alone routinely cannot tell two apart — which is the failure being fixed, one step
            removed. The picture is the identification and the name is the caption.
          */
          type: 'Grid',
          props: { minChildWidth: '220px', gap: '300', width: '100%' },
          children: [
            {
              type: '$each',
              props: { items: { $: 'shellStore.pendingScreenSources' }, as: 'source' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'bare',
                    width: '100%',
                    r: 'surface',
                    p: '200',
                    hoverProps: { bg: 'surface-hover' },
                    focusProps: { bg: 'surface-hover' },
                    onClick: { $action: 'shellStore.chooseScreenSource', args: [{ $: 'source.id' }] },
                  },
                  children: [
                    {
                      type: 'Column',
                      props: { gap: '200', width: '100%' },
                      children: [
                        {
                          /*
                            `contain`, not `cover`: a still of a screen cropped to fill a box is a
                            still of the middle of somebody's desktop, which is the part least likely
                            to say which desktop it is. The letterboxing is the honest shape.
                          */
                          type: 'we-image',
                          props: {
                            src: { $: 'source.thumbnail' },
                            fit: 'contain',
                            width: '100%',
                            height: '124px',
                            r: 'media',
                            bg: 'surface-sunken',
                          },
                        },
                        {
                          type: 'we-text',
                          props: { variant: 'label', truncate: true, width: '100%', textAlign: 'left' },
                          children: [{ $: 'source.name' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'Row',
          props: { ax: 'end', width: '100%' },
          slot: 'footer',
          children: [{ type: 'we-button', props: { variant: 'secondary', onClick: cancel }, children: ['Cancel'] }],
        },
      ],
    },
  },
};
