import type { SchemaNode } from '@we/schema-shared';

/**
 * SafeModeBanner — says the app is in safe mode, why, and how to leave.
 *
 * Safe mode draws WE's own templates and themes in place of the chosen ones (see `safeMode.ts` in
 * the app shell). Without a word on screen that would read as everything somebody set up having
 * vanished, so this says what happened and that nothing was lost — and, for the automatic case,
 * which template did not finish loading, since that is the one to change before leaving.
 *
 * Chrome, at the bottom of the window and above the content, because it describes the whole app
 * rather than one space.
 */
export const safeModeBanner: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'templateStore.safeMode.on' },
    then: {
      type: 'Row',
      props: {
        position: 'fixed',
        bottom: '400',
        left: '50%',
        // Half its own width back, which is what a percentage translate is measured against.
        x: '-50%',
        zIndex: 'toast',
        maxWidth: 'calc(100vw - 32px)',
        gap: '300',
        ay: 'center',
        py: '200',
        pl: '400',
        pr: '200',
        bg: 'surface-raised',
        border: '1px solid border',
        r: 'pill',
        shadow: 'lg',
      },
      children: [
        { type: 'we-icon', props: { name: 'shield-check', color: 'accent-text' } },
        {
          type: '$if',
          props: {
            condition: { $: "templateStore.safeMode.reason == 'unfinished-render'" },
            then: {
              type: 'we-text',
              props: { color: 'text' },
              children: [
                'Safe mode: “',
                { $: 'templateStore.safeMode.template' },
                '” did not finish loading last time, so WE’s own templates and themes are in use.',
              ],
            },
            else: {
              type: 'we-text',
              props: { color: 'text' },
              children: ['Safe mode: WE’s own templates and themes are in use. Yours are unchanged.'],
            },
          },
        },
        {
          type: 'we-button',
          props: { variant: 'secondary', size: 'sm', onClick: { $action: 'templateStore.leaveSafeMode' } },
          children: ['Leave safe mode'],
        },
      ],
    },
  },
};
