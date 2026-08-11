import type { SchemaNode } from '@we/schema-shared';
import { adminSection, emptyNote } from '@we/template-kit';

/**
 * AI — the models the backend runs or calls, and the prompts apps have registered against them.
 *
 * The launcher's AI screen. Models are the backend's, not any one app's: whatever asks for a
 * language model gets whichever is default here, so on a host that bundles the executor this was
 * both the only place to configure one and unreachable.
 *
 * The form lives in `runtimeStore.aiForm` rather than in `$localState`. Its fields depend on each
 * other — the kind decides which presets exist, the source decides which fields are even asked —
 * and a schema can express that only as nested conditionals over state it cannot compute from.
 * With the form in the store, each input reads one field and writes one field.
 *
 * Not ported: the launcher's live API check, which calls the provider's /models and /chat endpoints
 * to validate a key before saving. It is a genuinely nice touch and a second implementation of the
 * provider's own auth, and what it saves the user is one failed generation.
 */

/** Every input in the form is this: read one field, write one field. */
function field(label: string, name: string, placeholder = '', type = 'text'): SchemaNode {
  return {
    type: 'we-form-field',
    props: { label },
    children: [
      {
        type: 'we-input',
        props: {
          type,
          placeholder,
          value: { $store: `runtimeStore.aiForm.${name}` },
          onInput: { $action: 'runtimeStore.setAiFormField', args: [name, '$event.detail'] },
        },
      },
    ],
  };
}

/** Shown only when the form's source is `kind`. */
function whenSource(kind: string, children: SchemaNode[]): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $eq: [{ $store: 'runtimeStore.aiForm.sourceKind' }, kind] },
      then: { type: 'Column', props: { gap: '300' }, children },
    },
  };
}

const tokenizerFields: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        {
          type: 'we-switch',
          props: {
            checked: { $store: 'runtimeStore.aiForm.useTokenizer' },
            size: 'sm',
            onChange: { $action: 'runtimeStore.setAiFormField', args: ['useTokenizer', '$event.detail'] },
          },
        },
        { type: 'we-text', props: { variant: 'label' }, children: ['Use a separate tokenizer'] },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $store: 'runtimeStore.aiForm.useTokenizer' },
        then: {
          type: 'Column',
          props: { gap: '300' },
          children: [
            field('Tokenizer repository', 'tokenizerRepo', 'e.g. mistralai/Mistral-7B-v0.1'),
            field('Tokenizer revision', 'tokenizerRevision'),
            field('Tokenizer file', 'tokenizerFileName', 'e.g. tokenizer.json'),
          ],
        },
      },
    },
  ],
};

const modelForm: SchemaNode = {
  type: 'we-modal',
  props: { close: { $action: 'runtimeStore.closeAiForm' }, maxWidth: '560px', width: '100%' },
  children: [
    {
      type: 'Column',
      props: { gap: '400', width: '100%' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'heading-md' },
          children: [
            {
              $if: { condition: { $store: 'runtimeStore.aiForm.id' }, then: 'Edit model', else: 'Add a model' },
            },
          ],
        },

        field('Name', 'name', 'What you will call it'),

        {
          type: 'we-form-field',
          props: { label: 'Used for' },
          children: [
            {
              type: 'we-select',
              props: {
                value: { $store: 'runtimeStore.aiForm.kind' },
                options: [
                  { label: 'Language model', value: 'llm' },
                  { label: 'Embeddings', value: 'embedding' },
                  { label: 'Transcription', value: 'transcription' },
                ],
                onChange: { $action: 'runtimeStore.setAiFormField', args: ['kind', '$event.detail'] },
              },
            },
          ],
        },

        {
          type: 'we-form-field',
          props: { label: 'Where it runs' },
          children: [
            {
              type: 'we-select',
              props: {
                value: { $store: 'runtimeStore.aiForm.sourceKind' },
                options: [
                  { label: 'A model this node downloads', value: 'preset' },
                  { label: 'A remote API', value: 'api' },
                  { label: 'A Hugging Face repository', value: 'huggingface' },
                  { label: 'A file on this machine', value: 'file' },
                ],
                onChange: { $action: 'runtimeStore.setAiFormField', args: ['sourceKind', '$event.detail'] },
              },
            },
          ],
        },

        whenSource('preset', [
          {
            type: 'we-form-field',
            props: { label: 'Model' },
            children: [
              {
                type: 'we-select',
                props: {
                  value: { $store: 'runtimeStore.aiForm.presetName' },
                  placeholder: 'Choose a model',
                  searchable: true,
                  options: { $store: 'runtimeStore.aiPresetOptions' },
                  onChange: { $action: 'runtimeStore.setAiFormField', args: ['presetName', '$event.detail'] },
                },
              },
            ],
          },
        ]),

        whenSource('api', [
          field('Base URL', 'apiBaseUrl', 'https://api.openai.com/v1'),
          // The key is stored by the backend and sent to the provider; masking it here only stops
          // it being read over a shoulder, which is the threat that applies to a settings page.
          field('API key', 'apiKey', 'sk-…', 'password'),
          field('Model', 'apiModel', 'e.g. gpt-4o'),
        ]),

        whenSource('huggingface', [
          field('Repository', 'hfRepo', 'e.g. TheBloke/Mistral-7B-Instruct-v0.2-GGUF'),
          field('Revision', 'hfRevision'),
          field('File', 'hfFileName', 'e.g. mistral-7b-instruct-v0.2.Q4_K_M.gguf'),
          tokenizerFields,
        ]),

        whenSource('file', [
          // A path on the machine running the backend, which is not necessarily this one — hence a
          // typed path rather than a file picker, whose File carries no path to hand over.
          field('File path', 'filePath', '/path/to/model.gguf'),
          tokenizerFields,
        ]),

        {
          type: 'Row',
          props: { gap: '200', ax: 'end' },
          children: [
            {
              type: 'we-button',
              props: { text: 'Cancel', variant: 'ghost', onClick: { $action: 'runtimeStore.closeAiForm' } },
            },
            {
              type: 'we-button',
              props: {
                text: 'Save',
                loading: { $store: 'runtimeStore.loading' },
                disabled: { $not: { $store: 'runtimeStore.aiFormComplete' } },
                onClick: { $action: 'runtimeStore.saveAiModel' },
              },
            },
          ],
        },
      ],
    },
  ],
};

