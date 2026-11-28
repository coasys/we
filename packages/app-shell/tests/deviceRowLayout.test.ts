/**
 * A device row on Settings → Devices keeps its name readable however long its badges are.
 *
 * A revoked device whose key log let it keep the master key carries the badge "May still have your
 * master key. Replace it to lock this device out.". The row was one line that could not wrap, the name column
 * could shrink to nothing, and typography breaks text anywhere: the name came out one letter per
 * line. jsdom has no layout, so this checks the row's shape — the three things that together keep
 * the name whole.
 */
import type { EvaluationEnv } from '@we/schema-shared';
import { evaluateExpression, parseExpression } from '@we/schema-shared';
import * as shell from '@we/template-shell';
import { describe, expect, it } from 'vitest';

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] };

/** The first node anywhere under `value` that `match` accepts. */
function find(value: unknown, match: (node: Node) => boolean, seen = new Set<unknown>()): Node | undefined {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  if (!Array.isArray(value) && match(value as Node)) return value as Node;
  for (const child of Object.values(value)) {
    const hit = find(child, match, seen);
    if (hit) return hit;
  }
  return undefined;
}

const deviceRow = (): Node => {
  const each = find(
    shell,
    (n) => n.type === '$each' && (n.props?.items as { $?: string } | undefined)?.$ === 'deviceStore.devices',
  );
  expect(each, 'the device list').toBeDefined();
  return each!.children![0] as Node;
};

describe('a device row', () => {
  it('wraps its badges and buttons onto a line of their own rather than squeezing the name', () => {
    const row = deviceRow();
    expect(row.type).toBe('Row');
    expect(row.props?.wrap).toBe(true);
    const end = row.children![2] as Node;
    expect(end.type).toBe('Row');
    expect(end.props?.wrap).toBe(true);
    expect(end.props?.minWidth).toBe('0');
  });

  it('gives the name column a floor it shrinks to before the row wraps', () => {
    const name = deviceRow().children![1] as Node;
    expect(name.props?.minWidth).toBe('0');
    const [grow, shrink, basis] = String(name.props?.flex).split(' ');
    expect([grow, shrink]).toEqual(['1', '1']);
    expect(basis).toMatch(/^[1-9]\d*(rem|px)$/);
  });

  it('wraps the name between words, never inside one', () => {
    const title = (deviceRow().children![1] as Node).children![0] as Node;
    expect(title.props?.overflowWrap).toBe('normal');
  });

  /*
    A badge never wraps its words or gives up width (`we-badge`), so the sentence about a revoked
    device's master key, in a badge, ran past the card on a narrow window even once it had a line
    of its own. It is a wrapping line under the name; only a valid device's short label is a badge.
  */
  it('says a revoked device may hold the master key in a line that wraps, not a badge', () => {
    const [name, end] = [deviceRow().children![1] as Node, deviceRow().children![2] as Node];
    const conditionOf = (n: Node) => (n.props?.condition as { $: string }).$;
    const warning = name.children!.find((n) => (n as Node).type === '$if') as Node;
    expect(conditionOf(warning)).toBe("device.revoked && device.master != ''");
    const line = warning.props!.then as Node;
    expect(line.type).toBe('we-text');
    expect(line.props?.overflowWrap).toBe('normal');
    const badge = end.children!.find(
      (n) => (n as Node).type === '$if' && ((n as Node).props?.then as Node).type === 'we-badge',
    ) as Node;
    expect(conditionOf(badge)).toBe("!device.revoked && device.master != ''");
  });
});

/*
  A linked device without the master key may rename itself (the custody service refuses only a
  rename of another device there), but Rename was gated on `deviceStore.canManage` alone, which needs
  the master key: no row offered it.
*/
describe("a device row's Rename", () => {
  const rename = (): string => {
    const end = deviceRow().children![2] as Node;
    const button = end.children!.find(
      (n) =>
        (n as Node).type === '$if' &&
        ((n as Node).props?.then as Node).type === 'we-button' &&
        ((n as Node).props?.then as Node).children?.[0] === 'Rename',
    ) as Node;
    expect(button, 'the Rename button').toBeDefined();
    return (button.props?.condition as { $: string }).$;
  };
  const shown = (
    device: { revoked: boolean; thisDevice: boolean },
    canManage: boolean,
    canChange: boolean,
    encMismatch = false,
  ) => {
    const scope: Record<string, unknown> = {
      device,
      deviceStore: { canManage, encMismatch },
      identityStore: { canChange },
    };
    const env: EvaluationEnv = {
      root: (name) => ({ bound: name in scope, value: scope[name] }),
      call: () => undefined,
    };
    return !!evaluateExpression(parseExpression(rename()), env);
  };
  const own = { revoked: false, thisDevice: true };
  const other = { revoked: false, thisDevice: false };

  it('is offered on this device’s own row without the master key, while identity changes can be made', () => {
    expect(shown(own, false, true)).toBe(true);
    expect(shown(own, false, false)).toBe(false);
  });

  it('still needs the master key for another device', () => {
    expect(shown(other, false, true)).toBe(false);
    expect(shown(other, true, true)).toBe(true);
  });

  it('is never offered on a removed device, this one included', () => {
    expect(shown({ revoked: true, thisDevice: true }, true, true)).toBe(false);
    expect(shown({ revoked: true, thisDevice: false }, true, true)).toBe(false);
  });

  // A name goes in the private record, which a computer that lost its enc key cannot open.
  it('is not offered while this computer has lost the key that opens the device list', () => {
    expect(shown(own, false, true, true)).toBe(false);
    expect(shown(other, true, true, true)).toBe(false);
  });
});

/*
  The custody service marks a computer whose enc key the key log no longer matches (`encMismatch`):
  nothing sent to it opens, the master key and the device list included. Devices said nothing of it;
  the only sign was a step that failed in the identity window.
*/
describe('the Devices page, on a computer that lost its enc key', () => {
  const ENC_MISMATCH =
    'This computer has lost the key that opens your master key and your device list, so it can no longer receive either. On a device that holds your master key, revoke this computer, then link it again.';

  it('warns in the custody service’s own words, and only then', () => {
    const warning = find(
      shell,
      (n) => n.type === '$if' && (n.props?.then as Node | undefined)?.children?.[0] === ENC_MISMATCH,
    )!;
    expect(warning, 'the warning').toBeDefined();
    // On Devices, beside the page's heading.
    const page = find(shell, (n) => Array.isArray(n.children) && n.children.includes(warning));
    expect(JSON.stringify(page?.children?.[0])).toContain('"Devices"');
    expect((warning.props?.condition as { $: string }).$).toBe('deviceStore.encMismatch');
    expect(warning.props?.then).toMatchObject({ type: 'we-alert', props: { tone: 'warning' } });
  });
});
