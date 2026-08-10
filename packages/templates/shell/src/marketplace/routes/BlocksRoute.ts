import type { SchemaNode } from '@we/schema-shared';
import { gatePrompt } from '@we/template-kit';

// `fill: false` — this sits inside the marketplace's own tab flow, which already has a height.
export const blocksRoute: SchemaNode = gatePrompt({
  icon: 'cube',
  iconColor: 'neutral-300',
  title: 'Blocks coming soon',
  body: 'Community block publishing will be available in a future update.',
  fill: false,
  gap: '300',
  bodyWidth: '360px',
});
