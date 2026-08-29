import type { SchemaNode } from '@we/schema-shared';

/**
 * A page for one record.
 *
 * ## Why a page rather than an expanded card
 *
 * Everything a community makes has, until now, only ever been visible inside a list. A call, a post,
 * a sighting — you could expand its card, and that was the whole of "look at this one thing". Two
 * problems with that, and the second is the one that decided it.
 *
 * A card is bounded by its list. The Cards route paginates at twenty, so a record older than that
 * cannot be reached by expanding anything, and the route's `displayMode` already owns expand and
 * collapse *for the whole list* — a second, per-card meaning of the same word would be two
 * mechanisms fighting over one idea.
 *
 * And a card has no address. Sending somebody a link to a thing is table stakes — it is how Twitter,
 * Reddit and every forum since have worked — and it cannot be built on a state that lives inside a
 * list's local state.
 *
 * ## Why the entity is in the path
 *
 * `/record/:entity` rather than `/record` alone. A schema cannot ask "what type is this id?" —
 * `$query` needs an entity to query, and there is no lookup that answers it without the backend
 * scanning every class. Carrying the type costs a path segment and buys a page that works for a
 * model this community defined this morning.
 *
 * That is also how the rest of the codebase already passes records around: the graph's node payloads
 * carry `recordType` beside `recordId`, and `recordStore.placeOnBoard` takes both. Nothing here is
 * inventing a convention.
 *
 * ## Why the id is *not* in the path
 *
 * It cannot be. A record's id is a URI — `ad4m://obj/<random>` — so as a path segment it is five
 * segments, and `/record/:entity/:recordId` simply does not match. That was the first two attempts
 * at this route, and the failure is silent in the worst way: the URL looks plausible and the
 * template's not-found renders.
 *
 * Percent-encoding it would work and costs more than it buys: the schema layer has no encode
 * function, Solid Router does not decode route params, so it would need a matching decode on the way
 * out, and a mismatch between the two is another silent wrong-page. A query value takes `:` and `/`
 * literally, and `URLSearchParams` hands it back exactly as written.
 *
 * This bends the tier rule in `routing-and-view-state.md`, which puts identity in the path — noted
 * there, because the reason is a property of AD4M's ids rather than a preference.
 *
 * ## Why the entity is read from the end
 *
 * A shell decides where its sections live — the default template puts them under `/space/:spaceId`,
 * a showcase template may route at the root — so a fixed segment index would be right for one shell
 * and wrong for the next. The last segment is the entity wherever the route was mounted.
 */
/**
 * The route this page is mounted at.
 *
 * Exported rather than written at the injection site because the host reads it twice: once to place
 * the route, and once to take its first segment, so the index redirect knows `record` is not a
 * section it should bounce somebody off. That redirect did exactly that on the first attempt —
 * silently, so every expand button appeared to navigate to About.
 */
export const RECORD_ROUTE_PATH = '/record/:entity';

const entityExpr = { $: 'last(routeStore.segments)' };
const idExpr = { $: 'routeStore.params.id' };

/**
 * One detail field, drawn from what the model says it is.
 *
 * The kinds come from `recordStore.displays` and are resolved once in the store, so a template
 * switches on one word rather than on a storage type. Anything not named here falls through to text,
 * which is the honest default: a value nobody has taught this page to draw is still a value worth
 * showing.
 */
const detailValue: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "field.kind == 'datetime' || field.kind == 'date'" },
    then: { type: 'we-timestamp', props: { value: { $: 'row[field.name]' }, relative: true } },
    else: {
      type: '$if',
      props: {
        condition: { $: "field.kind == 'boolean'" },
        then: { type: 'we-badge', children: [{ $: "row[field.name] ? 'Yes' : 'No'" }] },
        else: {
          type: '$if',
          props: {
            condition: { $: "field.kind == 'image'" },
            then: {
              type: 'we-image',
              props: { src: { $: 'row[field.name]' }, fit: 'cover', r: 'media', maxWidth: '100%' },
            },
            else: {
              type: '$if',
              props: {
                condition: { $: "field.kind == 'url'" },
                then: {
                  type: 'we-link',
                  props: { href: { $: 'row[field.name]' }, target: '_blank' },
                  children: [{ $: 'row[field.name]' }],
                },
                else: { type: 'we-text', children: [{ $: 'row[field.name]' }] },
              },
            },
          },
        },
      },
    },
  },
};

