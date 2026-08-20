import type { SchemaNode } from '@we/schema-shared';

/**
 * The clicked node, opened out.
 *
 * A graph draws structure and hides everything else — which is the whole reason it is readable, and
 * also why a node on its own tells you almost nothing: a dot labelled "Ship the docs" is a record
 * with six fields, and the map shows one of them. Somewhere has to answer "what is this", and that
 * is host territory rather than engine: the engine already hands over the node.
 *
 * ## Two different questions, two different answers
 *
 * **What does this record hold?** Its scalars, listed here. They arrive on the click payload
 * already, because `rowToNode` puts an entity's scalars in `data` — so reading them costs no query
 * and no expansion, and works for a node whose type nobody wrote a panel for.
 *
 * **What does it connect to?** That is a question about the *graph*, and belongs on the graph:
 * Relations and Fields both expand the node in place, so the answer appears where the question was
 * asked instead of in a list beside it. Fields is the interesting one — it opens each scalar as its
 * own node, which is the resolution level below an entity and the only way to see two records
 * meeting at a shared value.
 */

/** Clearing this is what makes an expansion a request rather than a state — see `expandRequest`. */
const CLEAR = { $setLocal: 'expandKind', value: '' };

/**
 * Selecting a node clears the last request.
 *
 * Without it, `expandRequest` would still name the previous expanders while its `id` changed to the
 * newly clicked node — and the graph would expand whatever you clicked next, in whichever way you
 * last asked. Handler arrays run in order, so this lands with the selection.
 */
export const selectNode = [{ $setLocal: 'selected', from: '$event' }, CLEAR];

/**
 * What the graph is being asked to open, derived rather than stored.
 *
 * `$setLocal`'s `value` is a literal — a token inside it is stored as the token — so a button
 * cannot write `{ id: <the selected node> }` directly. It writes which *kind* of expansion was
 * asked for, and the request is composed here from that plus whatever is selected.
 */
export const expandRequest = {
  $if: {
    condition: { $local: 'expandKind' },
    then: { id: { $local: 'selected.id' }, expanders: [{ $local: 'expandKind' }] },
    else: null,
  },
};

const openButton = (label: string, icon: string, kind: string): SchemaNode => ({
  type: 'we-button',
  props: {
    size: 'xs',
    variant: { $if: { condition: { $eq: [{ $local: 'expandKind' }, kind] }, then: 'secondary', else: 'ghost' } },
    onClick: { $setLocal: 'expandKind', value: kind },
  },
  children: [{ type: 'we-icon', props: { name: icon } }, label],
});

export const nodeDetailStrip: SchemaNode = {
  type: '$if',
  props: {
    condition: { $local: 'selected' },
    // The strip spans the window so its background and rule reach the edges; its contents sit on
    // the template's measure, like the header above. Same reasoning, same numbers.
    then: {
      type: 'Row',
      props: {
        width: '100%',
        ax: 'center',
        py: '300',
        bg: 'neutral-50',
        borderTop: '1px solid neutral-200',
      },
      children: [
        {
          type: 'Column',
          props: { width: '100%', maxWidth: 'var(--we-layout-lg)', gap: '200', px: '400' },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ay: 'center', width: '100%', wrap: true },
              children: [
                { type: 'we-badge', props: { size: 'xs' }, children: [{ $local: 'selected.type' }] },
                {
                  type: 'we-text',
                  props: { fontWeight: '600', truncate: true },
                  children: [{ $local: 'selected.label' }],
                },
                /*
                  Offered only for a node that stands for a record.

                  A property node, a literal and a synthetic cluster have no fields of their own and
                  nothing further to open, and a button that quietly does nothing is worse than one
                  that is not there.
                */
                {
                  type: '$if',
                  props: {
                    condition: { $local: 'selected.recordId' },
                    then: {
                      type: 'Row',
                      props: { gap: '100', ay: 'center', ml: 'auto' },
                      children: [
                        openButton('Relations', 'graph', 'entity'),
                        openButton('Fields', 'list-bullets', 'property'),
                      ],
                    },
                  },
                },
                {
                  type: 'we-button',
                  props: {
                    size: 'xs',
                    variant: 'ghost',
                    // `ml: auto` only when the buttons above did not already claim it, which they
                    // do whenever there is a record — otherwise the close button would be pushed
                    // right and the buttons would sit against the label.
                    onClick: [{ $setLocal: 'selected', value: null }, CLEAR],
                  },
                  children: [{ type: 'we-icon', props: { name: 'x' } }],
                },
              ],
            },

            /*
              What the record holds.

              A row of name/value pairs rather than a table: this is a strip, and the point is to be
              readable at a glance without taking the map's space. Nothing here is editable — a
              record is edited where records are edited, and a form in a status bar would be a third
              place to change something with none of the validation the other two have.
            */
            {
              type: '$if',
              props: {
                condition: { $count: { items: { $local: 'selected.fields' } } },
                then: {
                  type: 'Row',
                  props: { gap: '400', wrap: true, width: '100%' },
                  children: [
                    {
                      type: '$each',
                      props: { items: { $local: 'selected.fields' }, as: 'field' },
                      children: [
                        {
                          type: 'Row',
                          props: { gap: '100', ay: 'center' },
                          children: [
                            {
                              type: 'we-text',
                              props: { variant: 'footnote', color: 'neutral-500' },
                              children: ['$field.name'],
                            },
                            {
                              type: 'we-text',
                              props: { variant: 'footnote', truncate: true, maxWidth: '220px' },
                              children: ['$field.value'],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  },
};
