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
    const div = container.querySelector('div');
    expect(div).toBeTruthy();
    expect(div!.getAttribute('class')).toBe('box');
    expect(div!.querySelector('span')).toBeTruthy();
  });

  // --- Unknown type throws ---
  it('throws for unknown type', () => {
    const node: SchemaNode = { type: 'UnknownComponent' };
    expect(() => renderSchema(node)).toThrow('Schema node has unknown type "UnknownComponent"');
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
    expect(container.querySelector('div')).toBeNull();
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
