/**
 * Validator vector inputs: a document, and what a validator reports about it.
 *
 * Each case is judged as a whole document: a template (with `meta`) or, where `fragment` is set, a
 * node on its own. The recorder runs WE's validator against WE's catalog; a case names only the core
 * catalog's vocabulary, so what it pins is the format's rule rather than a catalog's contents.
 *
 * What is compared is the set of error paths. Messages say why, for the reader, and are informative.
 *
 * Case ids are append-only: a case is never renamed or reused.
 */
import type { SchemaNode } from '@we/schema-shared';

export interface ValidateCase {
  id: string;
  note: string;
  document: unknown;
  /**
   * Record the warnings too, for a case whose point is what a validator advises. Most cases leave
   * it out: what a validator advises is its own, and only a warning the format asks for is pinned.
   */
  warnings?: true;
}

const meta = { name: 'Case', description: 'A validator case', icon: 'check' };

/** A template around `children`, valid apart from what the case puts in it. */
const template = (children: unknown[], extra: Record<string, unknown> = {}): unknown => ({
  schemaVersion: 1,
  meta,
  type: 'Column',
  children,
  ...extra,
});

const text = (...children: unknown[]): SchemaNode => ({ type: 'we-text', children }) as SchemaNode;

const C = (id: string, note: string, document: unknown, opts: { warnings?: true } = {}): ValidateCase => ({
  id,
  note,
  document,
  ...opts,
});

