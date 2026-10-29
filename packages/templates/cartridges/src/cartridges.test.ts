/**
 * The cartridges, judged as the validator would judge any template — and with what it cannot know.
 *
 * A cartridge's sections query kinds of record the cartridge defines itself. The validator learns
 * entity names from the generated context, which knows WE's own models and nothing a space defines,
 * so it reports every one of those queries as an unknown entity. This test says what is left once
 * the cartridge's own shapes are counted as known: the errors that are really the template's.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveStyle } from '@we/graph-core';
import {
  buildValidationContext,
  bundleThemes,
  evaluateExpression,
  listFunctions,
  parseExpression,
  readBundle,
  type SchemaNode,
  validateSemantic,
  withEntities,
} from '@we/schema-shared';
import {
  chooseTemplate,
  chooseTheme,
  FOCUS_DIM,
  SPACE_TEMPLATE_CHOICES,
  templateChoice,
  themeChoice,
} from '@we/template-kit';
import { describe, expect, it } from 'vitest';

import { canvasPane } from './coasys/space/canvas.ts';
import { callPath, groupPath, personPath, SELECTED_EXPR } from './coasys/space/paths.ts';
import { treeSection } from './coasys/space/tree.ts';
import { bundleFileName, type Cartridge, cartridgeBundles, coasys, fieldGuide, toolLibrary } from './index.ts';

const contextData = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../ai-context/context.json'), 'utf-8'));

function errorsFor(cartridge: Cartridge, withShapes: boolean): string[] {
  const base = buildValidationContext(contextData);
  const context = withShapes
    ? withEntities(
        base,
        cartridge.shapes.map((shape) => shape.name),
      )
    : base;
  return [cartridge.shell, ...cartridge.sections].flatMap((template) =>
    validateSemantic(template, context)
      .errors.filter((e) => e.severity === 'error')
      .map((e) => `${template.id}: ${e.path}: ${e.message}`),
  );
}

describe.each([fieldGuide, toolLibrary])('the $name cartridge', (cartridge) => {
  it('is valid once its own shapes are known', () => {
    expect(errorsFor(cartridge, true)).toEqual([]);
  });

  it('is reported as broken by a validator that does not know them — the gap this records', () => {
    const errors = errorsFor(cartridge, false);
    expect(errors.length).toBeGreaterThan(0);
    for (const shape of cartridge.shapes) expect(errors.join('\n')).toContain(shape.name);
  });
});

describe('the Coasys cartridge', () => {
  /*
    The landing page is an overlay over whatever template is behind it, at the root address — for a
    space, the spaces as cards. A rail button that closed the overlay and then navigated exposed that
    page for as long as the switch took, which on the first space after a boot was long enough to see.
    `navigateToSpace` closes the overlay itself, once the space has switched.
  */
  it('never closes an overlay ahead of going to a space, which shows what is behind it', () => {
    const offenders: string[] = [];
    (function walk(node: unknown, path: string) {
      if (Array.isArray(node)) {
        const invoked = node.map((step) => (step as { $invoke?: string } | null)?.$invoke);
        const close = invoked.indexOf('shellStore.closeShellView');
        if (close >= 0 && invoked.indexOf('spaceStore.navigateToSpace') > close) offenders.push(path);
        node.forEach((item, i) => walk(item, `${path}[${i}]`));
      } else if (node && typeof node === 'object')
        for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
    })(coasys.app, 'app');
    expect(offenders).toEqual([]);
  });

  // Each a row of its own, opened in one press: a menu choosing between the two cost every new space
  // a second click, and kept joining — which a desktop build has nowhere else to start — out of sight.
  it('offers creating and joining a space as rows of the rail, each opening its dialog', () => {
    const rail = JSON.stringify(coasys.app);
    for (const [label, opens] of [
      ['Create a space', 'shellStore.setCreateSpaceOpen'],
      ['Join a space', 'shellStore.setJoinSpaceOpen'],
    ]) {
      const row = findNode(coasys.app!, (n) => (n.props as { label?: unknown } | undefined)?.label === label);
      expect(row, label).toBeDefined();
      expect(JSON.stringify(row)).toContain(opens);
    }
    expect(rail).not.toContain('Add a space');
  });

  /*
    It defines no kinds of record of its own, so there is no gap to record: every template it brings
    must validate as it stands — the app around every space, the space template with its pages, and
    the pages of the app's own.
  */
  it('is valid as it stands', () => {
    const context = buildValidationContext(contextData);
    const errors = [coasys.app!, coasys.shell, ...(coasys.pages ?? [])].flatMap((template) =>
      validateSemantic(template, context)
        .errors.filter((e) => e.severity === 'error')
        .map((e) => `${template.id}: ${e.path}: ${e.message}`),
    );
    expect(errors).toEqual([]);
  });

  it('brings its own name, mark, sign-in screen and theme', () => {
    const bundle = cartridgeBundles().find((b) => b.id === 'coasys')!;
    expect(bundle.brand?.name).toBe('Coasys');
    expect(bundle.brand?.mark).toMatch(/^<svg/);
    // WE's sign-in form, placed with Coasys's words, rather than a copy of it: the form holds the
    // host's password field, and every step of signing in arrives with it.
    expect(JSON.stringify(bundle.bootScreen)).toContain('"id":"host.signIn.form"');
    expect(JSON.stringify(bundle.bootScreen)).toContain('"unlockLabel":"Unlock"');
    // Its About is a page of its own, which the bundle carries; the Markdown stays as the fallback.
    expect(bundle.pages?.map((page) => page.id)).toEqual([bundle.brand?.aboutPage]);
    expect(bundle.brand?.about).toBeTruthy();
    const [glowTheme, coasysTheme] = bundleThemes(bundle);
    expect(bundle.app?.meta.themeId).toBe(glowTheme.id);
    expect(Object.keys(coasysTheme.overrides)).toEqual(expect.arrayContaining(['light', 'dark']));
  });

  it('leads with Glow and offers Coasys beside it, Glow carrying its font rather than fetching it', () => {
    const bundle = cartridgeBundles().find((b) => b.id === 'coasys')!;
    const themes = bundleThemes(bundle);
    expect(themes.map((t) => t.name)).toEqual(['Coasys Glow', 'Coasys']);
    expect(bundle.app?.meta.themeIds).toEqual(themes.map((t) => t.id));
    const glow = themes[0];
    const faces = (glow.overrides as { fontFaces?: { family: string; src: string }[] }).fontFaces ?? [];
    expect(faces.map((f) => f.family)).toEqual(['Bricolage Grotesque']);
    expect(faces.every((f) => f.src.startsWith('data:font/woff2;base64,'))).toBe(true);
    // Nothing in it reaches out: no stylesheet carrying a url(), and no face that is not data.
    expect(glow.css ?? '').not.toMatch(/url\(/);
  });

  /*
    The canvas is the workshop's, from the kit: it was drawn once more by hand and had no suggestions,
    no card toolbar and no lines, and a double-click wrote an empty audio block where it should have
    asked what to make.
  */
  it('draws the workshop’s canvas, on the space’s canvas landmark', () => {
    const graph = findNode(coasys.shell, (n) => n.type === 'GraphView')!;
    const props = graph.props as Record<string, unknown>;
    const options = (props.seeds as { options: Record<string, unknown> }).options;
    expect(JSON.stringify(options.canvas)).toContain('spaceStore.landmarks.canvas');
    expect(options.contains).toEqual({ $: 'shapeStore.extractionCandidates' });
    expect(options.connections).toBe('Relationship');
    expect(options.pending).toBeTruthy();
    expect((props.nodeActions as { id: string }[]).map((a) => a.id)).toEqual(
      expect.arrayContaining(['accept', 'reject', 'review', 'color', 'delete']),
    );
    expect(props.onEdgeCreate).toBeTruthy();
    expect(JSON.stringify(props.onCanvasDoubleClick)).toContain('chooserOpen');
    expect(JSON.stringify(props)).not.toContain('createOnCanvas');
    // Reviewing a suggested change opens the record in the inspector beside the canvas.
    expect(JSON.stringify(props.onNodeAction)).toContain('"cardType"');
    expect(JSON.stringify(canvasPane)).toContain('Add to the canvas');
  });

  /*
    Page or Canvas. The tree chooses what is in focus and the mode says where to see it, so the canvas
    is drawn beside the pages rather than as one of them — mounted while the tree's choice changes —
    and dimmed to whatever is chosen. Evaluated by the expression engine the renderer uses, against
    the address each choice leaves.
  */
  /*
    Templates and themes in the tree: what a row is comes from the template kit, as the rail's pickers
    have it, so the two lists offer the same things; the tree's list is the ones somebody would switch
    between in this space, not every built-in the deployment carries.
  */
  describe('templates and themes in the tree', () => {
    const evaluate = (source: string, roots: Record<string, unknown>) =>
      evaluateExpression(parseExpression(source), {
        root: (name) => ({ bound: name in roots, value: roots[name] }),
        call: (name, args) =>
          listFunctions()
            .find((f) => f.name === name)
            ?.impl(args, { context: {}, stores: {} }),
      });

    it("offers the space's built-in, its own templates and the agent's, and not every built-in", () => {
      const row = (id: string) => ({ id, name: id });
      const roots = {
        templateStore: {
          currentSwitcherId: 'coasys-space',
          switcherGroups: [
            { label: 'Space templates', items: [row('space::ours')] },
            { label: 'My templates', items: [row('mine')] },
            { label: 'Built-in', items: [row('coasys-space'), row('workshop'), row('default')] },
          ],
        },
        spaceStore: { spaceDefaultTemplateId: 'coasys-space' },
      };
      const ids = (evaluate(SPACE_TEMPLATE_CHOICES, roots) as { id: string }[]).map((t) => t.id);
      expect(ids).toEqual(['coasys-space', 'space::ours', 'mine']);
    });

    it("draws each row with the rail picker's own actions, and wears what is chosen", () => {
      const tree = JSON.stringify(treeSection);
      for (const action of [...templateChoice().actions, ...themeChoice().actions]) {
        expect(tree).toContain(JSON.stringify(action.onClick));
      }
      expect(tree).toContain(JSON.stringify(chooseTemplate("split(event.detail.value, '|')[1]")));
      expect(tree).toContain(JSON.stringify(chooseTheme("split(event.detail.value, '|')[1]")));
      // Reset layout is the template row's own, offered once the layout has been moved.
      expect(tree).toContain('shellStore.resetTemplateLayout');
    });
  });

  describe('in Canvas mode', () => {
    const at = (path: string[], params: Record<string, string>, extra: Record<string, unknown> = {}) => {
      const roots: Record<string, unknown> = {
        routeStore: { templateSegments: path, params },
        spaceStore: { spacePath: '/space/s1', landmarks: { canvas: 'c1' }, policy: { sentences: [] } },
        workflowStore: { open: null },
        shapeStore: { spaceShapes: [] },
        ...extra,
      };
      return (prop: unknown) =>
        evaluateExpression(parseExpression((prop as { $: string }).$), {
          root: (name) => ({ bound: name in roots, value: roots[name] }),
          call: (name, args) =>
            listFunctions()
              .find((f) => f.name === name)
              ?.impl(args, { context: {}, stores: {} }),
        });
    };
    const graph = findNode(canvasPane, (n) => n.type === 'GraphView')!;
    const focusRules = ((graph.props as { nodeStyle: unknown[] }).nodeStyle as unknown[]).slice(-3);
    const dims = (evaluate: (p: unknown) => unknown) => focusRules.flatMap((rule) => evaluate(rule) as unknown[]);

    it('is drawn beside the pages, by the mode in the address', () => {
      const view = (coasys.shell.children as SchemaNode[])[1];
      expect(JSON.stringify(view)).toContain("routeStore.params.view == 'canvas'");
      expect(JSON.stringify(view)).toContain('"type":"$routes"');
    });

    it('dims to what was extracted from the call chosen, what a person made, or what is in a workflow', () => {
      expect(dims(at(['record'], { kind: 'call', id: 'call-1', view: 'canvas' }))).toEqual([
        { when: { 'data.origin': { not: 'call-1' } }, style: { opacity: FOCUS_DIM } },
      ]);
      expect(dims(at(['person'], { did: 'did:ada', view: 'canvas' }))).toEqual([
        { when: { 'data.author': { not: 'did:ada' } }, style: { opacity: FOCUS_DIM } },
      ]);
      const open = { name: 'review', label: 'Review', records: [{ record: 't1' }, { record: 't2' }] };
      expect(dims(at(['workflows'], { view: 'canvas' }, { workflowStore: { open } }))).toEqual([
        { when: { 'data.recordId': { not: ['t1', 't2'] } }, style: { opacity: FOCUS_DIM } },
      ]);
      // The Feed, and a record that is not a call, dim nothing.
      expect(dims(at([], { view: 'canvas' }))).toEqual([]);
      expect(dims(at(['record'], { kind: 'task', id: 't1', view: 'canvas' }))).toEqual([]);
    });

    it('is carried by every navigation the tree makes, so choosing another thing stays on the canvas', () => {
      const evaluate = at([], { view: 'canvas' });
      expect(evaluate({ $: callPath("'c9'") })).toBe('/space/s1/record/CollectionBlock?kind=call&id=c9&view=canvas');
      expect(evaluate({ $: personPath("'did:ada'") })).toBe('/space/s1/person?did=did:ada&view=canvas');
      expect(evaluate({ $: groupPath('calls') })).toBe('/space/s1/calls?view=canvas');
      expect(at([], {})({ $: groupPath('calls') })).toBe('/space/s1/calls');
    });

    /*
      Resolved by the graph's own style resolver, over a few nodes of the map, rather than only
      evaluated: rules of a shape the graph could not read once passed a check of their shape, and the
      space's template failed the moment a definition was chosen.
    */
    it('shows Social DNA on the vocabulary map: its kind and the chosen definition open, the rest dimmed', () => {
      const map = findNode(canvasPane, (n) => n.type === '$if' && JSON.stringify(n).includes('source":"vocabulary'));
      const vocab = findNode(map, (n) => n.type === 'GraphView')!;
      const props = vocab.props as { nodeStyle: unknown[]; open: unknown };
      const node = (id: string, data: Record<string, string>, kind = 'entity', type = 'SignalType') => ({
        id,
        kind,
        type,
        data,
      });
      const nodes = [
        node('signals', { bucket: 'signals' }, 'cluster', 'vocabulary'),
        node('like', { bucket: 'signals', recordId: 'like' }),
        node('rating', { bucket: 'signals', recordId: 'rating' }),
        node('like-mode', {}, 'property', 'mode'),
        node('states', { bucket: 'states' }, 'cluster', 'vocabulary'),
        node('rule', { bucket: 'policy', item: 'Members can make anything.' }, 'cluster', 'vocabulary-item'),
      ];
      const dimmed = (params: Record<string, string>) => {
        const evaluate = at([], { view: 'canvas', ...params });
        const rules = props.nodeStyle.map((rule) =>
          rule && typeof rule === 'object' && '$' in rule ? evaluate(rule) : rule,
        );
        return nodes
          .filter((n) => (resolveStyle(n as never, rules as never) as { opacity?: number }).opacity === FOCUS_DIM)
          .map((n) => n.id);
      };
      // A kind: the others dimmed, and nothing of its own.
      expect(dimmed({ dna: 'signal' })).toEqual(['states', 'rule']);
      // A definition: its siblings as well, while what it opened into stays whole.
      expect(dimmed({ dna: 'signal|like' })).toEqual(['rating', 'states', 'rule']);
      // The policy is Social DNA too: one rule, by its words.
      expect(dimmed({ dna: 'policy|Members can make anything.' })).toEqual(['signals', 'like', 'rating', 'states']);
      // All of it, nothing dimmed.
      expect(dimmed({ dna: 'all' })).toEqual([]);

      // What the tree chose is centred: a definition, or a kind's bucket; all of it, nothing.
      const focus = (vocab.props as { focus: unknown; focusCentre: boolean }).focus;
      expect((vocab.props as { focusCentre: boolean }).focusCentre).toBe(true);
      expect(at([], { view: 'canvas', dna: 'signal|like' })(focus)).toBe('like');
      expect(at([], { view: 'canvas', dna: 'signal' })(focus)).toBe('we-graph://cluster/vocabulary/signals');
      expect(at([], { view: 'canvas', dna: 'policy|Members can make anything.' })(focus)).toBe(
        'policy:Members can make anything.',
      );
      expect(at([], { view: 'canvas', dna: 'all' })(focus)).toBe('');

      // The chosen definition is opened into what it is, beside its kind.
      expect(at([], { view: 'canvas', dna: 'signal|like' })(props.open)).toEqual([
        'we-graph://cluster/vocabulary/signals',
        'like',
      ]);
    });

    /*
      A definition opens in the inspector beside the view, in either mode, and lights its row there;
      on the canvas, a press on a definition or on one of its uses opens it too, while a model — a
      type, not a record — does not.
    */
    it('opens a definition in the inspector, from the tree or the map', () => {
      const map = findNode(canvasPane, (n) => n.type === '$if' && JSON.stringify(n).includes('source":"vocabulary'));
      const vocab = findNode(map, (n) => n.type === 'GraphView')!;
      const onNodeClick = (vocab.props as { onNodeClick: { $if: { condition: unknown; then: unknown } } }).onNodeClick;
      expect(onNodeClick.$if.then).toEqual([
        { $invoke: 'routeStore.setParam', args: ['cardType', { $: 'event.recordType' }] },
        { $invoke: 'routeStore.setParam', args: ['card', { $: 'event.recordId' }] },
        { $invoke: 'shellStore.openTemplatePanel', args: ['inspector'] },
      ]);
      const pressed = (recordId: string, recordType: string) =>
        at([], { view: 'canvas' }, { event: { recordId, recordType } })(onNodeClick.$if.condition);
      expect(pressed('like', 'SignalType')).toBe(true);
      expect(pressed('Recipe', '$schema')).toBe(false);

      // Read beside a page, a definition lights its own row.
      expect(at(['feed'], { card: 'like', cardType: 'SignalType' })({ $: SELECTED_EXPR })).toBe('dna|signal|like');
      expect(at(['feed'], { card: 't1', cardType: 'TaskBlock' })({ $: SELECTED_EXPR })).not.toContain('dna|');
      // The policy is still lit by its words on the canvas.
      expect(at([], { view: 'canvas', dna: 'policy|Members can make anything.' })({ $: SELECTED_EXPR })).toBe(
        'dnaprop|policy|Members can make anything.',
      );
    });

    /*
      The lane on the right holds the inspector and the space's settings in one place, as tabs, both
      closed until opened, and folds while neither is.
    */
    it('shares the right lane between the inspector and the space settings, folded while neither is open', () => {
      const lane = findNode(
        coasys.shell,
        (n) => n.type === '$panels' && (n.props as { lane?: string }).lane === 'inspector',
      )!;
      expect((lane.props as { foldEmpty?: boolean }).foldEmpty).toBe(true);
      const panels = (
        coasys.shell.meta as {
          panels: { id: string; module?: string; home?: string; order?: number; open?: boolean }[];
        }
      ).panels;
      const right = panels.filter((panel) => panel.home === 'inspector');
      expect(right.map((panel) => [panel.id, panel.module, panel.order, panel.open])).toEqual([
        ['inspector', undefined, 0, false],
        ['settings', 'shell', 0, false],
      ]);
    });
  });
});

