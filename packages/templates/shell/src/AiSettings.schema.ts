import type { SchemaNode } from '@we/schema-shared';
import { expr } from '@we/schema-shared';
import { adminSection, discardGuard, emptyNote } from '@we/template-kit';

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
 * The launcher's live API check was left out while it would have meant a second implementation of
 * each provider's auth in the app. It is back as "List models", which asks the *node* to call the
 * endpoint (`runtimeStore.discoverAiModels`): the node already speaks every protocol it offers, and
 * a list of models is a better answer than "the key works" — it is the next field somebody fills in.
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
          value: { $: `runtimeStore.aiForm.${name}` },
          onInput: { $action: 'runtimeStore.setAiFormField', args: [name, { $: 'event.detail' }] },
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
      condition: expr`runtimeStore.aiForm.sourceKind == ${kind}`,
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
            checked: { $: 'runtimeStore.aiForm.useTokenizer' },
            size: 'sm',
            onChange: { $action: 'runtimeStore.setAiFormField', args: ['useTokenizer', { $: 'event.detail' }] },
          },
        },
        { type: 'we-text', props: { variant: 'label' }, children: ['Use a separate tokenizer'] },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'runtimeStore.aiForm.useTokenizer' },
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

/*
  The form holds a base URL and an API key somebody pasted in, neither of which is anywhere else —
  so a click on the backdrop used to throw away a credential. `aiFormDirty` compares against a
  snapshot taken when the form opened, so opening a model to look at its settings and closing again
  still asks nothing.
*/
const guard = discardGuard({
  dirty: { $: 'runtimeStore.aiFormDirty' },
  close: { $action: 'runtimeStore.closeAiForm' },
  title: 'Discard these settings?',
  body: 'The changes you have made to this model will be lost.',
});

