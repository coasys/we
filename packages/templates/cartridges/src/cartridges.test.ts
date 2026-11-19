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
  OTHER_APP_CLASS_NAMES,
  SPACE_TEMPLATE_CHOICES,
  templateChoice,
  themeChoice,
  VOCABULARY_OPENS,
} from '@we/template-kit';
import { describe, expect, it } from 'vitest';

import { coasysFirstRun } from './coasys/firstRun.ts';
import { canvasPane } from './coasys/space/canvas.ts';
import {
  CLASS_GROUPS,
  CLASS_ROWS,
  CLASS_ROWS_COUNT,
  classGroup,
  DNA_AT,
  dnaCrumbs,
  OTHER_CLASSES,
  RUNNING_FLOWS,
} from './coasys/space/dna.ts';
import { callPath, groupPath, personPath, SELECTED_EXPR } from './coasys/space/paths.ts';
import { treeSection } from './coasys/space/tree.ts';
import { callPage, spaceRoutes } from './coasys/space/views.ts';
import { WE_VOCABULARY } from './coasys/space/vocabulary.ts';
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
    The AI chat sparkle sat in the rail's `header`, which `railShell` places without the `px` the
    items and footer columns get — a railItem's own `railInset` is measured *against* that edge
    padding, so without it the glyph sat one inset left of every row below. The header keeps its
    place; the row inside it regains the edge it was counted against.
  */
  it('aligns the AI chat row with the rail rows below it', () => {
    const path = pathTo(coasys.app!, (n) => (n.props as { label?: unknown } | undefined)?.label === 'AI chat')!;
    expect(path.at(-1), 'no AI chat row in the rail').toBeDefined();
    const edge = path
      .slice(0, -1)
      .reverse()
      .find((n) => (n.props as { px?: unknown } | undefined)?.px !== undefined);
    expect((edge?.props as { px?: unknown } | undefined)?.px, 'no ancestor restores the rail edge').toBe('200');
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

  /*
    "Find or ask" scopes its chat to the member's *local* perspective id. `Space.uuid` is the
    creator's own local uuid, synced verbatim into every member's copy — on a joined space it names
    a perspective this device does not hold, so a chat pinned to it ran against nobody's graph (and
    on the gate, hid itself for every member but the creator). Evaluated as the renderer does.
  */
  it('asks the space chat against the local perspective, never the synced Space.uuid', () => {
    const input = findNode(
      treeSection,
      (n) => (n.props as { placeholder?: unknown } | undefined)?.placeholder === 'Find or ask',
    )!;
    const enter = (input.props as { onKeyDown: { $if: { then: { $invoke?: string; args?: { $: string }[] }[] } } })
      .onKeyDown.$if.then[0];
    expect(enter.$invoke).toBe('chatStore.openChat');
    const source = enter.args![0].$;
    expect(source).toContain('datasetStore.currentDataset.id');
    expect(source).not.toContain('spaceStore.currentSpace.uuid');

    const asked = evaluateExpression(parseExpression(source), {
      root: (name) => ({
        bound: true,
        value: {
          // A joined space: the local perspective id is not the uuid the creator's record synced in.
          datasetStore: { currentDataset: { id: 'local-perspective-uuid', sharedId: 'we://shared-cid' } },
          spaceStore: { currentSpace: { uuid: 'creator-uuid', name: 'Garden club' } },
          local: { findQuery: 'what is growing?' },
        }[name],
      }),
      call: (name, args) =>
        listFunctions()
          .find((f) => f.name === name)
          ?.impl(args, { context: {}, stores: {} }),
    });
    expect(asked).toEqual({
      perspectiveUuid: 'local-perspective-uuid',
      spaceName: 'Garden club',
      draft: 'what is growing?',
    });
  });

  /*
    A call's page is where somebody outside the call, or reading it after it ended, finds it. Its body
    is the call's Feed — the space's Feed scoped to this call: everything said, typed and answered in
    it, with the box to write into it — for everyone, and not behind the gate that offers a way in.
  */
  it('draws the call’s Feed as its body, pointed at the call the address names, to everyone', () => {
    const parts = findAll(callPage, (n) => n.type === '$part').map(
      (n) => (n.props as { id?: unknown } | undefined)?.id,
    );
    expect(parts).toContain('feed.callFeed');
    // One stream, not a transcript beside a second list.
    expect(parts).not.toContain('transcribe.transcriptFeed');
    expect(parts).not.toContain('transcribe.callMessages');

    const placement = findNode(
      callPage,
      (n) => n.type === '$part' && (n.props as { id?: unknown } | undefined)?.id === 'feed.callFeed',
    );
    expect((placement!.props as { subject?: unknown }).subject).toEqual({ $: 'routeStore.params.id' });

    // Not inside any `$if`: nothing about the reader or the call's state hides it.
    const gated = findNode(callPage, (n) => n.type === '$if' && JSON.stringify(n).includes('"feed.callFeed"'));
    expect(gated).toBeUndefined();
  });

  it('keeps the call page’s bar, its way in, and no fixed-width column that a phone cannot hold', () => {
    const json = JSON.stringify(callPage);
    expect(json).toContain('"call.renameCallButton"');
    expect(json).toContain('modules.call.continueCall');
    expect(json).not.toContain('"22rem"');
  });

  it('puts the way in under its sentence on a phone, rather than squeezing the sentence to a word a line', () => {
    const row = findNode(callPage, (n) => n.type === 'Row' && JSON.stringify(n).includes('modules.call.continueCall'));
    expect((row!.props as { wrap?: unknown }).wrap).toBe(true);
    const sentence = findNode(row!, (n) => n.type === 'we-text');
    expect((sentence!.props as { minWidth?: unknown }).minWidth).toBe('240px');
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

  it('draws "Make my identity here" disabled, with the reason, on a build that cannot make one', () => {
    const doors: SchemaNode[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      const n = node as SchemaNode;
      if (n.type === 'we-button' && JSON.stringify(n.children ?? []).includes('identityStore.custody.unlock')) {
        doors.push(n);
      }
      Object.values(n).forEach(walk);
    };
    walk(coasysFirstRun);
    expect(doors).toHaveLength(1);
    const [makeHere] = doors;
    expect((makeHere.props?.disabled as { $: string }).$).toContain("identityStore.changeBlocked != ''");
    // The detail line reads the reason first.
    expect(JSON.stringify(makeHere.children)).toContain('identityStore.changeBlocked ? identityStore.changeBlocked');
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
  describe('a call running in the space', () => {
    it('shows as its row under Calls, with a Live tag, and nowhere else in the tree', () => {
      const json = JSON.stringify(treeSection);
      // The row under Calls is the way back in; a second entry above the tree only repeated it.
      expect(json).toContain('"Live"');
      expect(json).not.toContain('Call running');
    });

    it("draws who is in it on its row: their faces, and everyone's picture and name on hover", () => {
      const stack = findNode(treeSection, (n) => n.type === 'AvatarStack')!;
      expect(JSON.stringify(stack.props)).toContain('find(modules.call.liveCalls, { recordId: call.id }).faces');
      const roster = findNode(treeSection, (n) => n.type === 'we-tooltip' && JSON.stringify(n).includes('AvatarStack'));
      expect(roster, 'the faces have no roster on hover').toBeTruthy();
      expect(JSON.stringify(roster)).toContain('person.initials');
    });
  });

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

    it('says what to do on an empty canvas, rather than the canvas’s address', () => {
      const empty = (graph.props as { empty: unknown }).empty;
      expect(at([], { view: 'canvas' })(empty)).toMatch(/^Nothing on this canvas yet\. Double-click/);
      const noCanvas = at([], { view: 'canvas' }, { spaceStore: { landmarks: {}, policy: { sentences: [] } } });
      expect(noCanvas(empty)).toMatch(/^This space has no canvas/);
    });

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
      // A class: the others dimmed, and nothing of its own.
      expect(dimmed({ dna: 'model|SignalType' })).toEqual(['states', 'rule']);
      // One of its records: its siblings as well, while what it opened into stays whole.
      expect(dimmed({ dna: 'model|SignalType|like' })).toEqual(['rating', 'states', 'rule']);
      // The policy is Social DNA too: one rule, by its words.
      expect(dimmed({ dna: 'policy|Members can make anything.' })).toEqual(['signals', 'like', 'rating', 'states']);
      // All of it, nothing dimmed.
      expect(dimmed({ dna: 'all' })).toEqual([]);

      // What the tree chose is centred: a definition, or a kind's bucket; all of it, nothing.
      const focus = (vocab.props as { focus: unknown; focusCentre: boolean }).focus;
      expect((vocab.props as { focusCentre: boolean }).focusCentre).toBe(true);
      expect(at([], { view: 'canvas', dna: 'model|SignalType|like' })(focus)).toBe('like');
      expect(at([], { view: 'canvas', dna: 'model|SignalType' })(focus)).toBe('we-graph://cluster/vocabulary/signals');
      expect(at([], { view: 'canvas', dna: 'policy|Members can make anything.' })(focus)).toBe(
        'policy:Members can make anything.',
      );
      expect(at([], { view: 'canvas', dna: 'all' })(focus)).toBe('');

      // The chosen record is opened into what it is, beside its class's bucket.
      expect(at([], { view: 'canvas', dna: 'model|SignalType|like' })(props.open)).toEqual([
        'we-graph://cluster/vocabulary/signals',
        'like',
      ]);
      // A class of the space's own or of another app is a model on the map: centred, and opened into its records.
      const models = { recordStore: { creatableEntities: [{ value: 'Sighting', group: 'This space' }] } };
      expect(at([], { view: 'canvas', dna: 'model|Sighting' }, models)(focus)).toBe('Sighting');
      expect(at([], { view: 'canvas', dna: 'model|Sighting' }, models)(props.open)).toEqual([
        'we-graph://cluster/vocabulary/models',
        'Sighting',
      ]);
      expect(at([], { view: 'canvas', dna: 'model|Question' }, models)(props.open)).toEqual([
        'we-graph://cluster/vocabulary/other',
        'Question',
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
      const onNodeClick = (vocab.props as { onNodeClick: { $if: { condition: unknown; then: unknown } }[] })
        .onNodeClick[1];
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
      expect(at(['feed'], { card: 'like', cardType: 'SignalType' })({ $: SELECTED_EXPR })).toBe('dna|model|SignalType');
      expect(at(['feed'], { card: 't1', cardType: 'TaskBlock' })({ $: SELECTED_EXPR })).not.toContain('dna|');
      // The policy is still lit by its words on the canvas.
      expect(at([], { view: 'canvas', dna: 'policy|Members can make anything.' })({ $: SELECTED_EXPR })).toBe(
        'dnaprop|policy|Members can make anything.',
      );
    });

    /*
      Pressing a node of the map only opened the inspector, so the map stayed lit for whatever the tree
      had chosen and the tree lit nothing new. It moves the focus now, as the tree does, and the tree
      opens its rows around what is lit.
    */
    it('moves the focus to what is pressed on the map, and opens the tree around it', () => {
      const map = findNode(canvasPane, (n) => n.type === '$if' && JSON.stringify(n).includes('source":"vocabulary'));
      const vocab = findNode(map, (n) => n.type === 'GraphView')!;
      const press = (vocab.props as { onNodeClick: { $if: { condition: unknown; then: { args: unknown[] } } }[] })
        .onNodeClick[0].$if;
      const focusOf = (event: Record<string, unknown>) => {
        const evaluate = at([], { view: 'canvas', dna: 'model|TaskState' }, { event });
        return evaluate(press.condition) ? [press.then.args[0], evaluate(press.then.args[1])] : null;
      };
      expect(focusOf({ type: 'vocabulary', kind: 'cluster', data: { bucket: 'signals' } })).toEqual([
        'dna',
        'model|SignalType',
      ]);
      expect(focusOf({ type: 'SignalType', recordId: 'like', data: { bucket: 'signals' } })).toEqual([
        'dna',
        'model|SignalType|like',
      ]);
      expect(focusOf({ type: '$schema', data: { bucket: 'other', entity: 'Question' } })).toEqual([
        'dna',
        'model|Question',
      ]);
      expect(focusOf({ type: '$schema', data: { bucket: 'models', entity: 'TaskBlock' } })).toEqual([
        'dna',
        'model|TaskBlock',
      ]);
      expect(focusOf({ type: 'vocabulary-item', data: { bucket: 'policy', item: 'A rule.' } })).toEqual([
        'dna',
        'policy|A rule.',
      ]);
      // What a definition is used for leaves the focus where it was.
      expect(focusOf({ type: 'TaskBlock', recordId: 't1', data: {} })).toBeNull();

      // The tree opens Social DNA and the group around a class in focus, and nothing else.
      const row = (value: string) =>
        findNode(treeSection, (n) =>
          String(JSON.stringify((n.props as { open?: unknown } | undefined)?.open)).includes(
            `((${value}) in local.openRows)`,
          ),
        )!;
      const open = (value: string, params: Record<string, string>, extra = {}) =>
        at([], params, { local: { openRows: [] }, ...extra })((row(value).props as { open: unknown }).open);
      const onCanvas = { view: 'canvas', dna: 'model|SignalType|like' };
      const we = { group: { key: 'we', classes: [{ id: 'SignalType' }, { id: 'TaskBlock' }] } };
      const other = { group: { key: 'models', classes: [{ id: 'Question' }] } };
      expect(open("'group|dna'", onCanvas)).toBe(true);
      expect(open("'dnagroup|' + group.key", onCanvas, we)).toBe(true);
      expect(open("'dnagroup|' + group.key", onCanvas, other)).toBe(false);
      expect(open("'dnagroup|' + group.key", { view: 'canvas', dna: 'all' }, we)).toBe(false);
    });

    /*
      One tree of classes: Models — the space's own and other apps', one list, another app's carrying its
      namespace — and WE's, its vocabulary first, in the settings' order and words, then its built-in
      blocks. There is no second reading to switch to.
    */
    it('lists Social DNA as classes in two groups, Models and Built in, with no lens to switch', () => {
      const evaluate = at(
        [],
        {},
        {
          recordStore: {
            creatableEntities: [
              { value: 'Sighting', label: 'Sighting', icon: 'binoculars', group: 'This space' },
              { value: 'TaskBlock', label: 'Task', icon: 'check', group: 'Built in' },
            ],
            plumbingClasses: [],
            displays: {},
          },
          datasetStore: { currentDatasetEntities: [{ name: 'Question', targetClass: 'conv://Question' }] },
        },
      );
      type Cls = { id: string; label: string };
      const groups = evaluate({ $: CLASS_GROUPS }) as {
        key: string;
        label: string;
        classes: Cls[];
        rows: Cls[];
        sub: { key: string; label: string; classes: Cls[] }[];
      }[];
      expect(groups.map((g) => [g.key, g.label])).toEqual([
        ['models', 'Models'],
        ['we', 'Built in'],
      ]);
      // The space's own model first, then another app's class, which says its namespace.
      expect(groups[0].rows.map((c) => [c.id, (c as Cls & { namespace?: string }).namespace ?? ''])).toEqual([
        ['Sighting', ''],
        ['Question', 'conv://'],
      ]);
      expect(groups[1].classes.map((c) => [c.id, c.label])).toEqual([
        ['SignalType', 'Signal types'],
        ['RelationshipType', 'Connection types'],
        ['TaskState', 'Task states'],
        ['InvolvementType', 'Involvement'],
        ['Topic', 'Topics'],
        ['TaskBlock', 'Task'],
      ]);
      // The vocabulary is listed in the group itself; the blocks sit together in one nested group.
      expect(groups[1].rows.map((c) => c.id)).toEqual([
        'SignalType',
        'RelationshipType',
        'TaskState',
        'InvolvementType',
        'Topic',
      ]);
      expect(groups[1].sub.map((s) => [s.key, s.label, s.classes.map((c) => c.id)])).toEqual([
        ['blocks', 'Blocks', ['TaskBlock']],
      ]);
      // Models lists its classes directly and nests nothing.
      expect(groups[0].sub).toEqual([]);
      const tree = JSON.stringify(treeSection);
      expect(tree).not.toContain('dnaLens');
      expect(tree).not.toContain('dnakind|signal');
      expect(tree).toContain("'dna|model|' + cls.id");
      expect(tree).toContain('group.sub');
    });

    /*
      Social DNA holds Models, Flows and Templates, then the built-in classes and the policy. The top
      level is what happens in the space: its Flows row is the flows running, counted, and Templates is
      no longer a group of its own.
    */
    it('holds Models, Flows, Templates, Built in and Policy, and leaves running flows at the top', () => {
      type Node = { type?: string; slot?: string; props?: Record<string, unknown>; children?: unknown[] };
      const label = (row: Node) =>
        ((row.children?.[0] as Node).children as Node[]).find((c) => c.type === 'we-text')?.children?.[0];
      // A group of classes is drawn by an `$each` over that one group: named here by the group it lists.
      const groupOf = (items: string) =>
        items === classGroup('models') ? 'Models' : items === classGroup('we') ? 'Built in' : items;
      const describe = (row: Node) =>
        row.type === '$each' ? groupOf((row.props?.items as { $: string }).$) : label(row);
      const tree = findNode(treeSection, (n) => n.type === 'we-tree') as Node;
      const top = tree.children as Node[];
      expect(top.map((row) => row.props?.value)).toEqual([
        { $: "'channel|' + spaceStore.root" },
        'group|calls',
        'group|workflows',
        'group|people',
        'group|dna',
        'group|themes',
      ]);
      expect(top.map(label)).toEqual(['Feed', 'Calls', 'Flows', 'People', 'Social DNA', 'Themes']);

      const dna = top.find((row) => row.props?.value === 'group|dna')!;
      const inside = (dna.children as Node[]).slice(1);
      expect(inside.map(describe)).toEqual(['Models', 'Flows', 'Templates', 'Built in', 'Policy']);
      // Every row inside Social DNA is nested in its children slot.
      for (const row of inside)
        expect(row.type === '$each' ? (row.children?.[0] as Node).slot : row.slot).toBe('children');

      // Social DNA's Flows lists the flows written, each opening as before, with the + that writes one.
      const flows = inside[1];
      expect(flows.props?.value).toBe('dnagroup|flows');
      expect(JSON.stringify(flows)).toContain("'workflow|' + workflow.name");
      expect(JSON.stringify(flows)).toContain('"New flow"');
      // Templates moved in unchanged: its rows, its + and its value, so an open tree stays open.
      expect(inside[2].props?.value).toBe('group|templates');
      expect(JSON.stringify(inside[2])).toContain('"New template"');

      // The top level's Flows counts what is running, lists no rows and so has no caret.
      const running = top[2];
      expect(running.children).toHaveLength(1);
      expect(running.props?.expandable).toBe(false);
      // What is still running, not every record that went through: a finished one is in `records` only.
      const workflows = [
        { name: 'a', archived: false, records: 2, running: 1 },
        { name: 'b', archived: false, records: 3, running: 0 },
        { name: 'c', archived: true, records: 9, running: 9 },
      ];
      expect(at([], {}, { workflowStore: { workflows } })({ $: RUNNING_FLOWS })).toBe(1);
    });

    it('reads the Social DNA page in the order the tree lists it', () => {
      const page = JSON.stringify(spaceRoutes.find((route) => route.path === '/dna'));
      const at = [
        JSON.stringify(classGroup('models')).slice(1, -1),
        '["Flows"]',
        '["Templates"]',
        JSON.stringify(classGroup('we')).slice(1, -1),
        '["Policy"]',
      ].map((part) => page.indexOf(part));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(page).not.toContain('Workflows');
    });

    it('nests no Blocks group in the built-in group when the space offers no blocks', () => {
      const evaluate = at(
        [],
        {},
        {
          recordStore: { creatableEntities: [], plumbingClasses: [], displays: {} },
          datasetStore: { currentDatasetEntities: [] },
        },
      );
      const groups = evaluate({ $: CLASS_GROUPS }) as { label: string; classes: unknown[]; sub: unknown[] }[];
      // Models is listed with nothing in it: it is one of the three things Social DNA holds.
      expect(groups.map((g) => [g.label, g.classes.length])).toEqual([
        ['Models', 0],
        ['Built in', 5],
      ]);
      expect(groups[1].sub).toEqual([]);
    });

    it('lists a vocabulary class once, as a row, even if it were ever offered as built-in content', () => {
      const evaluate = at(
        [],
        {},
        {
          recordStore: {
            creatableEntities: [
              { value: 'Topic', label: 'Topic', icon: 'hash', group: 'Built in' },
              { value: 'TaskBlock', label: 'Task', icon: 'check', group: 'Built in' },
            ],
            plumbingClasses: [],
            displays: {},
          },
          datasetStore: { currentDatasetEntities: [] },
        },
      );
      type Cls = { id: string };
      const [, builtIn] = evaluate({ $: CLASS_GROUPS }) as { rows: Cls[]; sub: { classes: Cls[] }[] }[];
      expect(builtIn.rows.map((c) => c.id)).toContain('Topic');
      expect(builtIn.sub.map((s) => s.classes.map((c) => c.id))).toEqual([['TaskBlock']]);
    });

    it('keeps the Blocks row open while a block is in focus, and not for a vocabulary class', () => {
      const row = (value: string) =>
        findNode(treeSection, (n) =>
          String(JSON.stringify((n.props as { open?: unknown } | undefined)?.open)).includes(
            `((${value}) in local.openRows)`,
          ),
        )!;
      const blocks = "'dnagroup|' + group.key + '.' + sub.key";
      const open = (dna: string) =>
        at(
          [],
          { view: 'canvas', dna },
          {
            local: { openRows: [] },
            group: { key: 'we' },
            sub: { key: 'blocks', classes: [{ id: 'TaskBlock' }] },
          },
        )((row(blocks).props as { open: unknown }).open);
      expect(open('model|TaskBlock')).toBe(true);
      expect(open('model|SignalType')).toBe(false);
    });

    /*
      Every group row opens a page in Page mode, and Social DNA's used to open the space's settings
      instead: an edit surface off to the side, for somebody who only wanted to look. It is a page of
      its own now — the vocabulary map the canvas draws — lit in the tree as the canvas's focus is.
    */
    it('shows Social DNA as a page of its own in Page mode, never the settings', () => {
      expect(JSON.stringify(treeSection)).not.toContain('"shellStore.openSpaceSettings","args":["vocabulary"');
      expect(spaceRoutes.map((route) => route.path)).toContain('/dna');
      expect(at(['dna'], { dna: 'all' })({ $: SELECTED_EXPR })).toBe('group|dna');
      expect(at(['dna'], { dna: 'model|SignalType' })({ $: SELECTED_EXPR })).toBe('dna|model|SignalType');
      expect(at(['dna'], { dna: 'model|SignalType|like' })({ $: SELECTED_EXPR })).toBe('dna|model|SignalType');
      expect(at(['dna'], { dna: 'policy' })({ $: SELECTED_EXPR })).toBe('dnakind|policy');
      // Anywhere else in Page mode, a leftover focus lights nothing.
      expect(at(['people'], { dna: 'model|SignalType' })({ $: SELECTED_EXPR })).toBe('group|people');
    });

    /*
      Bookmarks from before a class was a model: `signal`, `signal|like`, `class|Question`. Each lands
      on the class it meant, a record id kept; a kind nobody knows lands on the whole.
    */
    it('lands an old ?dna= value on the class it meant, or on all', () => {
      const focus = (dna: string) => at(['dna'], { dna })({ $: DNA_AT });
      expect(focus('signal')).toBe('model|SignalType');
      expect(focus('signal|like')).toBe('model|SignalType|like');
      expect(focus('connection')).toBe('model|RelationshipType');
      expect(focus('relationship')).toBe('model|RelationshipType');
      expect(focus('taskstate|done')).toBe('model|TaskState|done');
      expect(focus('involvement')).toBe('model|InvolvementType');
      expect(focus('topic')).toBe('model|Topic');
      expect(focus('class|Question')).toBe('model|Question');
      expect(focus('class|Question|q1')).toBe('model|Question|q1');
      expect(focus('nonsense|x')).toBe('all');
      expect(focus('model|SignalType|like')).toBe('model|SignalType|like');
      expect(focus('policy|Anyone may post')).toBe('policy|Anyone may post');
      expect(at(['dna'], {})({ $: DNA_AT })).toBe('all');
      expect(at(['dna'], { dna: 'signal' })({ $: SELECTED_EXPR })).toBe('dna|model|SignalType');
    });

    /*
      Page and Canvas showed Social DNA identically, the map in both. The canvas keeps the map — how
      the definitions connect — and the page lists them to read: a section of cards a kind, narrowed
      to the kind in focus, the chosen definition outlined.
    */
    it('lists Social DNA on its page, where the canvas draws the map', () => {
      const page = spaceRoutes.find((route) => route.path === '/dna')!;
      expect(findNode(page, (n) => n.type === 'GraphView')).toBeUndefined();
      // A class's page reads the store's list where one is named — Task states in the community's
      // order, one a slug — and queries the class otherwise.
      const query = (page.$queries as Record<string, { when: unknown }>).classRows;
      const data = {
        spaceStore: {
          spacePath: '/space/s1',
          taskStates: [
            { id: 'b', name: 'Doing' },
            { id: 'a', name: 'Done' },
          ],
        },
        local: { classRows: [{ id: 'q1', body: 'Why?' }] },
      };
      expect(at(['dna'], { dna: 'model|TaskState' }, data)({ $: CLASS_ROWS })).toEqual(data.spaceStore.taskStates);
      expect(at(['dna'], { dna: 'model|TaskState' }, data)(query.when)).toBe(false);
      expect(at(['dna'], { dna: 'model|Question' }, data)({ $: CLASS_ROWS })).toEqual(data.local.classRows);
      expect(at(['dna'], { dna: 'model|Question' }, data)(query.when)).toBe(true);
      expect(at(['dna'], { dna: 'all' }, data)(query.when)).toBe(false);
      // The record chosen is outlined.
      const card = findNode(page, (n) => n.type === 'Card' && JSON.stringify(n.props).includes('row.id'))!;
      const border = (card.props as { border: unknown }).border;
      expect(at(['dna'], { dna: 'model|Question|q1' }, { row: { id: 'q1' } })(border)).toBe('1px solid accent');
      expect(at(['dna'], { dna: 'model|Question|q1' }, { row: { id: 'q2' } })(border)).toBe('1px solid transparent');
    });

    /*
      WE's own vocabulary (signal types, connection types, topics) is read whole, by name, as it was
      before classes were models; any other class reads its newest hundred. A class page whose read is
      limited says "100+" when the limit is hit, and a record beyond the first page still has its crumb.
    */
    it("reads WE's vocabulary by name with no limit, and any other class newest first, a hundred", () => {
      const page = spaceRoutes.find((route) => route.path === '/dna')!;
      const queries = page.$queries as Record<string, Record<string, unknown>>;
      const data = { local: { vocabRows: [{ id: 'a' }], classRows: [{ id: 'q1' }] } };
      for (const cls of ['SignalType', 'RelationshipType', 'Topic']) {
        const evaluate = at(['dna'], { dna: `model|${cls}` }, data);
        expect(evaluate(queries.vocabRows.when)).toBe(true);
        expect(evaluate(queries.classRows.when)).toBe(false);
        expect(evaluate({ $: CLASS_ROWS })).toEqual(data.local.vocabRows);
      }
      expect(queries.vocabRows.order).toEqual({ name: 'asc' });
      expect(queries.vocabRows).not.toHaveProperty('limit');
      expect(queries.classRows).toMatchObject({ order: { createdAt: 'desc' }, limit: 100 });
      expect(at(['dna'], { dna: 'model|Question' }, data)(queries.vocabRows.when)).toBe(false);
      expect(at(['dna'], { dna: 'model|TaskState' }, data)(queries.vocabRows.when)).toBe(false);
    });

    it('says 100+ in the heading when a limited read is full, and still names a record beyond it', () => {
      const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${i}`, name: `Q${i}` }));
      const count = (n: number, dna = 'model|Question') =>
        at(['dna'], { dna }, { local: { classRows: rows(n), vocabRows: rows(n) } })({ $: CLASS_ROWS_COUNT });
      expect(count(100)).toBe('100+');
      expect(count(40)).toBe(40);
      expect(count(150, 'model|Topic')).toBe(150);

      const crumb = dnaCrumbs()[2].label as { $: string };
      const data = (record: unknown[]) => ({
        recordStore: { displays: { Question: { title: 'name', label: 'Question' } } },
        local: { classRows: rows(100), classRecord: record },
      });
      const at500 = { dna: 'model|Question|q500' };
      expect(at(['dna'], at500, data([{ id: 'q500', name: 'Far' }]))(crumb)).toBe('Far');
      expect(at(['dna'], at500, data([]))(crumb)).toBe('Record');
      expect(at(['dna'], { dna: 'model|Question|q3' }, data([]))(crumb)).toBe('Q3');
      const query = (spaceRoutes.find((route) => route.path === '/dna')!.$queries as Record<string, { when: unknown }>)
        .classRecord;
      expect(at(['dna'], at500, data([]))(query.when)).toBe(true);
      expect(at(['dna'], { dna: 'model|Question' }, data([]))(query.when)).toBe(false);
    });

    /*
      Every bar says where the view is as a trail: Calls › the call, People › a person, Social DNA ›
      Signal types › Like — each step but the last a way back to it, in the mode it was in.
    */
    describe('the bar’s trail', () => {
      const bar = (node: SchemaNode) =>
        findNode(node, (n) => (n.props as { minHeight?: string } | undefined)?.minHeight === '56px')!;
      type Step = { label: unknown; to?: unknown };
      const whereTo = (handler: unknown, evaluate: (p: unknown) => unknown): unknown => {
        if (Array.isArray(handler)) return whereTo(handler[handler.length - 1], evaluate);
        const h = handler as {
          $if?: { condition: unknown; then: unknown; else: unknown };
          $invoke?: string;
          args?: unknown[];
        };
        if (h.$if) return whereTo(evaluate(h.$if.condition) ? h.$if.then : h.$if.else, evaluate);
        const [first, second] = (h.args ?? []).map((arg) =>
          arg && typeof arg === 'object' && '$' in arg ? evaluate(arg) : arg,
        );
        if (h.$invoke === 'routeStore.setParam') return `?${first}=${second}`;
        const query = (second as { query?: Record<string, string> } | undefined)?.query;
        return query ? `${first}?${new URLSearchParams(query)}` : first;
      };
      const trail = (node: unknown, evaluate: (p: unknown) => unknown, to?: unknown): Step[] => {
        if (!node || typeof node !== 'object') return [];
        const n = node as SchemaNode;
        const props = (n.props ?? {}) as Record<string, unknown>;
        if (n.type === '$if') return trail(evaluate(props.condition) ? props.then : props.else, evaluate, to);
        if (n.type === 'we-button')
          return (n.children ?? []).flatMap((c) => trail(c, evaluate, whereTo(props.onClick, evaluate)));
        if (n.type === 'we-text' && props.variant === 'heading-sm') {
          const label = n.children![0];
          return [{ label: typeof label === 'object' ? evaluate(label) : label, ...(to ? { to } : {}) }];
        }
        return (n.children ?? []).flatMap((c) => trail(c, evaluate, to));
      };
      const trailAt = (node: SchemaNode, path: string[], params: Record<string, string>, extra = {}) =>
        trail(bar(node), at(path, params, { shellStore: { collapsedLanes: [] }, ...extra }));
      const route = (path: string) => spaceRoutes.find((r) => r.path === path)! as SchemaNode;
      const dnaData = {
        local: { vocabRows: [{ id: 'like', name: 'Like' }] },
        recordStore: { displays: { SignalType: { label: 'Signal type', title: 'name' } } },
        spaceStore: { spacePath: '/space/s1', taskStates: [], involvementTypes: [], policy: { sentences: [] } },
      };

      it('goes back up from a call, a person, a workflow and a channel', () => {
        expect(
          trailAt(callPage, ['record'], { kind: 'call', id: 'c1' }, { local: { callRecord: [{ title: 'Standup' }] } }),
        ).toEqual([{ label: 'Calls', to: '/space/s1/calls' }, { label: 'Standup' }]);
        expect(trailAt(route('/person'), ['person'], { did: 'did:ada' }, { person: { name: 'Ada' } })).toEqual([
          { label: 'People', to: '/space/s1/people' },
          { label: 'Ada' },
        ]);
        const open = { name: 'review', label: 'Review' };
        expect(trailAt(route('/workflows'), ['workflows'], {}, { workflowStore: { open } })).toEqual([
          { label: 'Flows', to: '/space/s1/workflows' },
          { label: 'Review' },
        ]);
        expect(trailAt(route('/workflows'), ['workflows'], {})).toEqual([{ label: 'Flows' }]);
        expect(trailAt(route('/calls'), ['calls'], {})).toEqual([{ label: 'Calls' }]);
      });

      it('goes back up through Social DNA, a class and one of its records, on its page or the canvas', () => {
        expect(trailAt(route('/dna'), ['dna'], { dna: 'model|SignalType|like' }, dnaData)).toEqual([
          { label: 'Social DNA', to: '/space/s1/dna?dna=all' },
          { label: 'Signal types', to: '/space/s1/dna?dna=model%7CSignalType' },
          { label: 'Like' },
        ]);
        expect(trailAt(route('/dna'), ['dna'], { dna: 'policy|A rule.' }, dnaData)).toEqual([
          { label: 'Social DNA', to: '/space/s1/dna?dna=all' },
          { label: 'Policy', to: '/space/s1/dna?dna=policy' },
          { label: 'A rule.' },
        ]);
        expect(trailAt(route('/dna'), ['dna'], { dna: 'all' }, dnaData)).toEqual([{ label: 'Social DNA' }]);
        // On the canvas the same steps, which stay on it.
        expect(trailAt(canvasPane, [], { view: 'canvas', dna: 'model|SignalType|like' }, dnaData)).toEqual([
          { label: 'Social DNA', to: '?dna=all' },
          { label: 'Signal types', to: '?dna=model|SignalType' },
          { label: 'Like' },
        ]);
        expect(
          trailAt(
            canvasPane,
            ['record'],
            { view: 'canvas', kind: 'call', id: 'c1' },
            { local: { focusCall: [{ title: 'Standup' }] } },
          ),
        ).toEqual([{ label: 'Calls', to: '/space/s1/calls?view=canvas' }, { label: 'Standup' }]);
        expect(trailAt(canvasPane, [], { view: 'canvas' })).toEqual([{ label: 'Canvas' }]);
      });
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

    /*
      Reading the canvas as a tree — the workshop's second mode, shared through the kit. The same
      failures worth guarding: a mode nothing on screen can turn off, an order the picker names and
      the layout does not obey, a switch that remounts the graph and loses every placement.
    */
    describe('the canvas’s tree', () => {
      const pane = JSON.stringify(canvasPane);
      const graph = findNode(canvasPane, (n) => n.type === 'GraphView')!;
      const graphJson = JSON.stringify(graph);

      it('keeps the mode, the spine and the order in the address, so a link carries the reading', () => {
        expect(pane).toContain('"treeMode":{"type":"boolean","initial":false,"syncParam":{"name":"tree","push":true}}');
        expect(pane).toContain('"spine":{"type":"string","initial":"","syncParam":"spine"}');
        expect(pane).toContain('"order":{"type":"string","initial":"manual","syncParam":"order"}');
      });

      it('puts the only way out of the mode on screen rather than in a panel', () => {
        // A panel can be closed; a state the layout obeys has to be visible and reversible.
        expect(pane).toContain('"$toggleLocal":"treeMode"');
        expect(pane).toContain('"position":"absolute"');
      });

      it('swaps the layout rather than the graph, so a switch cannot cost a placement', () => {
        /*
          One `layout` prop holding both readings: two GraphViews would unmount one and mount the
          other, throwing away the selection, the camera and every card's identity — and with them
          the placements, which the freeform reading is the keeper of. The vocabulary map beside it
          is a different graph with a layout of its own.
        */
        expect(graphJson.match(/"layout":/g)).toHaveLength(1);
        // The spine is the Workshop's, read once by `treeSpine` — nothing here decodes its spelling.
        expect(graphJson).toContain("{ type: 'forest', options: { spine: treeSpine({ value: local.spine }).selector");
        expect(graphJson).not.toContain('startsWith(local.spine');
        expect(graphJson).not.toContain('split(local.spine');
        // Freeform as it was: manual, parked at the canvas's own card size. Nothing about the
        // positions people arranged is read by the tree, so switching back finds every card.
        expect(graphJson).toContain("{ type: 'manual', options: { size: { width: 200, height: 140 }");
      });

      it('swaps the gesture rather than listing both, and keeps writing coordinates only freeform', () => {
        expect(graphJson).toContain("type: 'arrange-nodes'");
        expect(graphJson).toContain("{ type: 'drag-node', options: { pin: true } }");
        // `select` ahead of both: it does not claim the press, and needs to see it.
        expect(graphJson).toContain("'select', { type: 'arrange-nodes'");
        // A drag in the tree writes the structure the layout reads, not a position it then erases.
        expect(graphJson).toContain('"onNodeArrange":{"$invoke":"recordStore.arrangeOnTree"');
        expect(graphJson).toContain('{"$":"treeSpine({ value: local.spine })"}');
        expect(graphJson).toContain('"onNodeDragEnd":{"$invoke":"recordStore.dragOnCanvas"');
      });

      it('gives every card one box in the tree, and its own on the canvas', () => {
        expect(graphJson).toContain("local.treeMode ? ((local.cardSize == 'sm'");
        expect(graphJson).toContain("{ from: 'data.canvasWidth' }");
      });

      it('draws the connections it is not following, faintly', () => {
        expect(graphJson).toContain('{ when: treeSpine({ value: local.spine }).offSpine,');
        expect(graphJson).toContain('opacity: 0.25');
        expect(graphJson).toContain("sourceAnchor: 's', targetAnchor: 'n'");
      });

      it('follows the models’ own relations in the tree, as the spine picker offers them', () => {
        /*
          The picker lists `rel:Class.prop` spines and the layout reads `data.relation`, but those
          edges exist only when the seed is asked for them. Without `relations` a model-relation
          spine drew every card in the unconnected zone.
        */
        expect(graphJson).toContain(
          '"relations":{"$":"local.treeMode && treeSpine({ value: local.spine }).relations ? { children: true } : false"}',
        );
      });

      it('fetches the reactions whenever the tree is up, so ordering by one is a re-sort and not a reload', () => {
        expect(graphJson).toContain('"weigh":{"$":"(local.treeMode || local.order == \'signal\') && (');
      });

      it('hides the strip while the Social DNA map covers the canvas', () => {
        // The strip sits under the `$if` that reads "not on the map".
        const notOnMap = findNode(canvasPane, (n) => {
          const condition = (n.props as { condition?: { $?: unknown } } | undefined)?.condition?.$;
          return n.type === '$if' && condition === "!((routeStore.params.view == 'canvas') && routeStore.params.dna)";
        });
        expect(JSON.stringify(notOnMap)).toContain('"$toggleLocal":"treeMode"');
      });

      it('offers the spine and the order in the strip', () => {
        expect(pane).toContain('"placeholder":"Any connection"');
        // The kinds plus the space's model relations, the same list the Workshop's strip offers.
        expect(pane).toContain('treeSpines({ kinds: local.relationshipKinds, shapes: shapeStore.spaceShapes');
        expect(pane).toContain('"value":"manual"');
        expect(pane).toContain('"value":"date"');
        expect(pane).toContain('"value":"newest"');
      });
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

/** The node `match` accepts plus every ancestor above it, root first — `findNode` with a lineage. */
function pathTo(root: unknown, match: (node: { type?: string; props?: unknown }) => boolean) {
  const walk = (node: unknown): { type?: string; props?: unknown }[] | undefined => {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = walk(child);
        if (found) return found;
      }
      return undefined;
    }
    const n = node as { type?: string; props?: unknown };
    if (match(n)) return [n];
    for (const value of Object.values(node)) {
      const found = walk(value);
      if (found) return [n, ...found];
    }
    return undefined;
  };
  return walk(root);
}

/** Every node under `root` that `match` accepts, depth first, including those inside one that matched. */
function findAll(root: unknown, match: (node: { type?: string; props?: unknown }) => boolean) {
  const found: { type?: string; props?: unknown }[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (match(node as { type?: string })) found.push(node as { type?: string });
    Object.values(node).forEach(walk);
  };
  walk(root);
  return found;
}

/*
  Another app's classes, as Social DNA lists them: one template expression over the classes the space
  carries, rather than a store member grouping them — WE's plumbing is the one value it reads that a
  template could not name for itself.
*/
describe("Social DNA's classes from other apps", () => {
  const evaluate = (source: string) => {
    const roots: Record<string, unknown> = {
      datasetStore: {
        // By name, as the store publishes them.
        currentDatasetEntities: [
          { name: 'Channel', targetClass: 'flux://Channel' },
          { name: 'Nest', targetClass: 'birds://Nest' },
          { name: 'Nest', targetClass: 'birds://Nest' },
          { name: 'Question', targetClass: 'conv://Question' },
          { name: 'Sighting', targetClass: 'birds://Sighting' },
          { name: 'Space', targetClass: 'old://Space' },
          { name: 'Topic', targetClass: 'old://Topic' },
        ],
      },
      recordStore: {
        creatableEntities: [
          { value: 'Sighting', label: 'Sighting', icon: 'binoculars', group: 'This space' },
          { value: 'TaskBlock', label: 'Task', icon: 'check-square', group: 'Built in' },
        ],
        plumbingClasses: ['Space', 'SignalType'],
        displays: { Channel: { label: 'Channel' }, Question: { label: 'Question' } },
      },
    };
    return evaluateExpression(parseExpression(source), {
      root: (name) => ({ bound: name in roots, value: roots[name] }),
      call: (name, args) =>
        listFunctions()
          .find((f) => f.name === name)
          ?.impl(args, { context: {}, stores: {} }),
    });
  };

  it('lists them flat, in the order the store gives them, each with its namespace as secondary text', () => {
    expect(evaluate(OTHER_CLASSES)).toEqual([
      { id: 'Channel', label: 'Channel', icon: 'cube', namespace: 'flux://' },
      { id: 'Nest', label: 'Nest', icon: 'cube', namespace: 'birds://' },
      { id: 'Question', label: 'Question', icon: 'cube', namespace: 'conv://' },
    ]);
  });

  it("reads the same names as the vocabulary map's other bucket, and WE's vocabulary is the kit's", () => {
    expect(WE_VOCABULARY.map((c) => c.name)).toEqual(Object.keys(VOCABULARY_OPENS));
    expect(OTHER_CLASSES.startsWith(OTHER_APP_CLASS_NAMES)).toBe(true);
  });

  it("leaves WE's plumbing out, and lists a class once — not again where the space's or WE's has its name", () => {
    const names = (evaluate(OTHER_CLASSES) as { id: string }[]).map((c) => c.id);
    expect(names).not.toContain('Space');
    expect(names).not.toContain('Topic');
    expect(names).not.toContain('Sighting');
    expect(names.filter((n) => n === 'Nest')).toHaveLength(1);
  });
});

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

describe('the Coasys space chat: one mount for the channel on screen', () => {
  /*
    A recorded cold open, at General's own address (`?channel=<root>`), sent the sub-channel chat's
    reads — the channel record and the transcript's lines — then cancelled them 135 ms later and sent
    the Feed's. `root` is '' until the space's collection has been read, so for that moment General's
    address compared unequal to it and the view drew General as a sub-channel. The renderer is walked
    here as it walks the route: an `$if` mounts the branch its condition picks, a query runs when its
    `when` holds.
  */
  const FEED = 'ad4m://obj/feed';
  const chatRoute = spaceRoutes.find((route) => route.path === '/')!;

  const evaluate = (source: string, spaceStore: Record<string, unknown>) =>
    evaluateExpression(parseExpression(source), {
      root: (name) => ({
        bound: true,
        value: {
          routeStore: { params: { channel: FEED }, templateSegments: [] },
          spaceStore,
          local: {},
          modules: { transcribe: {}, call: {} },
        }[name],
      }),
      call: (name, args) =>
        listFunctions()
          .find((f) => f.name === name)
          ?.impl(args, { context: {}, stores: {} }),
    });

  /** The host parts the route mounts, and the queries it runs, for one state of the space store. */
  function mounted(spaceStore: Record<string, unknown>) {
    const parts: string[] = [];
    const icons: unknown[] = [];
    const texts: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === 'string') return void texts.push(node);
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown };
      if (n.type === 'we-icon') {
        const name = n.props?.name as string | { $: string } | undefined;
        icons.push(typeof name === 'object' && name ? evaluate(name.$, spaceStore) : name);
      }
      if (n.type === '$if') {
        const props = n.props as { condition: { $: string }; then?: unknown; else?: unknown };
        return walk(evaluate(props.condition.$, spaceStore) ? props.then : props.else);
      }
      if (n.type === '$part') parts.push((n.props as { id: string }).id);
      walk(n.children);
    };
    walk(chatRoute.children);
    const queries = Object.entries(chatRoute.$queries ?? {})
      .filter(([, q]) => {
        const when = (q as { when?: { $: string } }).when;
        return !when || Boolean(evaluate(when.$, spaceStore));
      })
      .map(([name]) => name);
    return { parts, queries, icons, texts };
  }

  it('mounts nothing for the channel until the root is known, then the Feed alone', () => {
    const before = mounted({ root: '', rootLoaded: false });
    expect(before.parts).toEqual([]);
    expect(before.queries).not.toContain('channelRecord');

    const after = mounted({ root: FEED, rootLoaded: true });
    expect(after.parts).toEqual(['feed.feedView']);
    expect(after.queries).not.toContain('channelRecord');
  });

  it('draws the bar’s glyph and its way back to Channels only once the root is known', () => {
    /*
      The same moment as above, in the bar: General's address compared unequal to an unread root, so
      the bar drew a channel's `hash` and a "Channels" crumb, then swapped both for the Feed's own.
    */
    const before = mounted({ root: '', rootLoaded: false });
    expect(before.icons).not.toContain('hash');
    expect(before.icons).not.toContain('chats-circle');
    expect(before.texts).not.toContain('Channels');

    const general = mounted({ root: FEED, rootLoaded: true });
    expect(general.icons).toContain('chats-circle');
    expect(general.texts).not.toContain('Channels');

    const sub = mounted({ root: 'ad4m://obj/other-root', rootLoaded: true });
    expect(sub.icons).toContain('hash');
    expect(sub.texts).toContain('Channels');
  });

  it('still opens a real sub-channel as chat once the root is known', () => {
    const sub = mounted({ root: 'ad4m://obj/other-root', rootLoaded: true });
    expect(sub.parts).toEqual(['transcribe.transcriptFeed']);
    expect(sub.queries).toContain('channelRecord');
  });
});

describe('the Coasys space’s lists of calls', () => {
  /*
    A recorded cold open read the space's calls whole three times over — the sidebar's twelve, and
    one more for the empty-space prompt — and a whole call carries the id of every line said in it.
    The lists draw a call's id, title and time; the prompt only asks whether there is one.
  */
  const callQueries = (node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] => {
    if (!node || typeof node !== 'object') return found;
    if (Array.isArray(node)) {
      for (const child of node) callQueries(child, found);
      return found;
    }
    const n = node as Record<string, unknown>;
    if (n.entity === 'CollectionBlock' && (n.where as { kind?: unknown } | undefined)?.kind === 'call') found.push(n);
    for (const value of Object.values(n)) callQueries(value, found);
    return found;
  };

  it('asks for only the fields a call row draws', () => {
    const queries = callQueries([treeSection, spaceRoutes]);
    expect(queries.length).toBeGreaterThanOrEqual(3);
    for (const query of queries) expect(query.select).toEqual(['title', 'createdAt']);
  });

  it('asks the empty-space prompt’s question as the sidebar asks it, so the two are one subscription', () => {
    const chatRoute = spaceRoutes.find((route) => route.path === '/')!;
    // The renderer shares a subscription between nodes asking the same question, keyed by it as JSON.
    expect(JSON.stringify(chatRoute.$queries?.anyCall)).toBe(JSON.stringify(treeSection.$queries?.calls));
  });

  it('reads the sidebar’s calls once the first screen is up, not beside the Feed’s first page', () => {
    /*
      The Feed reads its own calls for its window; the sidebar's list and the empty-space prompt are
      not on its first page, and the executor answers one read at a time.
    */
    expect(treeSection.$queries?.calls).toMatchObject({ when: { $: 'spaceStore.firstScreenOpen' } });
  });
});
