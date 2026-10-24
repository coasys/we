import type { SchemaNode } from '@we/schema-shared';

/**
 * SafeModeBanner — says the app is in safe mode, why, and how to leave.
 *
 * Safe mode draws WE's own templates and themes in place of the chosen ones (see `safeMode.ts` in
 * the app shell). Without a word on screen that would read as everything somebody set up having
 * vanished, so this says what happened and that nothing was lost — and, for the automatic case,
 * which template did not finish loading, since that is the one to change before leaving.
 *
 * With more than one app to be in, it also offers which to leave into. Leaving goes back to the app
 * the agent chose, and an app can be what is wrong — one that hides every way out of it, or one that
 * does not finish loading — so leaving into it again would only reopen the problem.
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
      // Empty is the app the agent chose, which is where leaving goes unless another is picked.
      $localState: { leaveInto: { type: 'string', initial: '' } },
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
          type: '$if',
          props: {
            condition: { $: 'count(templateStore.appTemplateOptions) > 1' },
            then: {
              type: 'we-select',
              props: {
                size: 'sm',
                flexShrink: '0',
                label: 'App to leave into',
                placeholder: 'The app you chose',
                options: { $: 'templateStore.appTemplateOptions' },
                value: { $: 'local.leaveInto' },
                onChange: { $setLocal: 'leaveInto', value: { $: 'event.detail' } },
              },
            },
          },
        },
        {
          type: 'we-button',
          props: {
            variant: 'soft',
            size: 'sm',
            flexShrink: '0',
            onClick: {
              $if: {
                condition: { $: 'local.leaveInto' },
                then: { $action: 'templateStore.leaveSafeModeInto', args: [{ $: 'local.leaveInto' }] },
                else: { $action: 'templateStore.leaveSafeMode' },
              },
            },
          },
          children: ['Leave safe mode'],
        },
      ],
    },
  },
};
