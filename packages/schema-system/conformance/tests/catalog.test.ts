/**
 * The core catalog's machine-readable listing agrees with what the reference reads.
 *
 * `catalog/node-props.json` is written by the same step as `componentNodeProps.ts`, from the same
 * value, so a renderer or validator in another language reads the same node props this one does.
 * A hand edit of either, or a generator that wrote only one, fails here.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { COMPONENT_NODE_PROPS } from '../../shared/src/generated/componentNodeProps';

const catalog = JSON.parse(readFileSync(new URL('../catalog/node-props.json', import.meta.url), 'utf8')) as {
  catalog: string;
  version: number;
  nodeProps: Record<string, string[]>;
};

describe('catalog/node-props.json', () => {
  it('is the core catalog’s', () => {
    expect(catalog.catalog).toBe('core');
    expect(catalog.version).toBe(1);
  });

  it('lists the node props the reference reads, component by component', () => {
    expect(catalog.nodeProps).toEqual(COMPONENT_NODE_PROPS);
  });
});