const modelCard: SchemaNode = {
  type: 'Column',
  props: { gap: '200', bg: 'neutral-100', r: '300', px: '300', py: '300' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['$model.name'] },
            {
              type: '$if',
              props: {
                condition: '$model.isDefault',
                then: { type: 'we-badge', props: { variant: 'primary', size: 'xs' }, children: ['Default'] },
              },
            },
          ],
        },
        {
          type: 'Row',
          props: { gap: '200' },
          children: [
            // Changing the models is the node operator's, listing them is not. A guest on somebody
            // else's node reads this page; these three would return a capability error.
            {
              type: '$if',
              props: {
                condition: { $store: 'runtimeStore.canConfigureAi' },
                then: {
                  type: 'Row',
                  props: { gap: '200', ay: 'center' },
                  children: [
                    // Only offered for a model that is not already the one apps get for its kind.
                    {
                      type: '$if',
                      props: {
                        condition: { $not: '$model.isDefault' },
                        then: {
                          type: 'we-button',
                          props: {
                            text: 'Make default',
                            variant: 'ghost',
                            size: 'sm',
                            onClick: { $action: 'runtimeStore.setDefaultAiModel', args: ['$model.id'] },
                          },
                        },
                      },
                    },
                    {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: { $action: 'runtimeStore.editAiModel', args: ['$model.id'] },
                      },
                      children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
                    },
                    {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: { $action: 'runtimeStore.removeAiModel', args: ['$model.id'] },
                      },
                      children: [{ type: 'we-icon', props: { name: 'trash' } }],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', wrap: true },
      children: [
        { type: 'we-text', props: { variant: 'footnote', color: 'neutral-500' }, children: ['$model.kindLabel'] },
        { type: 'we-text', props: { variant: 'footnote', color: 'neutral-500' }, children: ['·'] },
        { type: 'we-text', props: { variant: 'footnote', color: 'neutral-500' }, children: ['$model.sourceLabel'] },
        { type: 'we-text', props: { variant: 'footnote', color: 'neutral-500' }, children: ['·'] },
        { type: 'we-text', props: { variant: 'footnote' }, children: ['$model.detail'] },
      ],
    },
    // Only models this node hosts have anything to report; a remote one is ready or it is not.
    {
      type: '$if',
      props: {
        condition: '$model.statusText',
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'neutral-500' },
          children: ['$model.statusText'],
        },
      },
    },
  ],
};

const taskCard: SchemaNode = {
  type: 'Column',
  props: { gap: '100', bg: 'neutral-100', r: '300', px: '300', py: '200' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ['$task.name'] },
        {
          type: '$if',
          props: {
            condition: { $store: 'runtimeStore.canConfigureAi' },
            then: {
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'sm',
                onClick: { $action: 'runtimeStore.removeAiTask', args: ['$task.id'] },
              },
              children: [{ type: 'we-icon', props: { name: 'trash' } }],
            },
          },
        },
      ],
    },
    // Prompts run to hundreds of lines. Scrolling one in place beats either truncating it — the
    // interesting part is rarely the first line — or letting one task push the rest off the page.
    {
      type: 'we-scroll-area',
      props: { maxHeight: '120px' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'neutral-500', styles: { 'white-space': 'pre-wrap' } },
          children: ['$task.systemPrompt'],
        },
      ],
    },
  ],
};

export const aiSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'runtimeStore.canManageAi' },
    then: {
      type: 'Column',
      props: { gap: '600' },
      children: [
        adminSection({
          title: 'Models',
          icon: 'sparkle',
          refresh: 'runtimeStore.loadAiModels',
          children: [
            {
              type: '$if',
              props: {
                condition: { $count: { items: { $store: 'runtimeStore.aiModels' } } },
                then: {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    {
                      type: '$each',
                      props: { items: { $store: 'runtimeStore.aiModels' }, as: 'model' },
                      children: [modelCard],
                    },
                  ],
                },
                else: emptyNote('No models are configured. Apps asking for one will have nothing to use.'),
              },
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'runtimeStore.canConfigureAi' },
                then: {
                  type: 'Row',
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        text: 'Add a model',
                        size: 'sm',
                        variant: 'secondary',
                        onClick: { $action: 'runtimeStore.newAiModel' },
                      },
                      children: [{ type: 'we-icon', props: { name: 'plus' } }],
                    },
                  ],
                },
              },
            },
          ],
        }),

        adminSection({
          title: 'Tasks',
          icon: 'list-checks',
          refresh: 'runtimeStore.loadAiTasks',
          children: [
            {
              type: '$if',
              props: {
                condition: { $count: { items: { $store: 'runtimeStore.aiTasks' } } },
                then: {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    {
                      type: '$each',
                      props: { items: { $store: 'runtimeStore.aiTasks' }, as: 'task' },
                      children: [taskCard],
                    },
                  ],
                },
                else: emptyNote('No app has registered a prompt yet.'),
              },
            },
          ],
        }),

        { type: '$if', props: { condition: { $store: 'runtimeStore.aiForm' }, then: modelForm } },
      ],
    },
  },
};
