/**
 * Where each in-call control is allowed to appear — across everything this build ships, not one module.
 *
 * Josh's round on #487 named three homes, each of them the only one:
 *
 * - **Sharing your pointer and taking the wheel** are lines in the call bar's More menu, which the
 *   live module reaches through the call's `call-menu` anchor. Nowhere else — not the bar's row, not
 *   another anchor, not the module rail.
 * - **The route a call takes and its quality** are words in Call settings. The bar once carried a
 *   broadcast glyph and a quality toggle beside the gear; nothing outside the popover may again.
 * - **Fake participants** exist only behind the developer-tools switch: with it off the section is
 *   not drawn at all, rather than drawn empty or disabled.
 *
 * Asked of every bundled module's contributions, and of every template, view and bundle built in,
 * because a module test can only see its own module: the regression this guards against is a second
 * home added somewhere that module never hears about.
 */
import { bundledModules } from '@shared/registries/bundledModules.generated';
import { bundledTemplates } from '@shared/registries/bundledTemplates.generated';
import { bundledViews } from '@shared/registries/bundledViews.generated';
import type { ModuleDefinition } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import coasysBundle from '../../../bundles/coasys.bundle.json';
import fieldGuideBundle from '../../../bundles/field-guide.bundle.json';
import toolLibraryBundle from '../../../bundles/tool-library.bundle.json';

const modules: ModuleDefinition[] = Object.values(bundledModules).map((factory) => factory({ components: {} }));

/** A copy of a tree with every subtree the predicate matches cut out. */
function without(node: unknown, cut: (record: Record<string, unknown>) => boolean): unknown {
  if (Array.isArray(node)) return node.map((item) => without(item, cut));
  if (!node || typeof node !== 'object') return node;
  const record = node as Record<string, unknown>;
  if (cut(record)) return null;
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, without(value, cut)]));
}

const conditionIs = (record: Record<string, unknown>, expression: string): boolean =>
  record.type === '$if' &&
  JSON.stringify((record.props as Record<string, unknown> | undefined)?.condition) ===
    JSON.stringify({ $: expression });

/** Every built-in template, view and bundle, as one list of named trees. */
const shippedTrees = (): [string, unknown][] => [
  ...Object.entries(bundledTemplates).map(([id, tree]): [string, unknown] => [`template ${id}`, tree]),
  ...Object.entries(bundledViews).map(([id, tree]): [string, unknown] => [`view ${id}`, tree]),
  ['bundle coasys', coasysBundle],
  ['bundle field-guide', fieldGuideBundle],
  ['bundle tool-library', toolLibraryBundle],
];

describe('sharing your pointer and taking the wheel', () => {
  const POINTER_OR_WHEEL = /toggleCursors|toggleWheel|takeWheel|Share your pointer|Take the wheel/;

  it('is offered by no rail launcher, from any module', () => {
    for (const module of modules) {
      for (const launcher of module.contributes?.launchers ?? []) {
        expect(
          JSON.stringify(launcher),
          `${module.manifest.id} launcher ${launcher.key} offers the pointer or the wheel`,
        ).not.toMatch(POINTER_OR_WHEEL);
      }
    }
  });

  it('reaches a call only through the More menu’s anchor', () => {
    const homes = modules.flatMap((module) =>
      (module.contributes?.slots ?? [])
        .filter((slot) => POINTER_OR_WHEEL.test(JSON.stringify(slot.node)))
        .map((slot) => `${module.manifest.id} → ${slot.anchor}`),
    );
    expect(homes).toEqual(['live → call-menu', 'live → call-menu']);
  });

  it('is in no panel, and placed by no template, view or bundle', () => {
    for (const module of modules) {
      for (const panel of module.contributes?.panels ?? []) {
        expect(JSON.stringify(panel.node ?? null), `${module.manifest.id} panel ${panel.name}`).not.toMatch(
          POINTER_OR_WHEEL,
        );
      }
    }
    for (const [name, tree] of shippedTrees()) {
      const json = JSON.stringify(tree);
      expect(json, name).not.toMatch(POINTER_OR_WHEEL);
      expect(json, `${name} places the live module's buttons as parts`).not.toMatch(/live\.(cursorToggle|wheelButton)/);
    }
  });
});

