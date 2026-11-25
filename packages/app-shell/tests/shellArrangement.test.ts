/**
 * The shell store's arrangement part: what the reader has done to the panels, kept per interface and
 * per agent — placements and stacking, named layouts, a reset that forgets only this template's, the
 * home lanes' widths and folds, and panel instances that follow whoever is signed in. Under each
 * reactivity port.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FloatPlacement } from '../src/shared/dockGeometry';
import { setTemplatePanels } from '../src/shared/registries/templatePanels';
import { buildParts, reactivityPorts } from './support/shellPorts';

const card = (x: number): FloatPlacement => ({ snap: null, x, y: 40, w: 300, h: 300, displace: false });
const SCOPE = 'arrangement-test';
const PANEL = 'template:inspector';

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  const build = () => {
    const parts = buildParts(makePort());
    disposers.push(parts.dispose);
    return parts.arrangement;
  };
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/space/test');
    setTemplatePanels([{ id: 'inspector', title: 'Inspector', node: { type: 'div' } }], SCOPE);
  });
  afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    setTemplatePanels(undefined);
  });

  it('keeps a declared panel’s place under its template, and an undeclared one’s everywhere', () => {
    const arrangement = build();
    arrangement.writePlacement(PANEL, card(10));
    arrangement.writePlacement('notes:panel', card(20));
    expect(Object.keys(arrangement.placements()).sort()).toEqual([`${SCOPE}::${PANEL}`, 'notes:panel']);
    expect(arrangement.members.layoutDirty()).toBe(true);

    arrangement.members.resetTemplateLayout();
    expect(Object.keys(arrangement.placements())).toEqual(['notes:panel']);
    expect(arrangement.members.layoutDirty()).toBe(false);
  });

  it('raises a panel above the rest, and writes nothing for the one already on top', () => {
    const arrangement = build();
    arrangement.raise('a');
    arrangement.raise('b');
    const touched = arrangement.activation();
    expect(touched.b).toBeGreaterThan(touched.a);
    arrangement.raise('b');
    expect(arrangement.activation()).toBe(touched);
    expect(arrangement.members.seatFront(['a', 'b', 'c'])).toBe('b');
  });

  it('saves the arrangement under a name, and puts it back after it is moved', () => {
    const arrangement = build();
    arrangement.writePlacement(PANEL, card(10));
    arrangement.members.saveLayout(' Recording ');
    expect(arrangement.members.layoutNames()).toEqual(['Recording']);
    expect(arrangement.members.activeLayout()).toBe('Recording');

    arrangement.writePlacement(PANEL, card(500));
    expect(arrangement.members.activeLayout()).toBe('');
    arrangement.members.applyLayout('Recording');
    expect(arrangement.placements()[`${SCOPE}::${PANEL}`].x).toBe(10);
    expect(arrangement.members.activeLayout()).toBe('Recording');

    arrangement.members.deleteLayout('Recording');
    expect(arrangement.members.layoutNames()).toEqual([]);
    expect(arrangement.members.activeLayout()).toBe('');
  });

  it('keeps a home lane’s width and fold for this template, and folds as said', () => {
    const arrangement = build();
    arrangement.members.setLaneWidth('side', 287.6);
    arrangement.members.setLaneWidth('side', Number.NaN);
    arrangement.members.toggleLane('side');
    expect(arrangement.members.laneWidth('side')).toBe(288);
    expect(arrangement.members.collapsedLanes()).toEqual(['side']);
    arrangement.members.setLaneCollapsed('side', false);
    expect(arrangement.members.collapsedLanes()).toEqual([]);
    expect(build().members.laneWidth('side')).toBe(288);
  });

  it('closes a declared panel under its template, and says the arrangement has changed', () => {
    const arrangement = build();
    arrangement.members.closeTemplatePanel('inspector');
    expect(arrangement.closedPanels()).toEqual({ [`${SCOPE}::${PANEL}`]: true });
    expect(arrangement.members.layoutDirty()).toBe(true);
  });

  it('forgets what was closed when the template on screen changes', () => {
    const arrangement = build();
    arrangement.members.closeTemplatePanel('inspector');
    setTemplatePanels([{ id: 'feed', title: 'Feed', node: { type: 'div' } }], 'another-template');
    expect(arrangement.closedPanels()).toEqual({});
    setTemplatePanels([{ id: 'inspector', title: 'Inspector', node: { type: 'div' } }], SCOPE);
    expect(arrangement.closedPanels()).toEqual({});
  });

  it('keeps what was closed while the same template declares its panels again', () => {
    const arrangement = build();
    arrangement.members.closeTemplatePanel('inspector');
    setTemplatePanels([{ id: 'inspector', title: 'Inspector (edited)', node: { type: 'div' } }], SCOPE);
    expect(arrangement.closedPanels()).toEqual({ [`${SCOPE}::${PANEL}`]: true });
  });

  it('keeps panel instances under the agent signed in, and shows the next agent none of them', () => {
    const arrangement = build();
    arrangement.members.provideAgentDid(() => 'did:a');
    arrangement.writeInstances(SCOPE, (here) => ({
      ...here,
      'template:inspector~x': { id: 'template:inspector~x', panel: 'inspector', inputs: {}, opened: 1 },
    }));
    expect(arrangement.members.panelInstances().map((instance) => instance.id)).toEqual(['template:inspector~x']);

    arrangement.members.provideAgentDid(() => 'did:b');
    expect(arrangement.members.panelInstances()).toEqual([]);
    arrangement.members.provideAgentDid(() => 'did:a');
    expect(arrangement.members.panelInstances()).toHaveLength(1);
  });

  it('hides an instance bound to a space while another is on screen', () => {
    const arrangement = build();
    arrangement.members.provideAgentDid(() => 'did:a');
    arrangement.writeInstances(SCOPE, () => ({
      'template:inspector~s': {
        id: 'template:inspector~s',
        panel: 'inspector',
        inputs: { perspectiveUuid: 'space-1' },
        opened: 1,
      },
    }));
    arrangement.members.provideSpaceGate((uuid) => uuid === 'space-2');
    expect(arrangement.members.panelInstances()).toEqual([]);
  });
});