/**
 * The body, drawn from the model's own declaration.
 *
 * Nothing here names a property of anything. `local.display` is `recordStore.displays[<entity>]`,
 * which says which properties play the title, summary and media roles and what kind each detail
 * field is — so this page draws a `Sighting` a community defined without a line being written for
 * it. The same derivation the create form comes from, which is what keeps the two in agreement.
 */
const genericBody: SchemaNode = {
  type: 'Column',
  props: { gap: '400', width: '100%' },
  $localState: { display: { type: 'object', initial: { $: 'recordStore.displays[local.entity]' } } },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: 'local.display.media && row[local.display.media]' },
        then: {
          type: 'we-image',
          props: { src: { $: 'row[local.display.media]' }, fit: 'cover', r: 'media', width: '100%' },
        },
      },
    },
    {
      type: 'we-text',
      props: { variant: 'heading-lg', tag: 'h1', color: 'text' },
      // Falls back to the model's own label rather than to an empty heading: a record whose title
      // property is blank still has a kind, and "Sighting" beats a page that starts with nothing.
      children: [{ $: 'row[local.display.title] ?? local.display.label' }],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'local.display.summary && row[local.display.summary]' },
        then: {
          type: 'we-text',
          props: { variant: 'ingress', color: 'text-muted' },
          children: [{ $: 'row[local.display.summary]' }],
        },
      },
    },
    {
      type: 'Column',
      props: { gap: '300', bg: 'surface', r: '400', border: '1px solid border', p: '400' },
      children: [
        {
          type: '$each',
          props: { items: { $: "local.display.fields.filter(f, f.role == 'detail')" }, as: 'field' },
          children: [
            {
              type: '$if',
              props: {
                // A blank field is not worth a row of its own on a page that is only this record.
                condition: { $: 'row[field.name]' },
                then: {
                  type: 'Row',
                  props: { gap: '300', ay: 'center', ax: 'between', wrap: true },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'label', color: 'text-muted' },
                      children: [{ $: 'field.label' }],
                    },
                    detailValue,
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  ],
};

/**
 * A call's own page — the one type that has more to show than its fields.
 *
 * A call record's fields are a title and a description; everything worth reading is *under* it, in
 * the children extraction and transcription wrote. The generic body would render a heading and an
 * empty box, so calls get a branch. This is the per-type override the page is designed around, and
 * the shape any other type would follow.
 */
const callBody: SchemaNode = {
  type: 'Column',
  props: { gap: '400', width: '100%' },
  $queries: {
    utterances: {
      entity: 'TextBlock',
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: idExpr },
      order: { createdAt: 'asc' },
    },
  },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'phone', color: 'accent-text' } },
        {
          type: 'we-text',
          props: { variant: 'heading-lg', tag: 'h1' },
          children: [{ $: "row.title ?? 'Call'" }],
        },
      ],
    },
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        { type: 'we-timestamp', props: { value: { $: 'row.createdAt' }, relative: true, color: 'text-muted' } },
        {
          type: 'we-text',
          props: { color: 'text-muted' },
          children: [
            { $: "`· ${count(local.utterances)} ${plural(count(local.utterances), 'utterance', 'utterances')}`" },
          ],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'row.description' },
        then: {
          type: 'we-text',
          props: { variant: 'ingress', color: 'text-muted' },
          children: [{ $: 'row.description' }],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: 'count(local.utterances)' },
        then: {
          type: 'Column',
          props: { gap: '300', bg: 'surface', r: '400', border: '1px solid border', p: '400' },
          children: [
            {
              type: '$each',
              props: { items: { $: 'local.utterances' }, as: 'line' },
              children: [
                {
                  type: '$agent',
                  props: { did: { $: 'line.author' }, as: 'speaker' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '300', ay: 'start' },
                      children: [
                        // Absent means "same speaker as the line above", which is what makes a
                        // transcript readable — see `prev` in the schema reference.
                        {
                          type: '$if',
                          props: {
                            condition: { $: 'line.author != prev.author' },
                            then: {
                              type: 'we-avatar',
                              props: { size: 'sm', image: { $: 'speaker.avatar' }, hash: { $: 'speaker.did' } },
                            },
                            else: { type: 'div', styles: { width: '32px', flexShrink: '0' } },
                          },
                        },
                        {
                          type: 'Column',
                          props: { gap: '100', flex: '1', minWidth: '0' },
                          children: [
                            {
                              type: '$if',
                              props: {
                                condition: { $: 'line.author != prev.author' },
                                then: {
                                  type: 'we-text',
                                  props: { variant: 'label', color: 'text-muted' },
                                  children: [{ $: 'speaker.name' }],
                                },
                              },
                            },
                            { type: 'we-text', children: [{ $: 'line.text' }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        else: {
          type: 'we-text',
          props: { color: 'text-faint' },
          children: ['Nobody spoke in this call, or nobody had transcription on.'],
        },
      },
    },
  ],
};

/**
 * The route body: load the record the path names, then draw it.
 *
 * `$single` renders nothing until the record arrives, which is right for the ordinary case and wrong
 * for a link to something deleted — so the not-found state sits beside it rather than inside it,
 * gated on the query having answered. A page that stays blank forever is indistinguishable from one
 * that is still loading, which is the whole reason `<name>Loaded` exists.
 */
export const recordPage: SchemaNode = {
  type: 'Column',
  props: { width: '100%', ax: 'center', bg: 'page', minHeight: '100%' },
  $localState: {
    entity: { type: 'string', initial: entityExpr },
  },
  $queries: {
    found: {
      entity: entityExpr,
      where: { id: idExpr },
      limit: 1,
    },
  },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-md)', gap: '500', px: '600', py: '500' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'ghost', size: 'sm', alignSelf: 'start', onClick: { $action: 'routeStore.back' } },
          children: [
            { type: 'we-icon', props: { name: 'arrow-left' } },
            { type: 'we-text', children: ['Back'] },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'count(local.found)' },
            then: {
              type: '$each',
              props: { items: { $: 'local.found' }, as: 'row' },
              children: [
                {
                  type: '$if',
                  props: {
                    // The per-type override. `kind` rather than the entity name: a call record is a
                    // `CollectionBlock` like a post is, and what separates them is what it is a
                    // collection *of*.
                    condition: { $: "local.entity == 'CollectionBlock' && row.kind == 'call'" },
                    then: callBody,
                    else: genericBody,
                  },
                },
              ],
            },
            else: {
              type: '$if',
              props: {
                condition: { $: 'local.foundLoaded' },
                then: {
                  type: 'Column',
                  props: { ax: 'center', ay: 'center', gap: '400', p: '600', flex: '1' },
                  children: [
                    { type: 'we-icon', props: { name: 'question', size: 'xl', color: 'text-faint' } },
                    {
                      type: 'we-text',
                      props: { variant: 'heading-md', textAlign: 'center' },
                      children: ["This isn't here"],
                    },
                    {
                      type: 'we-text',
                      props: { color: 'text-muted', textAlign: 'center', maxWidth: 'var(--we-layout-xs)' },
                      children: [
                        'The record this link points at has been deleted, or belongs to a space you have not joined.',
                      ],
                    },
                    /*
                      What it looked for, said plainly.

                      Not gated on a development build, and that is the second lesson from this
                      route rather than a style choice: `sessionStore.devTools` is not granted at the
                      space tier, so a diagnostic behind it renders for nobody — including whoever is
                      debugging. A gate that silently never opens is worse than no gate.

                      It earns its place unconditionally anyway. "This isn't here" leaves a reader
                      with nothing to act on, and a broken link is usually a broken link *to
                      something* — naming the type and the id is the difference between "the app is
                      wrong" and "this was deleted", and it is the id that would otherwise be
                      invisible when it is the empty one.
                    */
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-faint', textAlign: 'center' },
                      children: [{ $: "`Looked for ${local.entity} · ${routeStore.params.id ?? 'no id given'}`" }],
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    },
  ],
};