const modelForm: SchemaNode = {
  type: 'we-modal',
  props: { size: 'md', close: guard.close },
  $localState: guard.localState,
  children: [
    {
      type: 'Column',
      props: { gap: '400', width: '100%' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'heading-md' },
          children: [{ $: "runtimeStore.aiForm.id ? 'Edit model' : 'Add a model'" }],
        },

        field('Name', 'name', 'What you will call it'),

        {
          type: 'we-form-field',
          props: { label: 'Used for' },
          children: [
            {
              type: 'we-select',
              props: {
                value: { $: 'runtimeStore.aiForm.kind' },
                options: [
                  { label: 'Language model', value: 'llm' },
                  { label: 'Embeddings', value: 'embedding' },
                  { label: 'Transcription', value: 'transcription' },
                ],
                onChange: { $action: 'runtimeStore.setAiFormField', args: ['kind', { $: 'event.detail' }] },
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
                value: { $: 'runtimeStore.aiForm.sourceKind' },
                options: [
                  { label: 'A model this node downloads', value: 'preset' },
                  { label: 'A remote API', value: 'api' },
                  { label: 'A Hugging Face repository', value: 'huggingface' },
                  { label: 'A file on this machine', value: 'file' },
                ],
                onChange: { $action: 'runtimeStore.setAiFormField', args: ['sourceKind', { $: 'event.detail' }] },
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
                  value: { $: 'runtimeStore.aiForm.presetName' },
                  placeholder: 'Choose a model',
                  searchable: true,
                  options: { $: 'runtimeStore.aiPresetOptions' },
                  onChange: { $action: 'runtimeStore.setAiFormField', args: ['presetName', { $: 'event.detail' }] },
                },
              },
            ],
          },
        ]),

        whenSource('api', [
          {
            type: 'we-form-field',
            props: { label: 'Service' },
            children: [
              {
                type: 'we-select',
                props: {
                  value: { $: 'runtimeStore.aiForm.apiService' },
                  options: { $: 'runtimeStore.aiServiceOptions' },
                  onChange: { $action: 'runtimeStore.setAiService', args: [{ $: 'event.detail' }] },
                },
              },
            ],
          },
          /*
            Protocol and URL only for an endpoint no service describes. They are two facts — OpenRouter
            serves Claude over the OpenAI protocol, a gateway speaks Anthropic's from its own address —
            but a named service settles both, and showing them beside it let the two disagree.
          */
          {
            type: '$if',
            props: {
              condition: { $: "runtimeStore.aiForm.apiService == 'custom'" },
              then: {
                type: 'Column',
                props: { gap: '300' },
                children: [
                  {
                    type: 'we-form-field',
                    props: {
                      label: 'Protocol',
                      // Most services speak OpenAI's format; Anthropic's own is what carries prompt caching and
                      // native tool calls for Claude, so it is worth choosing where it is on offer.
                      description: {
                        $: "runtimeStore.aiForm.apiProtocol == 'anthropic' ? 'Claude’s own API — prompt caching and native tool calls.' : 'The format OpenAI, OpenRouter, Groq, Gemini and local servers share.'",
                      },
                    },
                    children: [
                      {
                        type: 'we-select',
                        props: {
                          value: { $: 'runtimeStore.aiForm.apiProtocol' },
                          options: [
                            { label: 'OpenAI-compatible', value: 'openai' },
                            { label: 'Anthropic', value: 'anthropic' },
                          ],
                          onChange: {
                            $action: 'runtimeStore.setAiFormField',
                            args: ['apiProtocol', { $: 'event.detail' }],
                          },
                        },
                      },
                    ],
                  },
                  field('Base URL', 'apiBaseUrl', 'https://gateway.example.com/v1'),
                ],
              },
            },
          },
          // The key is stored by the backend and sent to the provider; masking it here only stops
          // it being read over a shoulder, which is the threat that applies to a settings page.
          field('API key', 'apiKey', 'sk-…', 'password'),
          {
            type: 'Row',
            props: { gap: '200', ay: 'end' },
            children: [
              {
                type: 'Column',
                props: { flex: '1', minWidth: '0' },
                children: [
                  {
                    type: '$if',
                    props: {
                      // A list once the endpoint has answered, a typed id until then — and always where
                      // the backend cannot ask, since a model id is still a thing a person can know.
                      condition: { $: 'count(runtimeStore.aiDiscoveredModelOptions)' },
                      then: {
                        type: 'we-form-field',
                        props: { label: 'Model' },
                        children: [
                          {
                            type: 'we-select',
                            props: {
                              value: { $: 'runtimeStore.aiForm.apiModel' },
                              searchable: true,
                              options: { $: 'runtimeStore.aiDiscoveredModelOptions' },
                              onChange: {
                                $action: 'runtimeStore.setAiFormField',
                                args: ['apiModel', { $: 'event.detail' }],
                              },
                            },
                          },
                        ],
                      },
                      else: field('Model', 'apiModel', 'e.g. claude-sonnet-5 or gpt-4o'),
                    },
                  },
                ],
              },
              {
                type: '$if',
                props: {
                  condition: { $: 'runtimeStore.canDiscoverAiModels' },
                  then: {
                    type: 'we-tooltip',
                    props: { content: 'Ask the service which models it serves — which also checks the key' },
                    children: [
                      {
                        type: 'we-button',
                        props: {
                          text: 'List models',
                          variant: 'secondary',
                          loading: { $: "'discoverAiModels' in runtimeStore.pending" },
                          disabled: { $: '!runtimeStore.aiForm.apiBaseUrl' },
                          onClick: { $action: 'runtimeStore.discoverAiModels' },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
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
          // The page's own error slot sits behind this modal, so a refused save or a failed model
          // listing would otherwise say nothing where the person is looking.
          type: '$if',
          props: {
            condition: { $: 'runtimeStore.error && !count(runtimeStore.pending)' },
            then: { type: 'we-alert', props: { variant: 'danger' }, children: [{ $: 'runtimeStore.error' }] },
          },
        },

        {
          type: 'Row',
          props: { gap: '200', ax: 'end' },
          children: [
            {
              type: 'we-button',
              // Guarded like the backdrop — one way out of the modal.
              props: { text: 'Cancel', variant: 'secondary', onClick: guard.close },
            },
            {
              type: 'we-button',
              props: {
                text: 'Save',
                loading: { $: "'saveAiModel' in runtimeStore.pending" },
                disabled: { $: '!runtimeStore.aiFormComplete' },
                onClick: { $action: 'runtimeStore.saveAiModel' },
              },
            },
          ],
        },
      ],
    },
    guard.node,
  ],
};

const modelCard: SchemaNode = {
  type: 'Column',
  props: { gap: '200', bg: 'surface', r: '300', px: '300', py: '300' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: [{ $: 'model.name' }] },
            {
              type: '$if',
              props: {
                condition: { $: 'model.isDefault' },
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
                condition: { $: 'runtimeStore.canConfigureAi' },
                then: {
                  type: 'Row',
                  props: { gap: '200', ay: 'center' },
                  children: [
                    // Only offered for a model that is not already the one apps get for its kind —
                    // and, for now, only for language models. AD4M saves a default for an LLM and
                    // silently drops one for any other kind, so on a transcription or embedding
                    // model the button reported success and changed nothing. Widen the condition
                    // back to `!model.isDefault` once the executor persists every kind.
                    {
                      type: '$if',
                      props: {
                        condition: { $: "!model.isDefault && model.kind == 'llm'" },
                        then: {
                          type: 'we-button',
                          props: {
                            text: 'Make default',
                            variant: 'ghost',
                            size: 'sm',
                            onClick: { $action: 'runtimeStore.setDefaultAiModel', args: [{ $: 'model.id' }] },
                          },
                        },
                      },
                    },
                    {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: { $action: 'runtimeStore.editAiModel', args: [{ $: 'model.id' }] },
                      },
                      children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
                    },
                    {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: { $action: 'runtimeStore.removeAiModel', args: [{ $: 'model.id' }] },
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
        { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [{ $: 'model.kindLabel' }] },
        { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: ['·'] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: [{ $: 'model.sourceLabel' }],
        },
        { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: ['·'] },
        { type: 'we-text', props: { variant: 'footnote' }, children: [{ $: 'model.detail' }] },
      ],
    },
    // Only models this node hosts have anything to report; a remote one is ready or it is not.
    {
      type: '$if',
      props: {
        condition: { $: 'model.statusText' },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: [{ $: 'model.statusText' }],
        },
      },
    },
  ],
};

const taskCard: SchemaNode = {
  type: 'Column',
  props: { gap: '100', bg: 'surface', r: '300', px: '300', py: '200' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: [{ $: 'task.name' }] },
        {
          type: '$if',
          props: {
            condition: { $: 'runtimeStore.canConfigureAi' },
            then: {
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'sm',
                onClick: { $action: 'runtimeStore.removeAiTask', args: [{ $: 'task.id' }] },
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
          props: { variant: 'footnote', color: 'text-muted', whiteSpace: 'pre-wrap' },
          children: [{ $: 'task.systemPrompt' }],
        },
      ],
    },
  ],
};

export const aiSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'runtimeStore.canManageAi' },
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
                condition: { $: 'count(runtimeStore.aiModels)' },
                then: {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    {
                      type: '$each',
                      props: { items: { $: 'runtimeStore.aiModels' }, as: 'model' },
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
                condition: { $: 'runtimeStore.canConfigureAi' },
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
                condition: { $: 'count(runtimeStore.aiTasks)' },
                then: {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    {
                      type: '$each',
                      props: { items: { $: 'runtimeStore.aiTasks' }, as: 'task' },
                      children: [taskCard],
                    },
                  ],
                },
                else: emptyNote('No app has registered a prompt yet.'),
              },
            },
          ],
        }),

        { type: '$if', props: { condition: { $: 'runtimeStore.aiForm' }, then: modelForm } },
      ],
    },
  },
};
