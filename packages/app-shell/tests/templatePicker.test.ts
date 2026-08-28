/**
 * Editing a template from the picker takes one click, on any row that can be edited.
 *
 * It used to take three. The edit action was gated on the row being the one already on screen, so
 * the pencil beside every *other* template was simply absent — and the way to reach it was to pick
 * the template (which closed the menu), open the menu again, and click the pencil that had now
 * appeared. Two of those three steps existed only because of the gate.
 *
 * Worth a test rather than a comment because both halves fail silently and in opposite directions.
 * Gate on the wrong thing and the control vanishes, which reads as "not offered here" rather than
 * as a bug. Drop the switch from the click and it appears to work: an editing session opens, over
 * whichever template was current, and what you edit is not the row you clicked.
 *
 * Asserted against the schema for the reason `dockTitleBar` is: what is being protected is the
 * *condition* each control carries, not anything about how it draws.
 */
import { templatePicker } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

/** The node a `pickerRow` action expands to, found by the tooltip it names itself with. */
function actionFor(node: unknown, tooltip: string): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = actionFor(item, tooltip);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  const record = node as Record<string, unknown>;
  const props = record.props as Record<string, unknown> | undefined;

  // `when` wraps the button in an `$if`; the tooltip is the button itself.
  if (record.type === '$if') {
    const then = props?.then as Record<string, unknown> | undefined;
    const thenProps = then?.props as Record<string, unknown> | undefined;
    if (thenProps?.title === tooltip) return record;
  }
  if (record.type === 'we-tooltip' && props?.title === tooltip) return record;

  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      const hit = actionFor(value, tooltip);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** The `onClick` of the `we-button` inside an action, however it is wrapped. */
function clickOf(action: Record<string, unknown>): unknown[] {
  const tooltip =
    action.type === '$if' ? ((action.props as Record<string, unknown>).then as Record<string, unknown>) : action;
  const button = (tooltip.children as Record<string, unknown>[])[0];
  return (button.props as Record<string, unknown>).onClick as unknown[];
}

const actionNames = (onClick: unknown[]) =>
  onClick.map((step) => (step as { $action?: string }).$action).filter(Boolean);

describe('the picker offers editing on every editable row', () => {
  const picker = templatePicker();
  const edit = actionFor(picker, 'Edit this template');

  it('gates on the row, not on what happens to be rendered', () => {
    expect(edit).toBeDefined();
    const condition = (edit!.props as Record<string, unknown>).condition;

    // The row's own answer. `editorStore.isReadOnly` describes the *current* template, so gating on
    // it gives every row the same verdict and the pencil could only ever appear on one of them.
    expect(condition).toEqual({ $: 'template.editable' });
    expect(JSON.stringify(condition)).not.toContain('isReadOnly');
    expect(JSON.stringify(condition)).not.toContain('currentSwitcherId');
  });

  it('switches to the row before entering its editing session', () => {
    const steps = actionNames(clickOf(edit!));

    // Order is the assertion: `enterTemplateEditing` opens a session over whatever is current, so a
    // switch afterwards — or none at all — edits the wrong template while looking entirely correct.
    expect(steps).toEqual(['templateStore.switchTemplate', 'editorStore.enterTemplateEditing']);

    const [switchStep] = clickOf(edit!) as { args?: unknown[] }[];
    expect(switchStep.args).toEqual([{ $: 'template.id' }]);
  });

  it('still switches first when forking, which always did', () => {
    // The shape the edit action now matches. If this ever stops being true the two have diverged
    // again, and one of them is wrong.
    const fork = actionFor(picker, 'Fork this template');
    expect(actionNames(clickOf(fork!))).toEqual(['templateStore.switchTemplate', 'editorStore.startFork']);
  });
});
