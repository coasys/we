/**
 * The edits the context eval asks for.
 *
 * Each case is a request a person would type into the template editor, the template it is made
 * against, a check on the result, and a reference solution. The check is deliberately structural
 * and lenient — it asks whether the change the request describes is there, not whether it was
 * written one particular way — because a strategy should not score badly for choosing a different
 * valid shape.
 *
 * `solve` exists for the test beside this file, not for the eval: it proves each check can be
 * satisfied by a template that validates, and the untouched template proves it cannot be satisfied
 * by doing nothing. Without both, a case that no model could pass, or that every model passes by
 * accident, would read as a result.
 */
import type { SchemaNode } from '@we/schema-shared';
import { kanbanTemplate, workshopTemplate } from '@we/template-showcase';

export type EvalTemplate = 'blank' | 'feed' | 'kanban' | 'workshop';

/**
 * How big the template a case is made against is.
 *
 * `small` is `blank` and `feed` — a template is ~1K of an ~86K payload there, so those cases
 * measure the REFERENCE half of the budget and are blind to the template half. `large` is a real
 * template somebody wrote, where the proportions invert. Keep them separable: the small suite is
 * the cheap regression that chose the editor's strategy, and a run that mixes the two cannot be
 * compared against either baseline.
 */
export type EvalScale = 'small' | 'large';

export interface EvalCase {
  id: string;
  template: EvalTemplate;
  request: string;
  /** True when the change is there, or a sentence saying what is missing. */
  check: (schema: SchemaNode) => true | string;
  /** A reference answer: the template with the change made by hand. */
  solve: (schema: SchemaNode) => SchemaNode;
}

export const scaleOf = (template: EvalTemplate): EvalScale =>
  template === 'kanban' || template === 'workshop' ? 'large' : 'small';

// ─── The starting templates ───────────────────────────────────────────────────

