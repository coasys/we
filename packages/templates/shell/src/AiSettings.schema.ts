import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { adminSection, discardGuard, emptyNote } from '@we/template-kit';

/**
 * AI — the model servers the backend uses, the models on them, and the prompts apps have registered
 * against those models.
 *
 * The launcher's AI screen. Models are the backend's, not any one app's: whatever asks for a
 * language model gets whichever is default here, so on a host that bundles the executor this was
 * both the only place to configure one and unreachable.
 *
 * A model is a reference to a model a **server** serves (an Ollama, a llama-server, a speech server,
 * OpenAI, Anthropic). So the page has two lists and two forms: the servers, with their addresses,
 * keys and health; and the models, each naming its server and the id the server knows it by. The
 * backend runs no model itself, so a node with no server has no AI — which is why servers found on
 * the node's own machine are offered first, and where to get one is said when there are none.
 *
 * Both forms live in `runtimeStore` rather than in `$localState`: their fields depend on each other
 * (the kind of model decides which servers fit, the server decides which models are listed), and a
 * schema can express that only as nested conditionals over state it cannot compute from. With the
 * form in the store, each input reads one field and writes one field.
 */

/** A footnote line. `color` is a role, or an expression choosing one. */
const footnote = (
  text: NonNullable<SchemaNode['children']>[number],
  color: string | { $: string } = 'text-muted',
): SchemaNode => ({
  type: 'we-text',
  props: { variant: 'footnote', color },
  children: [text],
});

/** An endpoint-form input: read one field, write one field. */
function endpointField(label: string, name: string, placeholder = ''): SchemaNode {
  return {
    type: 'we-form-field',
    props: { label },
    children: [
      {
        type: 'we-input',
        props: {
          placeholder,
          value: { $: `runtimeStore.aiEndpointForm.${name}` },
          onInput: { $invoke: 'runtimeStore.setAiEndpointField', args: [name, { $: 'event.detail' }] },
        },
      },
    ],
  };
}

/** The cancel and save row every form ends with, plus the error the page's own slot would hide. */
function formFooter(close: SchemaProp, save: string, complete: string): SchemaNode[] {
  return [
    {
      // The page's own error slot sits behind the modal, so a refused save or a failed model
      // listing would otherwise say nothing where the person is looking.
      type: '$if',
      props: {
        condition: { $: 'runtimeStore.error && !count(runtimeStore.pending)' },
        then: { type: 'we-alert', props: { tone: 'danger' }, children: [{ $: 'runtimeStore.error' }] },
      },
    },
    {
      type: 'Row',
      props: { gap: '200', ax: 'end' },
      children: [
        // Guarded like the backdrop — one way out of the modal.
        { type: 'we-button', props: { text: 'Cancel', variant: 'soft', onClick: close } },
        {
          type: 'we-button',
          props: {
            text: 'Save',
            loading: { $: `'${save}' in runtimeStore.pending` },
            disabled: { $: `!runtimeStore.${complete}` },
            onClick: { $invoke: `runtimeStore.${save}` },
          },
        },
      ],
    },
  ];
}

/**
 * The API key: typed to send, never shown back.
 *
 * The backend holds the key and answers only whether one is set, so the field is empty whenever the
 * form opens, and empty means "keep the one that is set". Removing it is a choice of its own rather
 * than clearing the field, which would otherwise be indistinguishable from not touching it. Masked,
 * which only stops it being read over a shoulder — the threat that applies to a settings page.
 */
