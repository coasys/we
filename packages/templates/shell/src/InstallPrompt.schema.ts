import type { SchemaNode } from '@we/schema-shared';
import { confirmModal } from '@we/template-kit';

/**
 * InstallPrompt — what a template you are about to install will be able to do.
 *
 * ## Why installing asks at all
 *
 * `templateSurface.ts` sorts every store member into capability groups whose names are written for
 * a person to read — "Read and write the content of this space", "Change the name, look and
 * defaults of THIS space" — and says in its own docblock that these are what a marketplace listing
 * will show a human at install time. `inspectTemplateSurface` has returned exactly that list since
 * it was written; the one production caller took `blocked` off the result and dropped `groups`, so
 * the list existed and was shown nowhere. Installing a stranger's template was one unqualified
 * click.
 *
 * This is that list, at the moment it is worth something.
 *
 * ## What it is not
 *
 * Not a permission prompt. The tier is what actually bounds a template, and it is applied whatever
 * is answered here — declining installs nothing, accepting grants nothing extra. It is disclosure:
 * the reader gets to know what they are taking on before they take it on, which is the difference
 * between a trust boundary that holds and one nobody can see.
 *
 * ## Why it is chrome
 *
 * The same argument as `ConsentPrompt`. A dialog about whether to trust a template must not be
 * rendered *by* a template — the marketplace page is data like any other, and a dialog it drew
 * could say anything. Registered as host chrome, outside the keyed router, where a theme's CSS
 * cannot restyle it and a template cannot reach it.
 */
export const installPrompt: SchemaNode = confirmModal({
  open: { $: 'templateStore.pendingInstall' },
  // Dismissing is declining, which is the safe direction: nothing has been written yet, and the
  // button is still there.
  close: { $action: 'templateStore.cancelInstall' },
  title: { $: '`Install ${templateStore.pendingInstall.name}?`' },
  // Not `danger`: installing a template is an ordinary thing to want to do, and a red dialog on
  // every install teaches people to click through the one that mattered.
  tone: 'primary',
  icon: 'shield-check',
  body: {
    $: "templateStore.pendingInstall.destination == 'space' ? 'Every member of this space will get this template.' : 'This will be added to your own library.'",
  },
  children: [
    // What it asks for. A template that reads nothing has an empty list, and saying so plainly is
    // more useful than omitting the section and leaving the reader to wonder what was hidden.
    {
      type: 'Column',
      props: { gap: '200', bg: 'surface-sunken', r: '400', p: '400' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'label', color: 'text-muted' },
          children: ['This template will be able to:'],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'count(templateStore.pendingInstall.capabilities)' },
            then: {
              type: '$each',
              props: { items: { $: 'templateStore.pendingInstall.capabilities' }, as: 'capability' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'start' },
                  children: [
                    { type: 'we-icon', props: { name: 'check', color: 'accent-text' } },
                    { type: 'we-text', props: { flex: '1' }, children: [{ $: 'capability' }] },
                  ],
                },
              ],
            },
            else: {
              type: 'we-text',
              props: { color: 'text-muted' },
              children: ['Nothing — it only draws what is already on screen.'],
            },
          },
        },
      ],
    },
    /*
      What will not work, when there is any.

      A blocked reference is already inert, so this changes nothing about safety — it is the first
      moment anybody could learn that part of the template they are installing will silently do
      nothing. Naming the paths rather than counting them: "one reference is not allowed" says
      nothing about which button will be dead.
    */
    {
      type: '$if',
      props: {
        condition: { $: 'count(templateStore.pendingInstall.blocked)' },
        then: {
          type: 'we-alert',
          props: { variant: 'warning' },
          children: [
            {
              type: 'we-text',
              children: [
                {
                  $: "`Parts of this template ask for things it is not allowed to do here, and will not work: ${join(templateStore.pendingInstall.blocked, ', ')}`",
                },
              ],
            },
          ],
        },
      },
    },
  ],
  confirmLabel: 'Install',
  confirm: { $action: 'templateStore.confirmInstall' },
  cancelLabel: 'Cancel',
});
