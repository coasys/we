/* eslint-disable @typescript-eslint/no-explicit-any */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it, vi } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

// Helper: render a schema node and return the container
function renderSchema(
  node: SchemaNode | null,
  options: { stores?: Record<string, unknown>; registry?: ComponentRegistry; context?: Record<string, unknown> } = {},
) {
  const { stores = {}, registry = {}, context } = options;
  return render(() => <RenderSchema node={node} stores={stores} registry={registry} context={context} />);
}

describe('SchemaRenderer', () => {
  // --- Null / empty ---
  it('returns null for null node', () => {
    const { container } = renderSchema(null);
    expect(container.innerHTML).toBe('');
  });

  // --- Fragment (no type) ---
  it('renders children as fragment when no type', () => {
    const registry: ComponentRegistry = {
      'we-text': (props: any) => <span>{props.children}</span>,
    };
    const node: SchemaNode = {
      children: [
        { type: 'we-text', children: ['Hello'] },
        { type: 'we-text', children: ['World'] },
      ],
    };
    const { container } = renderSchema(node, { registry });
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(2);
    expect(spans[0].textContent).toBe('Hello');
    expect(spans[1].textContent).toBe('World');
  });

  // --- Registry component ---
  it('renders registered component by type lookup', () => {
    const TestComp = (props: any) => <div data-testid="test">{props.label}</div>;
    const registry: ComponentRegistry = { TestComp };
    const node: SchemaNode = { type: 'TestComp', props: { label: 'hi' } };
    const { container } = renderSchema(node, { registry });
    expect(container.querySelector('[data-testid="test"]')?.textContent).toBe('hi');
  });

  // --- HTML element passthrough ---
  it('renders HTML element for lowercase type', () => {
    const node: SchemaNode = { type: 'div', props: { class: 'box' }, children: [{ type: 'span' }] };
    const { container } = renderSchema(node);
    const div = container.querySelector('div.box');
    expect(div).toBeTruthy();
    expect(div!.getAttribute('class')).toBe('box');
    expect(div!.querySelector('span')).toBeTruthy();
  });

  // --- Unknown type throws ---
  it('renders a placeholder for an unknown type instead of throwing', () => {
    // Throwing took down the whole render, so one unresolvable node — a component from a feature
    // module that isn't enabled — blanked the page. `we-validate-schemas` still catches typos before
    // runtime, so nothing is lost at dev time.
    const node: SchemaNode = { type: 'UnknownComponent' };
    const { container } = renderSchema(node);
    expect(container.querySelector('[data-we-missing-component="UnknownComponent"]')).toBeTruthy();
  });

  // --- $store prop resolution ---
  it('resolves $store props and passes to component', () => {
    const TestComp = (props: any) => <span>{typeof props.value === 'function' ? props.value() : props.value}</span>;
    const registry: ComponentRegistry = { TestComp };
    const stores = { userStore: { name: 'Alice' } };
    const node: SchemaNode = { type: 'TestComp', props: { value: { $store: 'userStore.name' } } };
    const { container } = renderSchema(node, { registry, stores });
    expect(container.textContent).toBe('Alice');
  });

  // --- $routes ---
  it('$routes returns children prop', () => {
    const registry: ComponentRegistry = {};
    const node: SchemaNode = { type: '$routes' };
    const { container } = render(() => (
      <RenderSchema node={node} stores={{}} registry={registry}>
        <span>routed content</span>
      </RenderSchema>
    ));
    expect(container.textContent).toBe('routed content');
  });

  // --- $each ---
  it('$each renders a template for each item', () => {
    const TestItem = (props: any) => <li>{typeof props.label === 'function' ? props.label() : props.label}</li>;
    const registry: ComponentRegistry = { TestItem };
    const stores = { listStore: { items: ['a', 'b', 'c'] } };
    const node: SchemaNode = {
      type: '$each',
      props: { items: { $store: 'listStore.items' }, as: 'item' },
      children: [{ type: 'TestItem', props: { label: '$item' } }],
    };
    const { container } = renderSchema(node, { registry, stores });
    const lis = container.querySelectorAll('li');
    expect(lis.length).toBe(3);
    expect(lis[0].textContent).toBe('a');
    expect(lis[1].textContent).toBe('b');
    expect(lis[2].textContent).toBe('c');
  });

  // --- $if (node-level) ---
  it('$if renders then branch when condition is true', () => {
    const TestComp = () => <span>visible</span>;
    const registry: ComponentRegistry = { TestComp };
    const stores = { appStore: { show: true } };
    const node: SchemaNode = {
      type: '$if',
      props: {
        condition: { $store: 'appStore.show' },
        then: { type: 'TestComp' },
        else: { type: 'div' },
      },
    };
    const { container } = renderSchema(node, { registry, stores });
    expect(container.querySelector('span')?.textContent).toBe('visible');
    // The only divs should be theme wrappers with display:contents, not the else branch
    const divs = container.querySelectorAll('div');
    for (const d of divs) {
      expect(d.style.display).toBe('contents');
    }
  });

  it('$if renders else branch when condition is false', () => {
    const TestComp = () => <span>visible</span>;
    const registry: ComponentRegistry = { TestComp };
    const stores = { appStore: { show: false } };
    const node: SchemaNode = {
      type: '$if',
      props: {
        condition: { $store: 'appStore.show' },
        then: { type: 'TestComp' },
        else: { type: 'div', children: [{ type: 'span' }] },
      },
    };
    const { container } = renderSchema(node, { registry, stores });
    expect(container.querySelector('div')).toBeTruthy();
  });

  // --- Children as text strings ---
  it('renders string children directly', () => {
    const TestComp = (props: any) => <p>{props.children}</p>;
    const registry: ComponentRegistry = { TestComp };
    const node: SchemaNode = { type: 'TestComp', children: ['Hello world'] };
    const { container } = renderSchema(node, { registry });
    expect(container.querySelector('p')?.textContent).toBe('Hello world');
  });

  // --- Slots ---
  it('renders slot content', () => {
    const Layout = (props: any) => (
      <div>
        <header>{props.header}</header>
        <main>{props.children}</main>
      </div>
    );
    const registry: ComponentRegistry = { Layout };
    const node: SchemaNode = {
      type: 'Layout',
      slots: { header: { type: 'span', children: [{ type: 'span' }] } },
      children: [{ type: 'span' }],
    };
    const { container } = renderSchema(node, { registry });
    expect(container.querySelector('header span')).toBeTruthy();
    expect(container.querySelector('main span')).toBeTruthy();
  });

  // --- Event handlers (functions pass through) ---
  // --- $localState with dynamic initial (expression token) ---
  it('seeds $localState signal from $store expression when initial is a token', () => {
    const InputComp = (props: any) => <input data-testid="input" value={props.value} />;
    const registry: ComponentRegistry = { InputComp };
    const stores = { spaceStore: { currentSpace: { name: 'My Space' } } };
    const node: SchemaNode = {
      type: 'div',
      $localState: {
        editName: { type: 'string', initial: { $store: 'spaceStore.currentSpace.name' } as any },
      },
      children: [
        {
          type: 'InputComp',
          props: { value: { $local: 'editName' } },
        },
      ],
    };
    const { container } = renderSchema(node, { registry, stores });
    const input = container.querySelector('[data-testid="input"]') as HTMLInputElement;
    expect(input.value).toBe('My Space');
  });

  it('seeds $localState from a $-prefixed context string, as every other position accepts', () => {
    // Only object tokens were resolved, so a form seeded from a `$each` item rendered the string
    // `$space.name` in its input — no error, and the field looked filled in. This is the shape a
    // per-space settings page needs: the space comes from the loop, not from a store path.
    const InputComp = (props: any) => <input data-testid="input" value={props.value} />;
    const registry: ComponentRegistry = { InputComp };
    const stores = { spaceStore: { spaceList: () => [{ uuid: 'abc', name: 'My Space' }] } };
    const node: SchemaNode = {
      type: '$each',
      props: { items: { $store: 'spaceStore.spaceList' }, as: 'space' },
      children: [
        {
          type: 'div',
          $localState: { editName: { type: 'string', initial: '$space.name' as any } },
          children: [{ type: 'InputComp', props: { value: { $local: 'editName' } } }],
        },
      ],
    };
    const { container } = renderSchema(node, { registry, stores });
    const input = container.querySelector('[data-testid="input"]') as HTMLInputElement;
    expect(input.value).toBe('My Space');
  });

  it('leaves a literal starting with $ alone when it matches no context key', () => {
    const InputComp = (props: any) => <input data-testid="input" value={props.value} />;
    const registry: ComponentRegistry = { InputComp };
    const node: SchemaNode = {
      type: 'div',
      $localState: { price: { type: 'string', initial: '$5.00' as any } },
      children: [{ type: 'InputComp', props: { value: { $local: 'price' } } }],
    };
    const { container } = renderSchema(node, { registry, stores: {} });
    const input = container.querySelector('[data-testid="input"]') as HTMLInputElement;
    expect(input.value).toBe('$5.00');
  });

  it('resets $localState signal when the $store expression source changes reactively', async () => {
    const { createSignal } = await import('solid-js');
    const InputComp = (props: any) => <input data-testid="input" value={props.value} />;
    const registry: ComponentRegistry = { InputComp };
    const [spaceName, setSpaceName] = createSignal('Space A');
    const stores = {
      spaceStore: {
        get currentSpace() {
          return { name: spaceName() };
        },
      },
    };
    const node: SchemaNode = {
      type: 'div',
      $localState: {
        editName: { type: 'string', initial: { $store: 'spaceStore.currentSpace.name' } as any },
      },
      children: [{ type: 'InputComp', props: { value: { $local: 'editName' } } }],
    };
    const { container } = renderSchema(node, { registry, stores });
    const input = () => container.querySelector('[data-testid="input"]') as HTMLInputElement;
    expect(input().value).toBe('Space A');
    setSpaceName('Space B');
    await Promise.resolve(); // flush effects
    expect(input().value).toBe('Space B');
  });

  it('passes event handler functions through', () => {
    const clickSpy = vi.fn();
    const TestComp = (props: any) => <button onClick={props.onClick}>click</button>;
    const registry: ComponentRegistry = { TestComp };
    const stores = { uiStore: { handleClick: clickSpy } };
    const node: SchemaNode = {
      type: 'TestComp',
      props: { onClick: { $action: 'uiStore.handleClick' } },
    };
    const { container } = renderSchema(node, { registry, stores });
    const btn = container.querySelector('button')!;
    btn.click();
    expect(clickSpy).toHaveBeenCalledOnce();
  });
});

