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

export type EvalTemplate = 'blank' | 'feed';

export interface EvalCase {
  id: string;
  template: EvalTemplate;
  request: string;
  /** True when the change is there, or a sentence saying what is missing. */
  check: (schema: SchemaNode) => true | string;
  /** A reference answer: the template with the change made by hand. */
  solve: (schema: SchemaNode) => SchemaNode;
}

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
};

export function startingTemplate(template: EvalTemplate): SchemaNode {
  return structuredClone(TEMPLATES[template]);
}

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
];
