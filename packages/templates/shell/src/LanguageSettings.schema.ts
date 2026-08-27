import type { SchemaNode } from '@we/schema-shared';
import { adminSection, emptyNote } from '@we/template-kit';

/**
 * Languages — the plugins the backend uses to store and retrieve expressions.
 *
 * The last of the launcher's own screens: a list of what is installed, and a field to install more
 * by content address. Publishing a language is deliberately absent — `languages.publish` takes a
 * path to a bundle on the executor's filesystem, which a file picker in a browser context cannot
 * produce (the launcher asked the user to type one, and wired the button to its install handler).
 *
 * System languages are shown but not removable. They are the node's own machinery — removing one
 * does not uninstall a feature, it breaks the running agent — so the row simply has no button
 * rather than a disabled one, and the backend refuses the call regardless of what the UI offers.
 */

const languageRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', ax: 'between', bg: 'surface-sunken', r: '300', px: '300', py: '200' },
  children: [
    {
      type: 'Column',
      props: { gap: '100', flex: '1' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['$language.name'] },
            {
              type: '$if',
              props: {
                condition: '$language.system',
                then: { type: 'we-badge', props: { variant: 'neutral', size: 'xs' }, children: ['System'] },
              },
            },
          ],
        },
        // The address is the only handle a user has on a language — it is what they paste to
        // install the same one elsewhere — so it is shown in full and selectable, not truncated.
        {
          type: 'we-code',
          props: { block: true },
          children: ['$language.address'],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $not: '$language.system' },
        then: {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            onClick: { $action: 'runtimeStore.removeLanguage', args: ['$language.address'] },
          },
          children: [{ type: 'we-icon', props: { name: 'trash' } }],
        },
      },
    },
  ],
};

export const languagesSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'runtimeStore.canManageLanguages' },
    then: adminSection({
      title: 'Languages',
      icon: 'code',
      refresh: 'runtimeStore.loadLanguages',
      children: [
        {
          type: '$if',
          props: {
            condition: { $count: { items: { $store: 'runtimeStore.languages' } } },
            then: {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: '$each',
                  props: { items: { $store: 'runtimeStore.languages' }, as: 'language' },
                  children: [languageRow],
                },
              ],
            },
            else: emptyNote('No languages are installed.'),
          },
        },
        {
          type: 'Row',
          props: { gap: '200' },
          children: [
            {
              type: 'we-input',
              props: {
                flex: '1',
                size: 'sm',
                placeholder: 'Language address, e.g. QmUTkvPcyaUGntqfzi3iR1xomADm5yYC2j8hcPdhMHpTem',
                value: { $local: 'newLanguageAddress' },
                onInput: { $setLocal: 'newLanguageAddress', from: '$event.detail' },
              },
            },
            {
              type: 'we-button',
              props: {
                text: 'Install',
                size: 'sm',
                variant: 'secondary',
                // The backend fetches the bundle over the network, so this is the one runtime action
                // that can take long enough to need a spinner rather than just finishing.
                loading: { $store: 'runtimeStore.loading' },
                disabled: { $not: { $local: 'newLanguageAddress' } },
                onClick: {
                  $action: 'runtimeStore.installLanguage',
                  args: [{ $local: 'newLanguageAddress' }],
                  onSuccess: [{ $setLocal: 'newLanguageAddress', value: '' }],
                },
              },
            },
          ],
        },
      ],
    }),
  },
};

/** Declared by the page that renders the section — `$localState` is scoped to its declaring node. */
export const languagesLocalState = {
  newLanguageAddress: { type: 'string', initial: '' },
} as const;
