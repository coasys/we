/**
 * A setting drawn before the backend can do it. What it must get right is the two states: the tag and
 * an unusable preview while the capability is off, the real controls once it is on — and a preview
 * that cannot be reached by keyboard, since a faded control that still worked would invite a press.
 */
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { comingSoon } from './comingSoon.ts';

type Node = { type: string; props?: Record<string, unknown>; children?: Node[] };

const control: Node = { type: 'we-button', children: [] };

function section(preview?: Node[]): Node {
  return comingSoon({
    available: { $: 'capabilities.devices' },
    icon: 'devices',
    title: 'Your devices',
    description: 'Every device that holds a key of yours.',
    children: [control as SchemaNode],
    ...(preview ? { preview: preview as SchemaNode[] } : {}),
  }) as Node;
}

const [header, , body] = section([control]).children as [Node, Node, Node];
const badge = (header.children as Node[])[1];

describe('a coming-soon section', () => {
  it('tags itself while the capability is off, by negating the same expression', () => {
    expect(badge.type).toBe('$if');
    expect(badge.props?.condition).toEqual({ $: '!(capabilities.devices)' });
  });

  it('draws the real controls once the capability is on', () => {
    expect(body.props?.condition).toEqual({ $: 'capabilities.devices' });
    expect((body.props?.then as Node).children).toEqual([control]);
  });

  it('draws the preview out of reach of pointer and keyboard both', () => {
    const preview = body.props?.else as Node;

    expect(preview.props?.inert).toBe(true);
    expect(preview.props?.['aria-hidden']).toBe('true');
  });

  it('draws nothing in place of the controls when there is no preview', () => {
    const [, , bare] = section().children as [Node, Node, Node];

    expect(bare.props?.else).toBeUndefined();
  });
});