const apiKeyField: SchemaNode = {
  type: 'we-form-field',
  props: {
    label: 'API key',
    error: { $: 'runtimeStore.aiApiKeyError' },
    description: {
      $: "!runtimeStore.aiEndpointForm.apiKeyStored ? 'Only a hosted service or a server started with one needs a key.' : runtimeStore.aiEndpointForm.apiKey ? 'Replaces the key that is set when you save.' : runtimeStore.aiEndpointForm.apiKeyRemoved ? 'The key that is set is removed when you save.' : 'A key is set. The node keeps it and never shows it — type a new one to replace it.'",
    },
  },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        {
          type: 'we-input',
          props: {
            flex: '1',
            minWidth: '0',
            type: 'password',
            placeholder: {
              $: "runtimeStore.aiEndpointForm.apiKeyStored ? 'Leave empty to keep the key that is set' : 'None'",
            },
            value: { $: 'runtimeStore.aiEndpointForm.apiKey' },
            onInput: { $invoke: 'runtimeStore.setAiEndpointField', args: ['apiKey', { $: 'event.detail' }] },
          },
        },
        {
          type: '$if',
          props: {
            condition: { $: 'runtimeStore.aiEndpointForm.apiKeyStored && !runtimeStore.aiEndpointForm.apiKey' },
            then: {
              type: 'we-button',
              props: {
                variant: 'ghost',
                text: { $: "runtimeStore.aiEndpointForm.apiKeyRemoved ? 'Keep key' : 'Remove key'" },
                onClick: {
                  $invoke: 'runtimeStore.setAiEndpointField',
                  args: ['apiKeyRemoved', { $: '!runtimeStore.aiEndpointForm.apiKeyRemoved' }],
                },
              },
            },
          },
        },
      ],
    },
  ],
};

/*
  The endpoint form holds an address and a key somebody pasted in, neither of which is anywhere
  else — so a click on the backdrop must not throw away a credential. Compared against a snapshot
  taken when the form opened, so opening a server to look at it and closing again asks nothing.
*/
const endpointGuard = discardGuard({
  dirty: { $: 'runtimeStore.aiEndpointFormDirty' },
  close: { $invoke: 'runtimeStore.closeAiEndpointForm' },
  title: 'Discard these settings?',
  body: 'The changes you have made to this server will be lost.',
});

const endpointForm: SchemaNode = {
  type: 'we-modal',
  props: { size: 'md', close: endpointGuard.close },
  $localState: endpointGuard.localState,
  children: [
    {
      type: 'Column',
      props: { gap: '400', width: '100%' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'heading-md' },
          children: [{ $: "runtimeStore.aiEndpointForm.id ? 'Edit model server' : 'Add a model server'" }],
        },
        {
          type: 'we-form-field',
          props: { label: 'Server' },
          children: [
            {
              type: 'we-select',
              props: {
                value: { $: 'runtimeStore.aiEndpointForm.service' },
                options: { $: 'runtimeStore.aiServiceOptions' },
                onChange: { $invoke: 'runtimeStore.setAiService', args: [{ $: 'event.detail' }] },
              },
            },
          ],
        },
        // Editable whatever the service: a local server is as often on another port as on its default.
        endpointField('Address', 'baseUrl', 'http://127.0.0.1:8080'),
        apiKeyField,
        /*
          Only Ollama reads it. Empty by default, because the right number depends on the machine
          running the model rather than on the model, and an empty field leaves the server's own
          default in place.
        */
        {
          type: '$if',
          props: {
            condition: { $: "runtimeStore.aiEndpointForm.kind == 'ollama'" },
            then: {
              type: 'we-form-field',
              props: {
                label: 'Context limit',
                error: { $: 'runtimeStore.aiMaxContextError' },
                description:
                  'The most tokens of context to load a model with — a limit, not a request. Ollama reserves memory for the whole window up front, so a model advertising a long one can spill off a small graphics card onto the CPU and answer several times slower. Leave empty for the default.',
              },
              children: [
                {
                  type: 'we-input',
                  props: {
                    type: 'number',
                    min: '1',
                    step: '1024',
                    placeholder: 'e.g. 32768',
                    value: { $: 'runtimeStore.aiEndpointForm.maxContext' },
                    onInput: {
                      $invoke: 'runtimeStore.setAiEndpointField',
                      args: ['maxContext', { $: 'event.detail' }],
                    },
                  },
                },
              ],
            },
          },
        },
        endpointField('Name', 'name', 'Named after the server when left empty'),
        ...formFooter(endpointGuard.close, 'saveAiEndpoint', 'aiEndpointFormComplete'),
      ],
    },
    endpointGuard.node,
  ],
};