export const VALIDATE_CASES: ValidateCase[] = [
  /* ── valid ──────────────────────────────────────────────────────────────────────────────── */
  C('validate.valid.minimal', 'a template with a version, meta and one node is valid', template([text('Hello')])),
  C(
    'validate.valid.local-and-ref',
    'local state read in its subtree and a $ref naming a shape are valid',
    template([{ type: '$ref', props: { def: 'd1' } }, text({ $: 'local.title' })], {
      $localState: { title: { type: 'string', initial: '' } },
      $defs: { d1: { type: 'Card', children: [text('Shared')] } },
    }),
  ),

  /* ── format versions ────────────────────────────────────────────────────────────────────── */
  C('validate.version.newer', 'a format newer than the validator reads is refused before anything else', {
    ...(template([{ type: 'NoSuchThing' }]) as object),
    schemaVersion: 2,
  }),
  C('validate.version.not-a-number', 'a version that is not a whole number is refused', {
    ...(template([text('x')]) as object),
    schemaVersion: 'one',
  }),
  C('validate.version.zero', 'a version below 1 is refused', {
    ...(template([text('x')]) as object),
    schemaVersion: 0,
  }),

  /* ── structure ──────────────────────────────────────────────────────────────────────────── */
  C(
    'validate.structure.unknown-key',
    'a node carrying a key outside the closed set is invalid',
    template([{ type: 'Row', colour: 'red' }]),
  ),
  C(
    'validate.structure.child-number',
    'a child that is neither text nor an object is invalid',
    template([text('a'), 42]),
  ),
  C(
    'validate.structure.query-in-children',
    'a query in children is invalid: only an expression may stand there',
    template([{ $query: { entity: 'Post' } }]),
  ),
  C(
    'validate.structure.handler-in-children',
    'a handler in children is invalid',
    template([{ $invoke: 'navigation.navigate', args: ['~/'] }]),
  ),
  C(
    'validate.structure.defs-not-root',
    '$defs on any node but the root is invalid',
    template([{ type: 'Row', $defs: { d1: text('x') } }]),
  ),
  C(
    'validate.structure.unknown-token',
    'an object with a $ key that is no token of the format is invalid',
    template([{ type: 'we-text', props: { text: { $nope: 'x' } } }]),
  ),

  /* ── node rules ─────────────────────────────────────────────────────────────────────────── */
  C(
    'validate.if.children',
    '$if draws then or else and never children, so children on it are an error',
    template([{ type: '$if', props: { condition: true, then: text('then') }, children: [text('never')] }]),
  ),
  C(
    'validate.if.token-branch',
    'a token where $if takes a node is an error',
    template([{ type: '$if', props: { condition: true, then: { $: "'text'" } } }]),
  ),
  C(
    'validate.slot.in-template',
    "a template may not write a $slot outlet: chrome is the modules'",
    template([{ type: '$slot', props: { anchor: 'call-controls' } }]),
  ),
  C('validate.component.unknown', 'a component the catalog does not have is an error', template([{ type: 'Collumn' }])),
  C(
    'validate.element.refused',
    'a native element off the allowlist is an error',
    template([{ type: 'script', children: ['alert(1)'] }]),
  ),

  /* ── values ─────────────────────────────────────────────────────────────────────────────── */
  C(
    'validate.value.unknown-radius',
    'a radius that is not on the scale is an error',
    template([{ type: 'Card', props: { r: '42' } }]),
  ),
  C(
    'validate.value.unknown-space',
    'a spacing value that is not on the scale is an error',
    template([{ type: 'Column', props: { gap: '450' } }]),
  ),
  C(
    'validate.value.string-reference',
    'a string spelling a reference is refused: a reference is an expression',
    template([{ type: 'we-text', props: { text: '$item.name' } }]),
  ),
  C(
    'validate.expression.syntax',
    'an expression that does not parse is an error at the token',
    template([text({ $: 'a +' })]),
  ),
  C(
    'validate.expression.undeclared-local',
    'reading a local nothing declares is an error',
    template([text({ $: 'local.missing' })]),
  ),

  /* ── handlers ───────────────────────────────────────────────────────────────────────────── */
  C(
    'validate.reset-local.not-scope',
    '$resetLocal names $scope and nothing else',
    template([{ type: 'we-button', props: { onClick: { $resetLocal: 'title' } }, children: ['Reset'] }], {
      $localState: { title: { type: 'string', initial: '' } },
    }),
  ),
  C(
    'validate.set-local.undeclared',
    '$setLocal of a field no scope declares is an error',
    template([{ type: 'we-button', props: { onClick: { $setLocal: 'nope', value: 1 } }, children: ['Set'] }]),
  ),

  /* ── shared shapes ──────────────────────────────────────────────────────────────────────── */
  C(
    'validate.ref.missing',
    'a $ref naming no shape is an error, at the $ref',
    template([{ type: '$ref', props: { def: 'nope' } }], { $defs: { d1: text('x') } }),
  ),
  C(
    'validate.ref.no-defs',
    'a $ref in a document with no $defs is an error',
    template([{ type: '$ref', props: { def: 'd1' } }]),
  ),
  C(
    'validate.ref.cycle',
    'a shape that reaches itself is an error, where the cycle closes',
    template([{ type: '$ref', props: { def: 'd1' } }], {
      $defs: {
        d1: { type: 'Row', children: [{ type: '$ref', props: { def: 'd2' } }] },
        d2: { type: 'Row', children: [{ type: '$ref', props: { def: 'd1' } }] },
      },
    }),
  ),
  C(
    'validate.ref.inside-shape-reported-per-use',
    'a mistake inside a shape is reported at each place the shape is used',
    template(
      [
        { type: '$ref', props: { def: 'd1' } },
        { type: 'Row', children: [{ type: '$ref', props: { def: 'd1' } }] },
      ],
      {
        $defs: { d1: { type: 'Collumn' } },
      },
    ),
  ),

  /* ── scope ──────────────────────────────────────────────────────────────────────────────── */
  C(
    'validate.scope.route-reads-root',
    "a route reads the root's local state: lexical scope",
    template([{ type: '$routes' }], {
      $localState: { count: { type: 'number', initial: 0 } },
      routes: [{ path: '/', type: 'Column', children: [text({ $: 'local.count' })] }],
    }),
  ),
  C(
    'validate.scope.route-not-outlet',
    'a route does not read what is declared between the root and its outlet',
    template(
      [{ type: 'Column', $localState: { near: { type: 'string', initial: '' } }, children: [{ type: '$routes' }] }],
      {
        routes: [{ path: '/', type: 'Column', children: [text({ $: 'local.near' })] }],
      },
    ),
  ),
  C(
    'validate.scope.route-not-outlet-advice',
    'a route reading what is declared on the way to its outlet is told to move it to the node with routes; a route reading what is declared beside the outlet is not',
    template(
      [
        { type: 'Row', $localState: { beside: { type: 'string', initial: '' } }, children: [] },
        { type: 'Column', $localState: { near: { type: 'string', initial: '' } }, children: [{ type: '$routes' }] },
      ],
      {
        routes: [
          { path: '/', type: 'Column', children: [text({ $: 'local.near' })] },
          { path: '/beside', type: 'Column', children: [text({ $: 'local.beside' })] },
        ],
      },
    ),
    { warnings: true },
  ),
  C(
    'validate.scope.panel-not-tree-advice',
    "a panel reading what is declared below the root is told to move it to the template's root",
    {
      ...(template([
        { type: 'Column', $localState: { inner: { type: 'string', initial: '' } }, children: [] },
      ]) as object),
      meta: { ...meta, panels: [{ id: 'side', node: text({ $: 'local.inner' }) }] },
    },
    { warnings: true },
  ),
  C('validate.scope.panel-reads-root', "a panel's node reads the root's local state", {
    ...(template([text('x')], { $localState: { count: { type: 'number', initial: 0 } } }) as object),
    meta: { ...meta, panels: [{ id: 'side', node: text({ $: 'local.count' }) }] },
  }),
  C(
    'validate.node-prop.judged',
    "a component's declared node prop is judged as a node",
    template([{ type: 'FlipCard', props: { front: { type: 'Collumn' } } }]),
  ),
  C(
    'validate.node-prop.undeclared-is-data',
    'a node-shaped value in a prop the component does not declare is data, not judged',
    template([{ type: 'Card', props: { front: { type: 'Collumn' } } }]),
  ),
];
