/**
 * Where Settings shows the runtime store's error.
 *
 * Every runtime call shares one list of calls in flight, and a model pull stays in it for up to
 * twenty minutes. An alert that waited for that list to be empty hid every error for as long as a
 * pull ran: a refused save looked like a button that did nothing. `run` already clears the error
 * when a call starts, so an error on screen is always the newest one, and no alert needs to wait.
 *
 * Asserted against the schema, as `devToolsSwitch` is: the condition each node carries is the fact.
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

/** The `$if`s whose `then` is an alert showing `runtimeStore.error`. */
const errorAlerts = walk(settingsTemplate).filter((node) => {
  const then = (node.props as Node | undefined)?.then as Node | undefined;
  return then?.type === 'we-alert' && JSON.stringify(then.children).includes('runtimeStore.error');
});

describe('Settings → runtime error alerts', () => {
  it('finds the alerts it is about', () => {
    // The AI forms' footer and the peer records section.
    expect(errorAlerts.length).toBeGreaterThanOrEqual(2);
  });

  it('shows the error while another call is still running', () => {
    for (const alert of errorAlerts) {
      expect(JSON.stringify((alert.props as Node).condition)).not.toContain('count(runtimeStore.pending)');
    }
  });
});
