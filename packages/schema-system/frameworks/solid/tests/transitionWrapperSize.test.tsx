/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * What the transition wrapper mirrors from the node inside it.
 *
 * A `$if` with transitions does not use `Show`: it renders a wrapper that carries the opacity, and
 * that wrapper copies a few of the content's props onto itself so it does not become an invisible
 * box the content's percentages resolve against. It copied them with `String(declared)`, which is
 * right for a literal and silently wrong for everything else a schema can write — an expression is
 * an object, so `width: { $: … }` reached the DOM as the CSS string `[object Object]`. The
 * declaration was not ignored but applied invalidly, so the wrapper fell back to auto sizing and
 * nothing said why.
 */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

const registry: ComponentRegistry = { Box: (props: any) => <div data-testid="box">{props.children}</div> };

const wrapperOf = (container: HTMLElement) => container.querySelector('div') as HTMLElement;

const panel = (props: Record<string, unknown>): SchemaNode => ({
  type: '$if',
  props: {
    condition: true,
    enterTransition: { type: 'fade', duration: 200 },
    then: { type: 'Box', props },
  },
});

describe('the $if transition wrapper', () => {
  it('resolves an expression-valued size rather than stringifying the token', () => {
    const { container } = render(() => (
      <RenderSchema
        node={panel({ width: { $: 'layout.width' } })}
        stores={{ layout: { width: '420px' } }}
        registry={registry}
      />
    ));

    expect(wrapperOf(container).style.width).toBe('420px');
  });

  it('still mirrors a literal, which is the case that always worked', () => {
    const { container } = render(() => (
      <RenderSchema node={panel({ width: '360px' })} stores={{}} registry={registry} />
    ));

    expect(wrapperOf(container).style.width).toBe('360px');
  });

  it('resolves an expression-valued position and z-index too', () => {
    const { container } = render(() => (
      <RenderSchema
        node={panel({ position: { $: 'layout.position' }, zIndex: { $: 'layout.layer' } })}
        stores={{ layout: { position: 'fixed', layer: 240 } }}
        registry={registry}
      />
    ));

    expect(wrapperOf(container).style.position).toBe('fixed');
    expect(wrapperOf(container).style.zIndex).toBe('240');
  });

  it('mirrors nothing the content did not declare', () => {
    const { container } = render(() => <RenderSchema node={panel({})} stores={{}} registry={registry} />);

    expect(wrapperOf(container).style.width).toBe('');
    expect(wrapperOf(container).style.height).toBe('');
  });
});