describe('the route a call takes and its quality', () => {
  const ROUTE_OR_QUALITY =
    /modules\.call\.(topology|qualityPreference|setQualityPreference|cycleQuality|switchTopology)/;
  /** Call settings is the popover the store's `settingsOpen` mounts. */
  const outsideSettings = (tree: unknown): string =>
    JSON.stringify(without(tree, (record) => conditionIs(record, 'modules.call.settingsOpen')));

  it('is read or changed nowhere in a module’s chrome but Call settings', () => {
    for (const module of modules) {
      const contributes = module.contributes ?? {};
      const trees: [string, unknown][] = [
        ...(contributes.slots ?? []).map((slot): [string, unknown] => [`slot ${slot.anchor}`, slot.node]),
        ...(contributes.panels ?? []).map((panel): [string, unknown] => [`panel ${panel.name}`, panel.node]),
        ...Object.entries(contributes.parts ?? {}).map(([name, part]): [string, unknown] => [`part ${name}`, part]),
        ...(contributes.launchers ?? []).map((launcher): [string, unknown] => [`launcher ${launcher.key}`, launcher]),
      ];
      for (const [name, tree] of trees) {
        expect(outsideSettings(tree), `${module.manifest.id} ${name}`).not.toMatch(ROUTE_OR_QUALITY);
      }
    }
  });

  it('is in Call settings, as words', () => {
    const stage = modules
      .find((module) => module.manifest.id === 'call')
      ?.contributes?.panels?.find((panel) => panel.name === 'stage')?.node;
    const json = JSON.stringify(stage);
    expect(json).toMatch(ROUTE_OR_QUALITY);
    expect(json).toContain('Quality preference');
    expect(json).toContain('SFU relay');
  });

  it('is placed by no template, view or bundle', () => {
    for (const [name, tree] of shippedTrees()) expect(JSON.stringify(tree), name).not.toMatch(ROUTE_OR_QUALITY);
  });
});

describe('fake participants', () => {
  const FAKE_PARTICIPANTS = /fakePeerCount|addFakePeer|removeFakePeer|Fake participants|fake participant/;
  /** What draws with the developer-tools switch off: everything outside a `sessionStore.devTools` gate. */
  const withSwitchOff = (tree: unknown): unknown =>
    without(tree, (record) => conditionIs(record, 'sessionStore.devTools'));

  it('draws nothing with the developer-tools switch off — not an empty or a disabled section', () => {
    for (const module of modules) {
      const contributes = module.contributes ?? {};
      const trees: [string, unknown][] = [
        // A slot *into* the development region renders only where that region is drawn, which is
        // what the next assertion pins; everything else must stand on its own.
        ...(contributes.slots ?? [])
          .filter((slot) => slot.anchor !== 'call-dev')
          .map((slot): [string, unknown] => [`slot ${slot.anchor}`, slot.node]),
        ...(contributes.panels ?? []).map((panel): [string, unknown] => [`panel ${panel.name}`, panel.node]),
        ...Object.entries(contributes.parts ?? {}).map(([name, part]): [string, unknown] => [`part ${name}`, part]),
      ];
      for (const [name, tree] of trees) {
        const json = JSON.stringify(withSwitchOff(tree));
        expect(json, `${module.manifest.id} ${name}`).not.toMatch(FAKE_PARTICIPANTS);
        expect(json, `${module.manifest.id} ${name} draws the development region ungated`).not.toContain(
          '"anchor":"call-dev"',
        );
      }
    }
  });

  it('is drawn with the switch on, in a development build', () => {
    // The other half, so the gate above is not passing because the section was deleted outright.
    const stage = modules
      .find((module) => module.manifest.id === 'call')
      ?.contributes?.panels?.find((panel) => panel.name === 'stage')?.node;
    expect(JSON.stringify(stage)).toMatch(FAKE_PARTICIPANTS);
  });
});
