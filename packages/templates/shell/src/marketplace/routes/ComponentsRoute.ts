import type { SchemaNode } from '@we/schema-shared';
import { gatePrompt } from '@we/template-kit';

// `fill: false` — this sits inside the marketplace's own tab flow, which already has a height.
export const componentsRoute: SchemaNode = gatePrompt({
  icon: 'puzzle-piece',
  iconColor: 'text-faint',
  title: 'Components coming soon',
  body: 'Community component publishing will be available in a future update.',
  fill: false,
  gap: '300',
  bodyWidth: '360px',
});
