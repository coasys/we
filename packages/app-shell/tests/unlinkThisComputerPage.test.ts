/**
 * The Devices page while this computer is being unlinked: the confirm's button is busy and every
 * other device button is disabled, so a second unlink (or a revoke, a rename) cannot be started.
 */
import { settingsTemplate } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] };

function find(node: unknown, match: (n: Node) => boolean, found: Node[] = []): Node[] {
  if (Array.isArray(node)) node.forEach((child) => find(child, match, found));
  else if (node && typeof node === 'object') {
    if (match(node as Node)) found.push(node as Node);
    Object.values(node).forEach((child) => find(child, match, found));
  }
  return found;
}

const invokes = (n: Node, method: string) => (n.props?.onClick as { $invoke?: string } | undefined)?.$invoke === method;

describe('Devices page while this computer is being unlinked', () => {
  it('shows the confirm button busy', () => {
    const confirm = find(
      settingsTemplate,
      (n) => n.type === 'we-button' && invokes(n, 'deviceStore.unlinkThisComputer'),
    );
    expect(confirm).toHaveLength(1);
    expect(confirm[0].props?.loading).toEqual({ $: 'deviceStore.unlinking' });
    expect(confirm[0].props?.disabled).toEqual({ $: 'deviceStore.unlinking' });
  });

  it.each([
    'deviceStore.rename',
    'deviceStore.unlink',
    'deviceStore.revoke',
    'deviceStore.scanDevice',
    'deviceStore.addDevice',
    'deviceStore.showCode',
    'deviceStore.takeMaster',
    'deviceStore.askMaster',
    'deviceStore.answerRequest',
  ])('disables %s', (method) => {
    const buttons = find(settingsTemplate, (n) => n.type === 'we-button' && invokes(n, method));
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.props?.disabled).toEqual({ $: 'identityStore.busy || deviceStore.unlinking' });
  });
});