const TEMPLATES: Record<EvalTemplate, SchemaNode> = {
  blank: {
    type: 'Column',
    meta: { name: 'Blank', description: 'A place to start', icon: 'cube' },
    props: { bg: 'page', minHeight: '100%', p: '600', gap: '300' },
    children: [
      { type: 'we-text', props: { variant: 'heading-xl', tag: 'h1' }, children: ['Welcome'] },
      { type: 'we-text', props: { color: 'text-muted' }, children: ['A place to start building.'] },
    ],
  } as unknown as SchemaNode,

  feed: {
    type: 'Column',
    meta: { name: 'Feed', description: 'A list of posts', icon: 'newspaper' },
    props: { bg: 'page', minHeight: '100%', p: '500', gap: '400' },
    $queries: { posts: { entity: 'CollectionBlock', where: { type: 'root' }, limit: 20 } },
    children: [
      {
        type: 'Row',
        props: { ax: 'between', ay: 'center' },
        children: [
          { type: 'we-text', props: { variant: 'heading-lg', tag: 'h1' }, children: ['Posts'] },
          { type: 'we-button', props: { variant: 'primary' }, children: ['New post'] },
        ],
      },
      {
        type: 'Column',
        props: { gap: '300' },
        children: [
          {
            type: '$each',
            props: { items: { $: 'local.posts' }, as: 'post' },
            children: [
              {
                type: 'Card',
                children: [
                  { type: 'we-text', props: { variant: 'heading-sm' }, children: [{ $: 'post.title' }] },
                  { type: 'we-text', children: [{ $: 'post.textContent' }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as SchemaNode,

  /*
    A real template, imported rather than copied, because a frozen snapshot would stop being a
    real template the first time somebody edited the live one — and because the per-case test
    beside this file then fails the moment an edit invalidates a case, which is the signal wanted.

    Kanban is the middle rung on purpose. Templates in this repo run from 1,888 chars (`pollsView`)
    to 571,024 (`workshopTemplate`); kanban is 57,440, which compacts to 37,516 with five `$defs`.
    Big enough that what the editor sends is mostly template rather than mostly reference, small
    enough to run 51 times, and — the part neither `blank` nor `feed` can offer — it SHARES shapes:
    the card is used four times and the column header twice, so "change every card" and "change
    this one card" are different edits with different correct answers.
  */
  kanban: kanbanTemplate as unknown as SchemaNode,

  /*
    The template the bounding work exists for, and the only one here that does not fit.

    571,024 characters authored, 400,460 compacted — about 100K tokens, so a whole-template turn
    is ~146K against a 200K window and an outline turn is ~73K. Both run, which is what makes the
    comparison possible at all; a year of template growth and only one of them would.

    Two cases, deliberately few: each whole-template call costs about as much as a whole run of
    the kanban suite.
  */
  workshop: workshopTemplate as unknown as SchemaNode,
};

export function startingTemplate(template: EvalTemplate): SchemaNode {
  return structuredClone(TEMPLATES[template]);
}

export const EVAL_TEMPLATES = Object.keys(TEMPLATES) as EvalTemplate[];

// ─── Looking at a result ──────────────────────────────────────────────────────

type Node = Omit<SchemaNode, 'routes' | 'children' | 'props'> & {
  type: string;
  props?: Record<string, unknown>;
  children?: unknown[];
  routes?: unknown[];
  $localState?: Record<string, { type?: string; validate?: unknown[] }>;
  $queries?: Record<string, Record<string, unknown>>;
};

/** Every node in the tree, including ones held in props (`then`, `else`) and routes. */
export function nodes(root: unknown): Node[] {
  const found: Node[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.type === 'string') found.push(record as Node);
    Object.values(record).forEach(visit);
  };
  visit(root);
  return found;
}

/** A node's text: literal strings, expression sources and the `text`/`label` props, from it and below. */
export function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (!node || typeof node !== 'object') return '';
  const record = node as Node & { $?: string };
  if (typeof record.$ === 'string') return record.$;
  const own = [record.props?.text, record.props?.label].filter((v) => typeof v === 'string').join(' ');
  return [own, textOf(record.children ?? [])].join(' ');
}

/** The whole tree as JSON — for "is this handler or expression anywhere". */
const source = (schema: SchemaNode) => JSON.stringify(schema);

const ofType = (schema: SchemaNode, ...types: string[]) => nodes(schema).filter((n) => types.includes(n.type ?? ''));

const expect = (ok: boolean, missing: string): true | string => (ok ? true : missing);

const all = (...checks: (true | string)[]): true | string => checks.find((c) => c !== true) ?? true;

/** Local fields declared anywhere, by name. */
const localFields = (schema: SchemaNode) =>
  Object.assign({}, ...nodes(schema).map((n) => n.$localState ?? {})) as Record<
    string,
    { type?: string; validate?: unknown[] }
  >;

const root = (schema: SchemaNode) => schema as unknown as Node;

/** A clone with `edit` applied, for the reference solutions. */
const edited = (schema: SchemaNode, edit: (root: Node) => void): SchemaNode => {
  const copy = structuredClone(schema) as unknown as Node;
  edit(copy);
  return copy as unknown as SchemaNode;
};

/** The feed's list of posts, the `$each` the cases change. */
const postList = (r: Node) => (r.children![1] as Node).children as Node[];
const postCard = (r: Node) => (postList(r)[0].children as Node[])[0];

// ─── Looking at a large template ──────────────────────────────────────────────

/*
  The small cases reach their target by position — `r.children![1]` — which is fine in a template
  of six nodes and unusable in one of 280. These find a node by what it IS, so a case keeps
  working when somebody adds a row above it, and says what it meant when somebody removes it.
*/

/** Every node matching, anywhere in the tree. */
const matching = (schema: SchemaNode, is: (n: Node) => boolean) => nodes(schema).filter(is);

/** The one node matching — throws when a solve's assumption about the template has expired. */
const only = (schema: SchemaNode, what: string, is: (n: Node) => boolean): Node => {
  const found = matching(schema, is);
  if (found.length !== 1) throw new Error(`expected exactly one ${what} in the template, found ${found.length}`);
  return found[0];
};

/** How many times a string occurs in the tree — for an edit whose rightness is a COUNT. */
const occurrences = (schema: SchemaNode, needle: string) => source(schema).split(needle).length - 1;

/**
 * The card: a `Column` carrying the card's own surface. Exactly four, identical, all `r: '300'` —
 * which is to say one shared shape used four times.
 *
 * Worth knowing when writing a case against them: the authored template ALIASES, so those four
 * positions are two objects used twice each (the whole template is 280 positions over 211
 * objects, because a fragment called twice with the same arguments returns the same value).
 * Mutating one of them in a `solve` therefore changes two cards, not one.
 */
const isCardBody = (n: Node) =>
  n.type === 'Column' && n.props?.bg === 'surface' && 'border' in (n.props ?? {}) && 'r' in (n.props ?? {});

const cardBodies = (schema: SchemaNode) => matching(schema, isCardBody);

// ─── The cases ───────────────────────────────────────────────────────────────

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'rename-heading',
    template: 'blank',
    request: "Change the heading so it says 'Welcome back'.",
    check: (s) =>
      expect(
        ofType(s, 'we-text').some((n) => textOf(n).includes('Welcome back')),
        'no heading says Welcome back',
      ),
    solve: (s) => edited(s, (r) => ((r.children![0] as Node).children = ['Welcome back'])),
  },
  {
    id: 'page-background',
    template: 'blank',
    request: 'Make the page background the sunken surface colour.',
    check: (s) => expect(root(s).props?.bg === 'surface-sunken', `root bg is ${String(root(s).props?.bg)}`),
    solve: (s) => edited(s, (r) => (r.props!.bg = 'surface-sunken')),
  },
  {
    id: 'remove-subtitle',
    template: 'blank',
    request: 'Remove the line of text under the heading.',
    check: (s) => expect(!source(s).includes('A place to start building.'), 'the subtitle is still there'),
    solve: (s) => edited(s, (r) => r.children!.splice(1, 1)),
  },
  {
    id: 'navigate-button',
    template: 'blank',
    request: "Add a primary button labelled 'Get started' that goes to the /start page.",
    check: (s) =>
      expect(
        ofType(s, 'we-button').some(
          (n) =>
            textOf(n).includes('Get started') && JSON.stringify(n.props ?? {}).match(/routeStore\.navigate.*\/start/),
        ),
        'no Get started button navigating to /start',
      ),
    solve: (s) =>
      edited(s, (r) =>
        r.children!.push({
          type: 'we-button',
          props: { variant: 'primary', onClick: { $action: 'routeStore.navigate', args: ['/start'] } },
          children: ['Get started'],
        }),
      ),
  },
  {
    id: 'my-avatar',
    template: 'blank',
    request: 'Show my avatar and my name above the heading.',
    check: (s) =>
      all(
        expect(ofType(s, 'we-avatar').length > 0, 'no avatar'),
        expect(
          /profileStore\.ownProfile|me\.avatar|me\.name/.test(source(s)),
          'nothing reads the current agent’s profile',
        ),
      ),
    solve: (s) =>
      edited(s, (r) =>
        r.children!.unshift({
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            {
              type: 'we-avatar',
              props: { image: { $: 'profileStore.ownProfile.avatar' }, hash: { $: 'me.did' }, size: 'sm' },
            },
            { type: 'we-text', children: [{ $: 'profileStore.ownProfile.name' }] },
          ],
        }),
      ),
  },
  {
    id: 'member-names',
    template: 'blank',
    request: 'Below the heading, list the names of the members of this space.',
    check: (s) =>
      expect(
        ofType(s, '$each').some((n) => /spaceStore\.(members|memberDids)/.test(JSON.stringify(n.props ?? {}))),
        'no list over the space’s members',
      ),
    solve: (s) =>
      edited(s, (r) =>
        r.children!.splice(1, 0, {
          type: '$each',
          props: { items: { $: 'spaceStore.members' }, as: 'member' },
          children: [{ type: 'we-text', children: [{ $: 'member.name' }] }],
        }),
      ),
  },
  {
    id: 'todo-tasks',
    template: 'blank',
    request: "Show the titles of the tasks in this space whose status is 'todo'.",
    check: (s) =>
      all(
        expect(/"entity":"TaskBlock"/.test(source(s)), 'nothing queries TaskBlock'),
        expect(/"status":"todo"/.test(source(s)) || /status == 'todo'/.test(source(s)), 'nothing filters on todo'),
        expect(/\.title/.test(source(s)), 'no task title is rendered'),
      ),
    solve: (s) =>
      edited(s, (r) => {
        r.$queries = { tasks: { entity: 'TaskBlock', where: { status: 'todo' } } };
        r.children!.push({
          type: '$each',
          props: { items: { $: 'local.tasks' }, as: 'task' },
          children: [{ type: 'we-text', children: [{ $: 'task.title' }] }],
        });
      }),
  },
  {
    id: 'tabs-with-pages',
    template: 'blank',
    request: 'Add two tabs, Posts and Members, under the heading. Each tab should show its own page.',
    check: (s) => {
      const paths = (root(s).routes ?? []).map((route) => (route as { path?: string }).path);
      return all(
        expect(ofType(s, 'we-tab').length >= 2, 'fewer than two tabs'),
        expect(paths.includes('/posts') && paths.includes('/members'), `root routes are ${JSON.stringify(paths)}`),
        expect(ofType(s, '$routes').length > 0, 'no $routes outlet'),
      );
    },
    solve: (s) =>
      edited(s, (r) => {
        r.routes = [
          { path: '/posts', type: 'we-text', children: ['Posts page'] },
          { path: '/members', type: 'we-text', children: ['Members page'] },
        ];
        r.children!.splice(1, 0, {
          type: 'we-tabs',
          props: { selectedKey: { $: 'routeStore.segments[0]' } },
          children: [
            {
              type: 'we-tab',
              props: { key: 'posts', label: 'Posts', onClick: { $action: 'routeStore.navigate', args: ['/posts'] } },
            },
            {
              type: 'we-tab',
              props: {
                key: 'members',
                label: 'Members',
                onClick: { $action: 'routeStore.navigate', args: ['/members'] },
              },
            },
          ],
        });
        r.children!.push({ type: '$routes' });
      }),
  },
  {
    id: 'required-email',
    template: 'blank',
    request: 'Add a form with a required email field that shows its error, and a Submit button.',
    check: (s) => {
      const fields = Object.values(localFields(s));
      return all(
        expect(
          fields.some((f) => JSON.stringify(f.validate ?? []).includes('required')),
          'no local field with a required rule',
        ),
        expect(/error\('/.test(source(s)), 'no error() shown'),
        expect(
          ofType(s, 'we-button').some((n) => /submit/i.test(textOf(n))),
          'no Submit button',
        ),
      );
    },
    solve: (s) =>
      edited(s, (r) => {
        r.$localState = {
          email: { type: 'string', initial: '', validate: [{ rule: 'required', message: 'Email is required' }] },
        } as never;
        r.children!.push(
          {
            type: 'we-form-field',
            props: { label: 'Email', error: { $: "error('email')" } },
            children: [
              {
                type: 'we-input',
                props: {
                  type: 'email',
                  value: { $: 'local.email' },
                  onInput: { $setLocal: 'email', value: { $: 'event.detail' } },
                },
              },
            ],
          },
          { type: 'we-button', props: { onClick: { $touch: '$all' } }, children: ['Submit'] },
        );
      }),
  },
  {
    id: 'settings-link',
    template: 'blank',
    request: 'Add a gear icon button next to the heading that opens /settings.',
    check: (s) =>
      all(
        expect(
          ofType(s, 'we-icon').some((n) => n.props?.name === 'gear'),
          'no gear icon',
        ),
        expect(/\/settings/.test(source(s)), 'nothing goes to /settings'),
      ),
    solve: (s) =>
      edited(s, (r) => {
        const heading = r.children!.shift();
        r.children!.unshift({
          type: 'Row',
          props: { ax: 'between', ay: 'center' },
          children: [
            heading,
            {
              type: 'we-button',
              props: { variant: 'ghost', onClick: { $action: 'routeStore.navigate', args: ['/settings'] } },
              children: [{ type: 'we-icon', props: { name: 'gear' } }],
            },
          ],
        });
      }),
  },
  {
    id: 'post-count-badge',
    template: 'feed',
    request: 'Show a badge with the number of posts next to the Posts heading.',
    check: (s) =>
      expect(
        ofType(s, 'we-badge').some((n) => /count\(local\.posts\)/.test(JSON.stringify(n))),
        'no badge counting posts',
      ),
    solve: (s) =>
      edited(s, (r) => {
        const header = r.children![0] as Node;
        const heading = header.children!.shift();
        header.children!.unshift({
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [heading, { type: 'we-badge', children: [{ $: 'count(local.posts)' }] }],
        });
      }),
  },
  {
    id: 'search-box',
    template: 'feed',
    request: 'Add a search box above the posts that keeps what is typed in local state.',
    check: (s) => {
      const strings = Object.entries(localFields(s)).filter(([, f]) => f.type === 'string');
      return all(
        expect(strings.length > 0, 'no string local field'),
        expect(
          strings.some(([name]) => new RegExp(`"\\$setLocal":"${name}"`).test(source(s))),
          'nothing writes the search text',
        ),
        expect(ofType(s, 'we-input', 'Search').length > 0, 'no input'),
      );
    },
    solve: (s) =>
      edited(s, (r) => {
        r.$localState = { search: { type: 'string', initial: '' } } as never;
        r.children!.splice(1, 0, {
          type: 'we-input',
          props: {
            placeholder: 'Search posts',
            value: { $: 'local.search' },
            onInput: { $setLocal: 'search', value: { $: 'event.detail' } },
          },
        });
      }),
  },
  {
    id: 'empty-state',
    template: 'feed',
    request: "When there are no posts, show 'No posts yet' instead of the list.",
    check: (s) =>
      all(
        expect(/No posts yet/.test(source(s)), 'no No posts yet text'),
        expect(
          ofType(s, '$if').some((n) => /count\(local\.posts\)/.test(JSON.stringify(n.props?.condition))),
          'no condition on the post count',
        ),
      ),
    solve: (s) =>
      edited(s, (r) => {
        const list = r.children!.splice(1, 1)[0];
        r.children!.push({
          type: '$if',
          props: {
            condition: { $: 'count(local.posts)' },
            then: list,
            else: { type: 'we-text', props: { color: 'text-faint' }, children: ['No posts yet'] },
          },
        });
      }),
  },
  {
    id: 'responsive-grid',
    template: 'feed',
    request: 'Lay the posts out as a grid: one column on phones and three on wide screens.',
    check: (s) =>
      expect(
        ofType(s, 'Grid').some((n) => {
          const props = JSON.stringify(n.props ?? {});
          return /minChildWidth/.test(props) || /UpProps":\{[^}]*"columns":3/.test(props);
        }),
        'no Grid that changes its columns with width',
      ),
    solve: (s) =>
      edited(s, (r) => {
        const column = r.children![1] as Node;
        column.type = 'Grid';
        column.props = { columns: 1, gap: '300', mdUpProps: { columns: 3 } };
      }),
  },
  {
    id: 'card-style',
    template: 'feed',
    request: 'Give each post card a raised surface background, a medium shadow and rounded corners.',
    check: (s) => {
      const card = ofType(s, '$each')
        .flatMap((n) => nodes(n.children))
        .find((n) => n.props?.shadow);
      return all(
        expect(!!card, 'no post card has a shadow'),
        expect(card?.props?.bg === 'surface-raised', `card bg is ${String(card?.props?.bg)}`),
        expect(card?.props?.shadow === 'md', `card shadow is ${String(card?.props?.shadow)}`),
        expect(!!card?.props?.r, 'card has no radius'),
      );
    },
    solve: (s) => edited(s, (r) => (postCard(r).props = { bg: 'surface-raised', shadow: 'md', r: 'surface' })),
  },
  {
    id: 'toggle-list',
    template: 'feed',
    request: 'Add a button beside the heading that shows and hides the list of posts.',
    check: (s) =>
      all(
        expect(/"\$toggleLocal"|"\$setLocal"/.test(source(s)), 'nothing toggles local state'),
        expect(
          ofType(s, '$if', '$animate').some((n) => /local\./.test(JSON.stringify(n.props?.condition))),
          'the list is not conditional on local state',
        ),
      ),
    solve: (s) =>
      edited(s, (r) => {
        r.$localState = { showPosts: { type: 'boolean', initial: true } } as never;
        const header = r.children![0] as Node;
        header.children!.push({
          type: 'we-button',
          props: { variant: 'ghost', onClick: { $toggleLocal: 'showPosts' } },
          children: ['Toggle'],
        });
        const list = r.children!.splice(1, 1)[0];
        r.children!.push({ type: '$if', props: { condition: { $: 'local.showPosts' }, then: list } });
      }),
  },
  {
    id: 'delete-with-confirm',
    template: 'feed',
    request:
      "Add a delete button to each post card. It should ask 'Delete this post?' in a dialog, and only then delete the post with spaceStore.deleteCollection.",
    check: (s) =>
      all(
        expect(ofType(s, 'we-modal').length > 0, 'no dialog'),
        expect(/Delete this post\?/.test(source(s)), 'the dialog does not ask Delete this post?'),
        expect(/spaceStore\.deleteCollection/.test(source(s)), 'nothing calls spaceStore.deleteCollection'),
      ),
    solve: (s) =>
      edited(s, (r) => {
        const card = postCard(r);
        card.$localState = { confirmOpen: { type: 'boolean', initial: false } } as never;
        card.children!.push(
          {
            type: 'we-button',
            props: { variant: 'danger', onClick: { $setLocal: 'confirmOpen', value: true } },
            children: ['Delete'],
          },
          {
            type: '$if',
            props: {
              condition: { $: 'local.confirmOpen' },
              then: {
                type: 'we-modal',
                props: { size: 'sm', close: { $setLocal: 'confirmOpen', value: false } },
                children: [
                  { type: 'we-text', props: { variant: 'heading-md' }, children: ['Delete this post?'] },
                  {
                    type: 'we-button',
                    props: {
                      variant: 'danger',
                      onClick: {
                        $action: 'spaceStore.deleteCollection',
                        args: [{ $: 'post.id' }],
                        onSuccess: [{ $setLocal: 'confirmOpen', value: false }],
                      },
                    },
                    children: ['Delete'],
                  },
                ],
              },
            },
          },
        );
      }),
  },

  // ─── Against a real template ───────────────────────────────────────────────
  /*
    These exist because the cases above cannot fail for the reason the planned work on bounding
    what the editor sends — a skeleton of the template, plus full detail for the part a request
    implicates — is about. On `blank` the template is ~400 chars of an ~86K payload, so a strategy
    that sent no template at all would still pass most of them. Here the template is the larger
    half, there are 280 nodes to find the right one among, and — the part that nothing else in
    this file reaches — four of those nodes are the SAME node, shared through `$defs`.

    `kanban-card-radius` is the shared-shape case: the four cards are one shape, so the edit is
    right only when all four change together. A model that patches a single use leaves three
    cards square.

    There was a second one — "change just these cards, leave the others" — meant to force a
    `split`. It was removed after a calibration run, because the model was right and it was
    wrong: asked to restyle the cards in one column, it pointed out that nothing in this template
    draws the unplaced cards as their own group, and that the way to do it is a CONDITION inside
    the shared shape rather than a copy of the shape. That is the better engineering answer, so
    the case was scoring the wrong thing. A real split case needs two uses that differ by their
    CONTEXT rather than by their data; see the follow-ups in the PR description.
  */
  {
    id: 'kanban-card-radius',
    template: 'kanban',
    request: 'Make the cards on a board more rounded.',
    /*
      Every card, because the request says "the cards". They are one shape used four times, so the
      edit belongs in the definition — a model that patches a single `$ref`'s target leaves three
      cards square and scores nothing. The check does not care WHICH radius, only that none is
      left at the old one.
    */
    check: (s) => {
      const bodies = cardBodies(s);
      const unchanged = bodies.filter((n) => n.props?.r === '300').length;
      return all(
        expect(bodies.length === 4, `expected the four cards, found ${bodies.length}`),
        expect(unchanged === 0, `${unchanged} of ${bodies.length} cards still have the old radius`),
      );
    },
    solve: (s) => edited(s, (r) => cardBodies(r as unknown as SchemaNode).forEach((n) => (n.props!.r = '500'))),
  },
  // ─── Against the template that does not fit ───────────────────────────────
  /*
    Two cases on `workshopTemplate`, which is the one the bounding work exists for: 3,068 nodes
    and 400,460 characters compacted, so a whole-template turn is ~146K tokens and an outline
    turn ~73K. Both still run, which is the only reason the two can be compared — the point of
    measuring now rather than after another year of template growth.

    Each asks for a change to one node among three thousand, which is the thing bounding makes
    harder: with the whole tree present the node is simply there, and from an outline it has to
    be found by what it says and then fetched or patched blind. Both targets appear exactly once
    in the template, so neither request can be read two ways — the lesson of the case #253
    removed.
  */
  {
    id: 'workshop-empty-replies',
    template: 'workshop',
    request:
      "The discussion panel says 'No replies yet.' when a thread is empty — change it to 'Nothing here yet — start the conversation.'",
    check: (s) =>
      all(
        expect(occurrences(s, 'Nothing here yet') > 0, 'the new empty-state text is not there'),
        expect(occurrences(s, 'No replies yet.') === 0, 'the old text is still there'),
      ),
    solve: (s) =>
      edited(s, (r) => {
        const text = only(r as unknown as SchemaNode, "'No replies yet.' node", (n) =>
          (n.children ?? []).includes('No replies yet.'),
        );
        text.children = ['Nothing here yet — start the conversation.'];
      }),
  },
  {
    id: 'workshop-unfold-variant',
    template: 'workshop',
    request: "Make the 'Unfold all' button a secondary button instead of a ghost one.",
    /*
      A PROP change on a node found by its text, which is the case bounding is most exposed on:
      an outline carries no props at all, so the model either fetches the node or patches it
      blind. Blind is safe here — `mergeNode` preserves what a patch does not mention — and the
      second clause is what proves it: the button's `onClick` must survive. A model that replaced
      the node wholesale instead of merging would lose it, and the button would go dead while
      looking right.
    */
    check: (s) => {
      const button = matching(s, (n) => (n.children ?? []).includes('Unfold all'));
      return all(
        expect(button.length === 1, `expected one 'Unfold all' button, found ${button.length}`),
        expect(button[0]?.props?.variant === 'secondary', `variant is ${String(button[0]?.props?.variant)}`),
        expect(Boolean(button[0]?.props?.onClick), 'the button lost its onClick'),
      );
    },
    solve: (s) =>
      edited(s, (r) => {
        const button = only(r as unknown as SchemaNode, "'Unfold all' button", (n) =>
          (n.children ?? []).includes('Unfold all'),
        );
        button.props!.variant = 'secondary';
      }),
  },
  {
    id: 'kanban-empty-icon',
    template: 'kanban',
    request: 'The empty message on the boards list has a kanban icon — use a folder icon instead.',
    /*
      One node among 280, and among seventeen `we-icon`s. Nothing structural identifies it; the
      only handle is the word "kanban" in the request matching the icon's name, which is exactly
      the preselection a relevance budget has to get right.
    */
    check: (s) =>
      all(
        expect(
          matching(s, (n) => n.type === 'we-icon' && String(n.props?.name ?? '').includes('folder')).length > 0,
          'no folder icon',
        ),
        expect(
          matching(s, (n) => n.type === 'we-icon' && n.props?.name === 'kanban').length === 0,
          'the kanban icon is still there',
        ),
      ),
    solve: (s) =>
      edited(s, (r) => {
        only(
          r as unknown as SchemaNode,
          'kanban icon',
          (n) => n.type === 'we-icon' && n.props?.name === 'kanban',
        ).props!.name = 'folder-open';
      }),
  },
  {
    id: 'kanban-remove-load-more',
    template: 'kanban',
    request: 'Take the Load more button off the boards list.',
    /*
      Deletion in a large tree. Worth its own case because the patch format's `children` semantics
      make removal the awkward direction: an array replaces wholesale, so a model working from a
      skeleton that elided its siblings can delete the button and its neighbours together. The
      second clause is what catches that.
    */
    check: (s) =>
      all(
        expect(occurrences(s, 'Load more') === 0, 'the Load more button is still there'),
        expect(occurrences(s, 'New board') > 0, 'the New board button was removed too'),
      ),
    solve: (s) =>
      edited(s, (r) => {
        const button = only(
          r as unknown as SchemaNode,
          'Load more button',
          (n) => n.type === 'we-button' && textOf(n).includes('Load more'),
        );
        const parent = only(
          r as unknown as SchemaNode,
          'row holding the Load more button',
          (n) => Array.isArray(n.children) && n.children.includes(button),
        );
        parent.children = (parent.children as unknown[]).filter((c) => c !== button);
      }),
  },
  {
    id: 'kanban-back-tooltip',
    template: 'kanban',
    request: "Put a tooltip saying 'All boards' on the button that goes back from a board to the list.",
    /*
      The target is named by what it DOES, not by anything written on it — it is an icon button
      with no text at all. So the model has to work out that the arrow-left button in the board
      header is the back button, which no keyword match on the request will do for it.
    */
    check: (s) => {
      const tips = matching(s, (n) => n.type === 'we-tooltip' && String(n.props?.content ?? '') === 'All boards');
      return all(
        expect(tips.length > 0, "no tooltip says 'All boards'"),
        expect(
          tips.some((t) => matching(t as unknown as SchemaNode, (n) => n.props?.name === 'arrow-left').length > 0),
          "the 'All boards' tooltip is not on the back button",
        ),
      );
    },
    solve: (s) =>
      edited(s, (r) => {
        const icon = only(r as unknown as SchemaNode, 'arrow-left icon', (n) => n.props?.name === 'arrow-left');
        const button = only(
          r as unknown as SchemaNode,
          'back button',
          (n) => Array.isArray(n.children) && n.children.includes(icon),
        );
        const parent = only(
          r as unknown as SchemaNode,
          'row holding the back button',
          (n) => Array.isArray(n.children) && n.children.includes(button),
        );
        parent.children = (parent.children as unknown[]).map((c) =>
          c === button ? { type: 'we-tooltip', props: { content: 'All boards' }, children: [button] } : c,
        );
      }),
  },
];
