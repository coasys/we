/**
 * AI Assistant — the module's surface, mounted as an overlay slot.
 *
 * Composed declaratively from three registered components (all backed by the module store):
 *   - AssistantThreadList  — threads in the current neighbourhood + create-thread
 *   - AssistantThreadView   — active thread: messages, tool calls, live stream, composer
 *   - AssistantConfigPanel  — assistants, model selector, personalities, skills, MCP servers
 *
 * Opened from the module rail (`launcher` → `modules.assistant.toggle`); in its pre-module form
 * this was a shell view opened via `templateStore.openShellView`. Assistant replies are written
 * into the perspective by the AD4M backend and surface here through the store's live
 * subscriptions — this UI never calls a model itself.
 */
import type { SchemaNode } from '@we/schema-shared';

const surface: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', bg: 'neutral-0' },
  children: [
    // Header
    {
      type: 'Row',
      props: {
        ay: 'center',
        gap: '200',
        px: '400',
        py: '300',
        borderBottom: '1px solid neutral-200',
        styles: { 'flex-shrink': '0' },
      },
      children: [
        { type: 'we-icon', props: { name: 'sparkle', size: 'md' } },
        { type: 'we-text', props: { variant: 'heading-sm', fontWeight: '600' }, children: ['AI Assistant'] },
        { type: 'Row', props: { flex: '1' } },
        // The shell view had the host's close chrome; as an overlay the surface carries its own.
        {
          type: 'we-button',
          props: { variant: 'ghost', size: 'sm', onClick: { $action: 'modules.assistant.close' } },
          children: [{ type: 'we-icon', props: { name: 'x' } }],
        },
      ],
    },

    // Body: thread list | thread view | config panel
    {
      type: 'Row',
      props: { flex: '1', width: '100%', styles: { 'min-height': '0' } },
      children: [{ type: 'AssistantThreadList' }, { type: 'AssistantThreadView' }, { type: 'AssistantConfigPanel' }],
    },
  ],
};

/**
 * The slot node: full content-viewport overlay, visible while the store says so. The module
 * registry additionally gates on `Space.enabledModules`, composed outside this node.
 */
export const assistantSlot: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'modules.assistant.open' },
    then: {
      type: 'Column',
      props: {
        position: 'fixed',
        top: '0',
        left: 'var(--we-sidebar-width, 80px)',
        right: '0',
        height: '100vh',
        zIndex: 25,
        bg: 'neutral-0',
      },
      children: [surface],
    },
  },
};
