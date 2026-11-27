/**
 * Safety vector inputs: the refusals a host makes, as render cases drawn through the host's own bag.
 *
 * Every case names its `grants`, so the template is drawn as a host draws a stranger's: a member
 * outside the grant is absent, a write nobody asked for is refused, a destructive action asks the
 * person first (`confirm` is their answer). The members are WE's catalog's, classified into the
 * capability groups the safety rules speak of; a host maps them onto its own.
 *
 * The renderer's own refusals — the element allowlist, URL and `srcdoc` props — and the first two
 * gesture cases are in `render.json` under `render.safety.*`, since a renderer runs those whatever
 * host it is in. The protected pieces are host chrome a template cannot name at all, and stay pinned
 * by the host's tests.
 *
 * Case ids are append-only.
 */
import type { SchemaNode } from '@we/schema-shared';

import type { RenderCase } from './render';

const C = (
  id: string,
  note: string,
  template: SchemaNode,
  rest: Omit<RenderCase, 'id' | 'note' | 'template'>,
): RenderCase => ({ id, note, template, ...rest });

const text = (...children: SchemaNode['children'] & unknown[]): SchemaNode => ({ type: 'we-text', children });
const button = (target: string, onClick: NonNullable<SchemaNode['props']>[string], label = target): SchemaNode => ({
  type: 'we-button',
  props: { 'data-case': target, onClick },
  children: [label],
});

export const SAFETY_CASES: RenderCase[] = [
  /* ── capability grants ──────────────────────────────────────────────────────────────────── */
  C(
    'safety.grant.read-absent',
    'a member outside the grant reads as no value, exactly like one that does not exist',
    {
      type: 'Column',
      children: [
        text({ $: "routeStore.page ?? 'absent'" }),
        text({ $: "identity.memberDids ?? 'absent'" }),
        text({ $: "spaceStore.noSuchMember ?? 'absent'" }),
      ],
    },
    {
      grants: ['identity'],
      data: { routeStore: { page: '/board' }, spaceStore: { memberDids: ['did:a'] } },
    },
  ),
  C(
    'safety.grant.invoke-absent',
    'an action outside the grant does nothing when invoked; a granted one runs',
    {
      type: 'Column',
      children: [
        button('go', { $invoke: 'navigation.navigate', args: ['~/'] }),
        button('make', { $invoke: 'record.create', args: ['Post', { title: 'x' }] }),
      ],
    },
    {
      grants: ['content'],
      actions: { 'navigation.navigate': { returns: null }, 'record.create': { returns: 'id' } },
      steps: [
        { op: 'click', target: 'go' },
        { op: 'click', target: 'make' },
      ],
    },
  ),
  C(
    'safety.grant.action-not-readable',
    'an action read in an expression is no value, so naming one can never call it',
    { type: 'Column', children: [text({ $: "record.create ?? 'not a value'" })] },
    { grants: ['content'], actions: { 'record.create': { returns: 'id' } } },
  ),
  C(
    'safety.grant.absent-no-continuation',
    'an action outside the grant does nothing, its continuations included, as for a member that does not exist',
    {
      type: 'Column',
      $localState: { said: { type: 'string', initial: 'nothing yet' } },
      children: [
        button('go', {
          $invoke: 'navigation.navigate',
          args: ['~/'],
          onSuccess: [{ $setLocal: 'said', value: { $: "result ?? 'no result'" } }],
        }),
        text({ $: 'local.said' }),
      ],
    },
    {
      grants: ['content'],
      actions: { 'navigation.navigate': { returns: 'moved' } },
      steps: [{ op: 'click', target: 'go' }],
    },
  ),

  /* ── gestures ───────────────────────────────────────────────────────────────────────────── */
  C(
    'safety.gesture.exempt-runs-unasked',
    'an exempt action (navigating) runs on an event nobody causes; a write there does not',
    {
      type: 'Column',
      children: [
        {
          type: 'we-image',
          props: {
            'data-case': 'img',
            onLoad: [
              { $invoke: 'navigation.navigate', args: ['~/loaded'] },
              { $invoke: 'record.create', args: ['Post', { title: 'on load' }] },
            ],
          },
        },
      ],
    },
    {
      grants: ['content', 'navigation'],
      actions: { 'navigation.navigate': { returns: null }, 'record.create': { returns: 'id' } },
      steps: [{ op: 'emit', target: 'img', event: 'load' }],
    },
  ),
  C(
    'safety.gesture.on-error-continuation',
    'onError counts as part of the press that started it, so a write there runs',
    {
      type: 'Column',
      children: [
        button('press', {
          $invoke: 'record.update',
          args: ['Post', 'p1', { title: 'x' }],
          onError: [{ $invoke: 'record.create', args: ['Post', { title: { $: 'result.message' } }] }],
        }),
      ],
    },
    {
      grants: ['content'],
      actions: { 'record.update': { reject: 'refused by policy' }, 'record.create': { returns: 'id' } },
      steps: [{ op: 'click', target: 'press' }],
    },
  ),
  C(
    'safety.gesture.focus-is-not-asking',
    'a field taking focus is an event that happens to it: a write wired there is refused',
    {
      type: 'Column',
      children: [
        {
          type: 'we-input',
          props: { 'data-case': 'field', onFocus: { $invoke: 'record.create', args: ['Post', { title: 'focused' }] } },
        },
      ],
    },
    {
      grants: ['content'],
      actions: { 'record.create': { returns: 'id' } },
      steps: [{ op: 'emit', target: 'field', event: 'focus' }],
    },
  ),

  /* ── confirmation of destructive actions ───────────────────────────────────────────────── */
  C(
    'safety.confirm.declined',
    'a destructive action asks first; declined, it does not run and onSuccess does not fire',
    {
      type: 'Column',
      $localState: { done: { type: 'boolean', initial: false } },
      children: [
        button('delete', {
          $invoke: 'record.delete',
          args: ['Post', 'p1'],
          onSuccess: [{ $setLocal: 'done', value: true }],
        }),
        text({ $: "local.done ? 'deleted' : 'kept'" }),
      ],
    },
    {
      grants: ['content'],
      confirm: false,
      actions: { 'record.delete': { resolve: true } },
      steps: [{ op: 'click', target: 'delete' }],
    },
  ),
  C(
    'safety.confirm.accepted',
    'accepted, the destructive action runs and its continuation follows',
    {
      type: 'Column',
      $localState: { done: { type: 'boolean', initial: false } },
      children: [
        button('delete', {
          $invoke: 'record.delete',
          args: ['Post', 'p1'],
          onSuccess: [{ $setLocal: 'done', value: true }],
        }),
        text({ $: "local.done ? 'deleted' : 'kept'" }),
      ],
    },
    {
      grants: ['content'],
      confirm: true,
      actions: { 'record.delete': { resolve: true } },
      steps: [{ op: 'click', target: 'delete' }],
    },
  ),
  C(
    'safety.confirm.not-for-ordinary-writes',
    'an ordinary write asks nothing',
    { type: 'Column', children: [button('make', { $invoke: 'record.create', args: ['Post', { title: 'x' }] })] },
    { grants: ['content'], actions: { 'record.create': { returns: 'id' } }, steps: [{ op: 'click', target: 'make' }] },
  ),
];