/** The first node under `root`, depth first, that `match` accepts — through children, slots and routes. */
function findNode(root: unknown, match: (node: { type?: string; props?: unknown }) => boolean) {
  const walk = (node: unknown): { type?: string; props?: unknown } | undefined => {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = walk(child);
        if (found) return found;
      }
      return undefined;
    }
    const n = node as { type?: string; props?: unknown };
    if (match(n)) return n;
    for (const value of Object.values(node)) {
      const found = walk(value);
      if (found) return found;
    }
    return undefined;
  };
  return walk(root);
}

describe('the lookup that read every tool as available', () => {
  /*
    The catalogue first found an item's open loan with `find(local.loans, { item: it.id })`. Its
    query includes `item`, so `item` was the record, the lookup matched nothing, and every tool
    showed "available" with no error. The validator now says so; this puts the original back into a
    copy of the catalogue to keep it saying so.
  */
  it('is reported by the validator', () => {
    const broken = JSON.parse(
      JSON.stringify(toolLibrary.sections[0]).replaceAll(
        'local.loans.find(l, l.item.id == it.id)',
        'find(local.loans, { item: it.id })',
      ),
    );
    const context = withEntities(
      buildValidationContext(contextData),
      toolLibrary.shapes.map((s) => s.name),
    );
    const warnings = validateSemantic(broken, context).errors.filter((e) =>
      e.message.includes('compares the included item'),
    );
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('the cartridges as bundles', () => {
  const bundlesDir = resolve(import.meta.dirname, '../../../../bundles');

  it.each(cartridgeBundles().map((bundle) => [bundle.id, bundle] as const))(
    '%s is checked in as `pnpm --filter @we/template-cartridges bundle` writes it',
    (id, bundle) => {
      const onDisk = JSON.parse(readFileSync(resolve(bundlesDir, bundleFileName(id)), 'utf-8'));
      expect(onDisk).toEqual(JSON.parse(JSON.stringify(bundle)));
    },
  );

  it.each(cartridgeBundles().map((bundle) => [bundle.id, bundle] as const))('%s reads as a bundle', (_id, bundle) => {
    expect(readBundle(JSON.parse(JSON.stringify(bundle))).problems).toEqual([]);
  });

  it('carries a cartridge’s modules where an install screen finds them, and no sample content', () => {
    const fieldGuideBundle = cartridgeBundles().find((bundle) => bundle.id === 'field-guide')!;
    const shell = fieldGuideBundle.templates!.find((template) => template.id === 'shell')!;
    expect(shell.meta.requires?.modules).toContain('globe');
    expect(JSON.stringify(fieldGuideBundle)).not.toContain('Levels Naturalists');
  });
});
