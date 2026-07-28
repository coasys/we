/**
 * AI Assistant — shell view for the AD4M AI-assistant surface.
 *
 * Composed declaratively from three registered components (all backed by `assistantStore`):
 *   - AssistantThreadList  — threads in the current neighbourhood + create-thread
 *   - AssistantThreadView   — active thread: messages, tool calls, live stream, composer
 *   - AssistantConfigPanel  — assistants, model selector, personalities, skills, MCP servers
 *
 * Opened via `templateStore.openShellView('ai-assistant')` (see TemplateLayout's shellViews
 * registry and the sidebar entry). Assistant replies are written into the perspective by the
 * AD4M backend and surface here through the store's live subscriptions — this UI never calls
 * a model itself.
 */
import type { TemplateSchema } from '@we/schema-shared';

export const aiAssistantTemplate: TemplateSchema = {
  meta: { name: 'AI Assistant', description: 'Chat with AD4M AI assistants', icon: 'sparkle' },
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
      ],
    },

    // Body: thread list | thread view | config panel
    {
      type: 'Row',
      props: { flex: '1', width: '100%', styles: { 'min-height': '0' } },
      children: [
        { type: 'AssistantThreadList' },
        { type: 'AssistantThreadView' },
        { type: 'AssistantConfigPanel' },
      ],
    },
  ],
};