// --- $if then/else must be NODES, not prop tokens ---
//
// The distinction is easy to get wrong because both spellings exist and both validate: `{ $if: … }`
// is the prop-level operator (legal in a `variant`, a `type`, an `error`), while `{ type: '$if' }`
// is the block-level node. ConditionalRenderer hands `then`/`else` straight to renderNode, so a
// prop token in those slots has no `type` and renders nothing — silently, and only at runtime.
// This shipped in the boot screen and blanked the entire sign-in form.
describe('$if branch slots', () => {
  const registry: ComponentRegistry = { 'we-text': (props: any) => <span>{props.children}</span> };

  it('renders a nested $if NODE in the else slot', () => {
    const node: SchemaNode = {
      type: '$if',
      props: {
        condition: false,
        then: { type: 'we-text', children: ['outer-then'] },
        else: {
          type: '$if',
          props: {
            condition: false,
            then: { type: 'we-text', children: ['inner-then'] },
            else: { type: 'we-text', children: ['inner-else'] },
          },
        },
      },
    };
    const { container } = renderSchema(node, { registry });
    expect(container.textContent).toBe('inner-else');
  });

  it('renders a nested $if NODE in the then slot', () => {
    const node: SchemaNode = {
      type: '$if',
      props: {
        condition: true,
        then: {
          type: '$if',
          props: { condition: true, then: { type: 'we-text', children: ['deep'] } },
        },
      },
    };
    const { container } = renderSchema(node, { registry });
    expect(container.textContent).toBe('deep');
  });

  it('renders nothing for a prop-level token in a branch slot — the trap', () => {
    const node: SchemaNode = {
      type: '$if',
      props: {
        condition: false,
        then: { type: 'we-text', children: ['then'] },
        // Wrong spelling: an operator token where a node belongs.
        else: { $if: { condition: true, then: { type: 'we-text', children: ['never-rendered'] } } },
      },
    };
    const { container } = renderSchema(node, { registry });
    expect(container.textContent).toBe('');
  });
});

