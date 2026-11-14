/**
 * A device row on Settings → Devices keeps its name readable however long its badges are.
 *
 * A revoked device whose key log let it keep the master key carries the badge "May still have your
 * master key. Replace it to lock this device out.". The row was one line that could not wrap, the name column
 * could shrink to nothing, and typography breaks text anywhere: the name came out one letter per
 * line. jsdom has no layout, so this checks the row's shape — the three things that together keep
 * the name whole.
 */
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
    const lines = name.children!.filter((n) => (n as Node).type === '$if') as Node[];
    const warning = lines.find((n) => conditionOf(n) === "device.revoked && device.master != ''");
    expect(warning).toBeDefined();
    const line = warning!.props!.then as Node;
    expect(line.type).toBe('we-text');
    expect(line.props?.overflowWrap).toBe('normal');
    const badge = end.children!.find(
      (n) => (n as Node).type === '$if' && ((n as Node).props?.then as Node).type === 'we-badge',
    ) as Node;
    expect(conditionOf(badge)).toBe("!device.revoked && device.holdsMaster == 'yes'");
  });

  /*
    "Master key offered, not yet taken" was a warning badge: a sentence in a badge, which at 320px ran
    out of the card, and a warning for something that is only pending. It is a muted line under the
    name, like the revoked warning, and only "holds" is still a badge.
  */
  it('says an offered master key in a muted line that wraps, not a badge', () => {
    const name = deviceRow().children![1] as Node;
    const conditionOf = (n: Node) => (n.props?.condition as { $: string }).$;
    const offered = (name.children!.filter((n) => (n as Node).type === '$if') as Node[]).find(
      (n) => conditionOf(n) === "!device.revoked && device.holdsMaster == 'offered'",
    );
    expect(offered).toBeDefined();
    const line = offered!.props!.then as Node;
    expect(line.type).toBe('we-text');
    expect(line.props?.color).toBe('text-muted');
    expect(line.props?.overflowWrap).toBe('normal');
  });
});
