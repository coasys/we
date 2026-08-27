/**
 * The developer switch, and the asymmetry that keeps it from being a one-way door.
 *
 * Two store members answer two different questions and it is tempting to treat them as one.
 * `sessionStore.isDevelopment` is a fact about the build; `sessionStore.devTools` is whether
 * developer affordances should be *visible*, which a developer is allowed to have an opinion about.
 *
 * Wire both to `devTools` and the page works exactly once: throwing the switch off removes the
 * Settings entry that holds the switch, so the only way back is clearing site data. The bug is
 * invisible until somebody uses the feature for its actual purpose — look at what a user sees, then
 * come back — which is to say, on the first real use.
 *
 * Asserted against the schema rather than a rendered page for the reason `templatePicker` is: what
 * is being protected is which condition each node carries, not anything about how it draws.
 */
import { settingsTemplate } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

type Node = Record<string, unknown>;

/** Every node in the tree, flattened — routes, children, and the branches of an `$if`'s props. */
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

const nodes = walk(settingsTemplate);

/** The switch itself, found by the action it calls rather than by position. */
const toggle = nodes.find((node) => {
  const action = (node.props as Node | undefined)?.onChange as Node | undefined;
  return action?.$action === 'sessionStore.setDevTools';
});

describe('Settings → Developer', () => {
  it('offers a switch rather than a console incantation', () => {
    // The whole reason this section exists: `localStorage.setItem('we.devTools', 'off')` is a thing
    // you look up every time, and therefore a thing you leave in whichever position you left it.
    expect(toggle).toBeDefined();
    expect((toggle?.props as Node).checked).toEqual({ $store: 'sessionStore.devTools' });
  });

  it('passes the switch value straight through', () => {
    /*
      `$event.detail` bare. An operator around it — `$not`, an `$if` — resolves at render time,
      before the event exists, so the action would receive a constant and the switch would only ever
      set one value. The store method is phrased positively so no operator is needed.
    */
    const action = (toggle?.props as Node).onChange as Node;
    expect(action.args).toEqual(['$event.detail']);
  });

  it('gates the way to the switch on the build, not on the switch', () => {
    /*
      The one-way door. Anything gated on `devTools` disappears when the switch is thrown; the
      control that throws it back must therefore be gated on something the switch cannot change.
    */
    const navToDeveloper = nodes.find((node) => {
      const action = (node.props as Node | undefined)?.onClick as Node | undefined;
      return action?.$action === 'routeStore.navigate' && (action.args as unknown[])?.[0] === '/developer';
    });
    expect(navToDeveloper).toBeDefined();

    const gate = nodes.find((node) => {
      const props = node.props as Node | undefined;
      return node.type === '$if' && walk(props?.then).includes(navToDeveloper as Node);
    });
    expect(gate, 'the Developer nav entry must be behind an $if').toBeDefined();
    expect((gate?.props as Node).condition).toEqual({ $store: 'sessionStore.isDevelopment' });
  });
});