describe('$if with a transition — the wrapper must not change layout', () => {
  const registry: ComponentRegistry = { Box: (props: any) => <div data-testid="box">{props.children}</div> };

  it('adopts the size the content declared, so percentages resolve against the real parent', () => {
    // The wrapper carries opacity and transform and is meant to be invisible to layout. Without
    // this it becomes the box a percentage resolves against — and since it shrink-wraps its
    // content, `width: 100%` resolves against something sized by the very element asking, which
    // CSS settles as shrink-to-fit. The element renders at its intrinsic width and `maxWidth`
    // never binds, because nothing ever asks for more.
    const node: SchemaNode = {
      type: '$if',
      props: {
        condition: true,
        enterTransition: { type: 'fade', duration: 300 },
        then: { type: 'Box', props: { width: '100%', maxWidth: '380px' } },
      },
    };
    const { container } = renderSchema(node, { registry });

    const wrapper = container.querySelector('div');
    expect(wrapper?.style.width).toBe('100%');
    // maxWidth travels with it — that is what keeps the parent's alignment landing on a box of the
    // right size, rather than centring a full-width wrapper with the content against its left edge.
    expect(wrapper?.style.maxWidth).toBe('380px');
  });

  it('leaves the wrapper unsized when the content declared no size', () => {
    // Content that shrink-wraps today must keep doing so, or anything a parent was centring
    // would start stretching.
    const node: SchemaNode = {
      type: '$if',
      props: { condition: true, enterTransition: { type: 'fade' }, then: { type: 'Box' } },
    };
    const { container } = renderSchema(node, { registry });

    const wrapper = container.querySelector('div');
    expect(wrapper?.style.width).toBe('');
    expect(wrapper?.style.maxWidth).toBe('');
  });

  it('takes position from the content, but not the offsets that place it', () => {
    // Both halves matter, and together they say where a fading overlay has to be anchored.
    //
    // Without the position the wrapper is a normal-flow div holding an out-of-flow child: zero
    // height, but still a flex item, so it contributes its parent's `gap` and the parent re-lays
    // out the moment the transition ends and the wrapper unmounts.
    //
    // With it, the wrapper is absolutely positioned at its *static* position and sized 100% — the
    // offsets stay on the content, where they now resolve against the wrapper rather than against
    // whatever the author anchored to. Content that anchors to an edge therefore belongs inside a
    // container that is already anchored, not inside the transition.
    const node: SchemaNode = {
      type: '$if',
      props: {
        condition: true,
        exitTransition: { type: 'fade' },
        then: { type: 'Box', props: { position: 'absolute', bottom: '12px', left: '12px' } },
      },
    };
    const { container } = renderSchema(node, { registry });

    const wrapper = container.querySelector('div');
    expect(wrapper?.style.position).toBe('absolute');
    expect(wrapper?.style.bottom).toBe('');
    expect(wrapper?.style.left).toBe('');
  });

  it('lets an explicit size win over the positioned default', () => {
    // Positioned content gets width/height 100%; a declared size is more specific than that.
    const node: SchemaNode = {
      type: '$if',
      props: {
        condition: true,
        enterTransition: { type: 'fade' },
        then: { type: 'Box', props: { position: 'absolute', width: '380px' } },
      },
    };
    const { container } = renderSchema(node, { registry });

    const wrapper = container.querySelector('div');
    expect(wrapper?.style.width).toBe('380px');
    expect(wrapper?.style.height).toBe('100%');
  });
});