const modelGuard = discardGuard({
  dirty: { $: 'runtimeStore.aiFormDirty' },
  close: { $invoke: 'runtimeStore.closeAiForm' },
  title: 'Discard these settings?',
  body: 'The changes you have made to this model will be lost.',
});

const modelForm: SchemaNode = {
  type: 'we-modal',
  props: { size: 'md', close: modelGuard.close },
  $localState: modelGuard.localState,
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
                  { label: 'Speech', value: 'speech' },
                ],
                onChange: { $invoke: 'runtimeStore.setAiFormField', args: ['kind', { $: 'event.detail' }] },
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          props: {
            label: 'Server',
            description: {
              $: "count(runtimeStore.aiEndpointOptions) ? '' : 'No added server can serve this. Add one under Model servers first.'",
            },
          },
          children: [
            {
              type: 'we-select',
              props: {
                value: { $: 'runtimeStore.aiForm.endpointId' },
                placeholder: 'Choose a server',
                options: { $: 'runtimeStore.aiEndpointOptions' },
                disabled: { $: '!count(runtimeStore.aiEndpointOptions)' },
                onChange: { $invoke: 'runtimeStore.setAiFormField', args: ['endpointId', { $: 'event.detail' }] },
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          props: {
            label: 'Model',
            // What the server knows the model by. Listed once the server has answered, and typed
            // where it has not — a model an Ollama does not have yet can be named and downloaded.
            description: {
              $: "runtimeStore.aiRecommendedModel ? `Recommended: ${runtimeStore.aiRecommendedModel}` : ''",
            },
          },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                {
                  type: 'Combobox',
                  props: {
                    flex: '1',
                    minWidth: '0',
                    value: { $: 'runtimeStore.aiForm.remoteModel' },
                    placeholder: 'e.g. qwen3:8b',
                    options: { $: 'runtimeStore.aiDiscoveredModelOptions' },
                    onChange: { $invoke: 'runtimeStore.setAiFormField', args: ['remoteModel', { $: 'arg' }] },
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'runtimeStore.canDiscoverAiModels && runtimeStore.aiForm.endpointId' },
                    then: {
                      type: 'we-tooltip',
                      props: { content: 'Ask the server again which models it has' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            variant: 'ghost',
                            loading: { $: "'discoverAiModels' in runtimeStore.pending" },
                            onClick: { $invoke: 'runtimeStore.discoverAiModels' },
                          },
                          children: [{ type: 'we-icon', props: { name: 'arrows-clockwise' } }],
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
        /*
          A model the server does not have yet, on a server that can fetch its own. The download is
          the server's, so it is offered here rather than as a way of adding the model: saving one
          the server does not have works too, and its status says so.
        */
        {
          type: '$if',
          props: {
            condition: { $: 'runtimeStore.aiPullText' },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [{ type: 'we-spinner', props: { size: 'sm' } }, footnote({ $: 'runtimeStore.aiPullText' })],
            },
            else: {
              type: '$if',
              props: {
                condition: { $: 'runtimeStore.aiCanPull' },
                then: {
                  type: 'Row',
                  props: { gap: '300', ay: 'center', wrap: true },
                  children: [
                    footnote('The server does not have this model yet.'),
                    {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'soft',
                        text: 'Download it to the server',
                        onClick: { $invoke: 'runtimeStore.pullAiModel' },
                      },
                      children: [{ type: 'we-icon', props: { name: 'download-simple' } }],
                    },
                  ],
                },
              },
            },
          },
        },
        {
          type: 'we-form-field',
          props: { label: 'Name' },
          children: [
            {
              type: 'we-input',
              props: {
                placeholder: 'The model’s id when left empty',
                value: { $: 'runtimeStore.aiForm.name' },
                onInput: { $invoke: 'runtimeStore.setAiFormField', args: ['name', { $: 'event.detail' }] },
              },
            },
          ],
        },
        ...formFooter(modelGuard.close, 'saveAiModel', 'aiFormComplete'),
      ],
    },
    modelGuard.node,
  ],
};

