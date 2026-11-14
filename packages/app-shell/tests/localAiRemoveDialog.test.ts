/**
 * Settings → This device: the dialog that removes local AI.
 *
 * "Also delete the downloaded models and programs" is a choice about one removal. Held in the
 * section's local state, it stayed ticked when the dialog closed, so the next removal opened with the
 * files already marked for deletion.
 *
 * Asserted against the schema, as `devToolsSwitch` is: the handler each node carries is the fact.
 */
import { settingsTemplate } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

type Node = Record<string, unknown>;

function walk(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const record = node as Node;
  out.push(record);
  for (const key of ['children', 'routes', 'then', 'else']) walk(record[key], out);
  const props = record.props as Node | undefined;
  if (props) {
    walk(props.then, out);
    walk(props.else, out);
  }
  return out;
}

/** The button that opens the removal dialog, found by what it sets. */
const openers = walk(settingsTemplate).filter((node) =>
  JSON.stringify((node.props as Node | undefined)?.onClick ?? '').includes(
    '"$setLocal":"confirmRemoveLocal","value":true',
  ),
);

describe('Settings → This device → Remove', () => {
  it('finds the button that opens the dialog', () => {
    expect(openers.length).toBeGreaterThan(0);
  });

  it('opens with the files kept, whatever the last removal chose', () => {
    for (const opener of openers) {
      expect((opener.props as Node).onClick).toEqual(
        expect.arrayContaining([{ $setLocal: 'removeLocalFiles', value: false }]),
      );
    }
  });
});