/** Edit and remove, for whoever may change the node's AI. */
function rowActions(edit: string, remove: string, id: string): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $: 'runtimeStore.canConfigureAi' },
      then: {
        type: 'Row',
        props: { gap: '200', ay: 'center' },
        children: [
          {
            type: 'we-button',
            props: { variant: 'ghost', size: 'sm', onClick: { $invoke: edit, args: [{ $: id }] } },
            children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
          },
          {
            type: 'we-button',
            props: { variant: 'ghost', size: 'sm', onClick: { $invoke: remove, args: [{ $: id }] } },
            children: [{ type: 'we-icon', props: { name: 'trash' } }],
          },
        ],
      },
    },
  };
}

const endpointCard: SchemaNode = {
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
            { type: 'we-text', props: { variant: 'label' }, children: [{ $: 'endpoint.name' }] },
            { type: 'we-badge', props: { size: 'xs' }, children: [{ $: 'endpoint.kindLabel' }] },
          ],
        },
        rowActions('runtimeStore.editAiEndpoint', 'runtimeStore.removeAiEndpoint', 'endpoint.id'),
      ],
    },
    footnote({ $: 'endpoint.baseUrl' }),
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', wrap: true },
      children: [
        {
          type: 'we-icon',
          props: {
            name: { $: "endpoint.healthy ? 'check-circle' : 'warning'" },
            size: 'sm',
            color: { $: "endpoint.healthy ? 'success-text' : 'warning-text'" },
          },
        },
        footnote({ $: 'endpoint.healthText' }, { $: "endpoint.healthy ? 'text-muted' : 'warning-text'" }),
        {
          type: '$if',
          props: {
            condition: { $: 'endpoint.modelCount' },
            then: footnote({
              $: "`· ${endpoint.modelCount} ${plural(endpoint.modelCount, 'model', 'models')} use it`",
            }),
          },
        },
      ],
    },
  ],
};

const detectedRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', ax: 'between', bg: 'surface', r: '300', px: '300', py: '200' },
  children: [
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: [{ $: 'found.label' }] },
        footnote({ $: 'found.detail' }),
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'runtimeStore.canConfigureAi' },
        then: {
          type: 'we-button',
          props: {
            size: 'sm',
            variant: 'soft',
            text: 'Add',
            loading: { $: "'addDetectedEndpoint' in runtimeStore.pending" },
            onClick: { $invoke: 'runtimeStore.addDetectedEndpoint', args: [{ $: 'found.baseUrl' }] },
          },
          children: [{ type: 'we-icon', props: { name: 'plus' } }],
        },
      },
    },
  ],
};

const endpointsSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'runtimeStore.canManageAiEndpoints' },
    then: adminSection({
      title: 'Model servers',
      icon: 'hard-drives',
      refresh: 'runtimeStore.loadAiModels',
      children: [
        {
          type: '$if',
          props: {
            condition: { $: 'count(runtimeStore.aiEndpoints)' },
            then: {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: '$each',
                  props: { items: { $: 'runtimeStore.aiEndpoints' }, as: 'endpoint' },
                  children: [endpointCard],
                },
              ],
            },
            else: emptyNote('No model server is added. Every model runs on one.'),
          },
        },
        // Servers already running beside the node, one press from use.
        {
          type: '$if',
          props: {
            condition: { $: 'count(runtimeStore.aiDetectedEndpoints)' },
            then: {
              type: 'Column',
              props: { gap: '200' },
              children: [
                { type: 'we-text', props: { variant: 'overline', color: 'text-muted' }, children: ['On this machine'] },
                {
                  type: '$each',
                  props: { items: { $: 'runtimeStore.aiDetectedEndpoints' }, as: 'found' },
                  children: [detectedRow],
                },
              ],
            },
            // Nothing added and nothing running: where to get a server is the next thing to know.
            else: {
              type: '$if',
              props: {
                condition: { $: '!count(runtimeStore.aiEndpoints) && count(runtimeStore.aiInstallLinks)' },
                then: {
                  type: 'Row',
                  props: { gap: '200', ay: 'center', wrap: true },
                  children: [
                    footnote('No model server is running on the node’s machine. Install one, then look again:'),
                    {
                      type: '$each',
                      props: { items: { $: 'runtimeStore.aiInstallLinks' }, as: 'link' },
                      children: [
                        {
                          type: 'we-link',
                          props: { href: { $: 'link.url' }, target: '_blank' },
                          children: [{ $: 'link.label' }],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        {
          type: '$if',
          props: {
            condition: { $: 'runtimeStore.canConfigureAi' },
            then: {
              type: 'Row',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    text: 'Add a server',
                    size: 'sm',
                    variant: 'soft',
                    onClick: { $invoke: 'runtimeStore.newAiEndpoint' },
                  },
                  children: [{ type: 'we-icon', props: { name: 'plus' } }],
                },
                {
                  type: 'we-button',
                  props: {
                    text: 'Look on this machine',
                    size: 'sm',
                    variant: 'ghost',
                    loading: { $: "'detectAiEndpoints' in runtimeStore.pending" },
                    onClick: { $invoke: 'runtimeStore.detectAiEndpoints' },
                  },
                  children: [{ type: 'we-icon', props: { name: 'magnifying-glass' } }],
                },
              ],
            },
          },
        },
      ],
    }),
  },
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
                then: { type: 'we-badge', props: { tone: 'accent', size: 'xs' }, children: ['Default'] },
              },
            },
          ],
        },
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            // Changing the models is the node operator's, listing them is not. A guest on somebody
            // else's node reads this page; these would return a capability error.
            {
              type: '$if',
              props: {
                condition: { $: 'runtimeStore.canConfigureAi && !model.isDefault' },
                then: {
                  type: 'we-button',
                  props: {
                    text: 'Make default',
                    variant: 'ghost',
                    size: 'sm',
                    onClick: { $invoke: 'runtimeStore.setDefaultAiModel', args: [{ $: 'model.id' }] },
                  },
                },
              },
            },
            rowActions('runtimeStore.editAiModel', 'runtimeStore.removeAiModel', 'model.id'),
          ],
        },
      ],
    },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', wrap: true },
      children: [
        footnote({ $: 'model.kindLabel' }),
        {
          type: '$if',
          props: {
            condition: { $: 'model.endpointName' },
            then: footnote({ $: '`· ${model.endpointName}`' }),
          },
        },
        footnote('·'),
        { type: 'we-text', props: { variant: 'footnote' }, children: [{ $: 'model.remoteModel' }] },
      ],
    },
    // Where it stands is its server's answer: ready, downloading, missing, or the server down.
    footnote({ $: 'model.statusText' }, { $: "model.ready ? 'text-muted' : 'warning-text'" }),
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
                onClick: { $invoke: 'runtimeStore.removeAiTask', args: [{ $: 'task.id' }] },
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
        endpointsSection,

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
                        variant: 'soft',
                        // A model names a server, so with none to name there is nothing to add yet.
                        disabled: { $: 'runtimeStore.canManageAiEndpoints && !count(runtimeStore.aiEndpoints)' },
                        onClick: { $invoke: 'runtimeStore.newAiModel' },
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
        { type: '$if', props: { condition: { $: 'runtimeStore.aiEndpointForm' }, then: endpointForm } },
      ],
    },
  },
};
