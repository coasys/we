import {
  composerModal,
  emptyNote,
  emptyState,
  foldingBody,
  foldingSectionLabel,
  panelHeader,
  panelScroll,
} from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import { discussionSection } from './discussion.ts';
import { linkedRecords } from './linkedRecords.ts';
import { signalDisplay } from './signalDisplay.ts';
import { newSignalTypeButton } from './signalTypeForm.ts';
import { answerButton, suggestedChanges, UNCONFIRMED } from './suggestions.ts';
import { workflowsSection } from './workflows.ts';

/**
 * A record looked inside, beside whatever chose it — the workshop's inspector, made a kit piece so a
 * space's own interface can place the same panel: the workshop as a panel on its right edge, Coasys
 * as a section in a lane beside its view.
 *
 * Reads the selection from the address (`card`, `cardType`), so it needs nothing from where it is
 * placed but a few words; see `InspectorPanelOptions`.
 */
/**
 * What a kind is called and drawn with, here and in the inspector — one answer, so the two panels
 * on the same edge cannot call one card two different things.
 *
 * `CollectionBlock` is overridden because its display says "Collection", which is the class read
 * back rather than the word anybody uses: on this canvas one of them is a note. The fallback past
 * it is the model's own name, for a kind nothing has a display for at all.
 */
export function kindLabel(kind: string): string {
  return `(${kind} == 'CollectionBlock' ? 'Note' : recordStore.displays[${kind}].label ? recordStore.displays[${kind}].label : ${kind})`;
}

export function kindIcon(kind: string): string {
  return `(${kind} == 'CollectionBlock' ? 'note' : recordStore.displays[${kind}].icon)`;
}

/**
 * Every field the model declares, as a control — the inspector's edit mode.
 *
 * The same walk the read mode makes over `local.display.fields`, drawing a control by `kind` where
 * that drew a value, and writing each change through `recordStore.updateRecordField` the moment
 * the control commits it. No Save button: a record here is a shared thing, and a form that
 * buffered its edits would be a form whose state nobody else could see. `onChange` rather than
 * `onInput` on the typed controls, so a keystroke is not a write.
 *
 * A closed set of values — a task's status — is a select over the options the model declares.
 * Media, files, JSON and relations are not editable here; a picture is uploaded, not typed.
 *
 * `fields` is the list to draw, as an expression, so the inspector can call this twice over two
 * halves of the same declaration — the fields that hold something, and the ones that do not, which
 * sit behind a disclosure. Defaults to all of them, which is what a caller with nothing to split on
 * wants.
 *
 * **The record must be bound as `row`** — by whatever `$each` or `$single` this is placed inside,
 * since the two expressions have to name the same thing. `record` was the obvious name and is the
 * one name it cannot be: `record.create`/`update`/`delete` is the mutation namespace, so a dotted
 * read off a binding called `record` is reported by the tier inspector as a reference to a store
 * member that does not exist — which is a template refused at install time, over a name.
 */
export function fieldEditor(entity: SchemaProp, id: SchemaProp, fields = 'local.display.fields'): SchemaNode {
  const write = (value: SchemaProp): SchemaProp => ({
    $invoke: 'recordStore.updateRecordField',
    args: [entity, id, { $: 'field.name' }, value],
  });
  const onChange = write({ $: 'event.detail' });
  const value = { $: 'row[field.name]' };
  const control = (node: SchemaNode): SchemaNode => ({
    type: 'we-form-field',
    props: { label: { $: 'field.label' }, size: 'sm', width: '100%' },
    children: [node],
  });

  return {
    type: '$each',
    props: { items: { $: fields }, as: 'field' },
    children: [
      {
        type: '$if',
        props: {
          condition: { $: "!(field.kind in ['image', 'file', 'json', 'relation'])" },
          then: {
            type: '$if',
            props: {
              condition: { $: 'count(field.options)' },
              then: control({
                type: 'we-select',
                props: {
                  size: 'sm',
                  width: '100%',
                  options: { $: 'field.options.map(o, { label: o, value: o })' },
                  value,
                  onChange,
                },
              }),
              else: {
                type: '$if',
                props: {
                  condition: { $: "field.kind == 'boolean'" },
                  then: control({
                    type: 'we-switch',
                    props: { size: 'sm', checked: value, onChange },
                  }),
                  else: {
                    type: '$if',
                    props: {
                      condition: { $: "field.kind == 'number'" },
                      then: control({
                        type: 'we-number-input',
                        props: { size: 'sm', width: '100%', value, onChange },
                      }),
                      else: {
                        type: '$if',
                        props: {
                          condition: { $: "field.kind == 'datetime' || field.kind == 'date'" },
                          then: control({
                            type: 'we-date-picker',
                            props: {
                              size: 'sm',
                              width: '100%',
                              value,
                              showTime: { $: "field.kind == 'datetime'" },
                              onChange,
                            },
                          }),
                          else: {
                            type: '$if',
                            props: {
                              condition: { $: "field.kind == 'longText'" },
                              then: control({
                                type: 'we-textarea',
                                props: { size: 'sm', width: '100%', autoGrow: true, value, onChange },
                              }),
                              else: {
                                type: '$if',
                                props: {
                                  condition: { $: "field.kind == 'color'" },
                                  then: control({
                                    type: 'we-color-picker',
                                    props: { tokens: true, value, onChange },
                                  }),
                                  else: control({
                                    type: 'we-input',
                                    props: {
                                      size: 'sm',
                                      width: '100%',
                                      type: { $: "field.kind == 'url' ? 'url' : 'text'" },
                                      value,
                                      onChange,
                                    },
                                  }),
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
  };
}

/** The record types the Vocabulary settings edit. */
const VOCABULARY_ENTITIES = "['SignalType', 'RelationshipType', 'TaskState', 'InvolvementType', 'Topic']";

/**
 * Where a vocabulary record is edited, from its inspector. The map shows it; the settings change it —
 * they already have the right controls (a state's approvals, a kind's reflexivity), and a second copy
 * of them here would be two places to keep honest.
 */
export function vocabularyEditLink(cardType: string): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $: `${cardType} in ${VOCABULARY_ENTITIES}` },
      then: {
        type: 'we-button',
        props: {
          size: 'sm',
          variant: 'soft',
          // About this record, so the settings land on its row — see `spaceSettingsFocus`.
          onClick: { $invoke: 'shellStore.openSpaceSettings', args: ['vocabulary', { $: 'row.id' }] },
        },
        children: [
          { type: 'we-icon', props: { name: 'book-open-text' } },
          { type: 'we-text', props: { variant: 'label' }, children: ['Edit in Vocabulary'] },
        ],
      },
    },
  };
}

/** The model the selected card is of — the inspector's whole subject, named once. */
const CARD_TYPE = 'routeStore.params.cardType';

/**
 * The fields with something in them, as details — the rows the panel is mostly made of.
 *
 * `role == 'detail'` because the title and the summary are already drawn, as the heading and the
 * line under it; without the filter they appeared a second time as captioned rows, so every record
 * showed its own name twice.
 */
/**
 * The kinds of part the selected record's entity is offered — a task's Assigned and Reviewing, an
 * event's answers. Declared here, ahead of the field lists that read it.
 */
const PEOPLE_KINDS = `spaceStore.offeredInvolvementTypes.filter(k, ${CARD_TYPE} in k.appliesTo || !count(k.appliesTo))`;

/**
 * Whether a field is one the People section already answers. `assignee` is the name an extraction
 * pass writes because a model cannot know a DID; where the entity has parts people can hold, People
 * shows who is actually on it and quotes that name when nobody is, so the free-text field beside it
 * is the same fact twice — and, empty, an input nobody should type into.
 */
const NOT_PEOPLE_FIELD = `(f.name != 'assignee' || !count(${PEOPLE_KINDS}))`;

const SET_DETAILS = `local.display.fields.filter(f, f.role == 'detail' && f.kind != 'relation' && row[f.name] && ${NOT_PEOPLE_FIELD})`;

/** The same, as controls: everything set, title and summary included, since editing them is the point. */
/**
 * The relations holding something — a sighting's photos, the site it was seen at.
 *
 * Drawn as what they point at rather than as ids (see `linkedRecords`). A to-many holding an empty
 * list is not a row, which is why `many` decides between counting and testing: an empty list is
 * truthy. `WeNode`'s own relations — comments, signals — are not in `display.fields` at all.
 */
const SET_RELATIONS = `local.display.fields.filter(f, f.kind == 'relation' && f.target && (f.many ? count(row[f.name]) : row[f.name]))`;

const SET_FIELDS = `local.display.fields.filter(f, f.kind != 'relation' && row[f.name] && ${NOT_PEOPLE_FIELD})`;

/**
 * The fields holding nothing — what the disclosure offers.
 *
 * Images, files and JSON are excluded along with relations: `fieldEditor` draws no control for any
 * of them (a picture is uploaded, not typed), so counting them would promise rows that expanding
 * does not produce.
 */
const EMPTY_FIELDS = `local.display.fields.filter(f, !(f.kind in ['relation', 'image', 'file', 'json']) && !row[f.name] && ${NOT_PEOPLE_FIELD})`;

const EMPTY_COUNT = `count(${EMPTY_FIELDS})`;

/**
 * Whether this MODEL has any field the panel could edit — asked of the declaration rather than of
 * the record, because the header is outside the `$each` and has no row in scope.
 *
 * What the pencil is gated on. A composed document declares no fields at all (see
 * `CollectionBlock`'s manifest entry), so unlocking editing on a note produced a mode with nothing
 * in it: the same empty panel this whole piece of work started from, one press further in.
 */
const HAS_EDITABLE_FIELDS = `count(recordStore.displays[${CARD_TYPE}].fields.filter(f, !(f.kind in ['relation', 'image', 'file', 'json'])))`;

/**
 * Whether the selected RECORD is a composed document — the header's reading of {@link COMPOSED}.
 *
 * The same question one scope up: `COMPOSED` asks it of the `$each`'s row, and the header has no
 * row, so it asks the query. Both exist because editing a note and editing a task are one control
 * in the header and two different actions underneath — a note's substance is a document and opens
 * in the composer, where a task's is a set of fields and unlocks in place.
 */
const COMPOSED_CARD = 'first(local.card).editorState';

/** Whether the selected thing is a drawn connection rather than a card. */
const IS_RELATIONSHIP = `${CARD_TYPE} == 'Relationship'`;

/** The kind record this connection names, or undefined — a dotted read off it is undefined too. */
const KIND_OF_LINK = 'find(local.relationshipKinds, { id: row.relationshipTypeId })';

/**
 * Which kind of connection a line is — the one field the generated panel cannot draw.
 *
 * `Relationship.relationshipTypeId` holds the **id of a record** and is declared as an ordinary
 * string, so the two halves of this panel both get it wrong on their own. `displays` derives its
 * field list from `display.fields ?? authoring.fields`, and `Relationship.authoring.fields` is
 * `['label', 'description']` — deliberately, since the kinds are a list to pick from rather than
 * something to type — so the field is simply absent from the read rows and from `fieldEditor`. Put
 * *in* that list it would be worse than absent: a text box showing a raw `we://…` id, and a caption
 * reading "Relationship Type Id".
 *
 * So it is drawn here by hand, which is the same answer `recordForm` reaches for the create modal
 * and `EdgeDetail` for the knowledge map — three surfaces, one shape, and the generic path unable to
 * serve any of them. What would retire all three is `recordDisplay` learning a kind for "a string
 * that references a record of a named model"; `Signal.signalTypeId` is the second instance of it, so
 * the case is close to made. It is not made *here*: a new `DisplayKind` is a change to every surface
 * that switches on one, and this branch has enough in it.
 *
 * Reading and editing, in one node, because both are one row in the same column and splitting them
 * would put the kind in two places that have to agree about where it sits.
 */
const relationshipKind: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: IS_RELATIONSHIP },
    then: {
      type: '$if',
      props: {
        condition: { $: 'local.editing' },
        /*
          Editing: the community's kinds, and a way back out of having picked one.

          Offered only where the community has named a kind. A space that has named none still
          connects things — the label carries the meaning until a vocabulary exists, which is how one
          gets discovered — and a picker with nothing in it would ask a question with no answers.

          No "unnamed" entry among the options, and this is the trap worth naming: a schema cannot
          prepend to a list, and the interpolation that looks like it can — `` `${[…]}${list.map(…)}` ``
          — evaluates to a *string*, so `options` receives "[object Object]" and the select renders
          empty. That spelling was live in `recordForm` and is gone. The unset state is the
          placeholder; getting back to it is the button.
        */
        then: {
          type: '$if',
          props: {
            condition: { $: 'count(local.relationshipKinds)' },
            then: {
              type: 'we-form-field',
              props: { label: 'Kind', size: 'sm', width: '100%' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center', width: '100%' },
                  children: [
                    {
                      type: 'we-select',
                      props: {
                        size: 'sm',
                        flex: '1',
                        minWidth: '0',
                        placeholder: 'Unnamed kind',
                        options: {
                          $: 'local.relationshipKinds.map(item, { label: item.name, value: item.id, icon: item.icon })',
                        },
                        value: { $: 'row.relationshipTypeId' },
                        // The same writer every other control in edit mode uses — one action, named
                        // field, value coerced by the field's declared kind. `relationshipTypeId` is
                        // a plain string property, so nothing special happens to it on the way.
                        onChange: {
                          $invoke: 'recordStore.updateRecordField',
                          args: [
                            'Relationship',
                            { $: 'routeStore.params.card' },
                            'relationshipTypeId',
                            {
                              $: 'event.detail',
                            },
                          ],
                        },
                      },
                    },
                    {
                      type: '$if',
                      props: {
                        condition: { $: 'row.relationshipTypeId' },
                        then: {
                          type: 'we-tooltip',
                          props: { content: 'Leave the kind unnamed' },
                          children: [
                            {
                              type: 'we-button',
                              props: {
                                size: 'sm',
                                variant: 'ghost',
                                square: true,
                                label: 'Leave the kind unnamed',
                                flexShrink: '0',
                                // An empty string, which the AD4M adapter reads as "clear this
                                // property" — see `clearOnEmpty`. Not null or undefined: those still
                                // skip, so that an ordinary partial save is not data loss.
                                onClick: {
                                  $invoke: 'recordStore.updateRecordField',
                                  args: ['Relationship', { $: 'routeStore.params.card' }, 'relationshipTypeId', ''],
                                },
                              },
                              children: [{ type: 'we-icon', props: { name: 'x' } }],
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
        },
        /*
          Reading: the kind's own name and glyph, drawn as one more detail row.

          Only when one is set and still resolves. A kind the community has since deleted reads as
          nothing rather than as its bare id — the same choice the detail rows make for an empty
          field, and for the same reason: a row showing a `we://` string is a row that looks like
          something failing to load.
        */
        else: {
          type: '$if',
          props: {
            condition: { $: KIND_OF_LINK },
            then: {
              type: 'Column',
              props: { py: '100', borderTop: '1px solid border' },
              children: [
                { type: 'we-text', props: { variant: 'footnote', color: 'text-faint' }, children: ['Kind'] },
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center' },
                  children: [
                    {
                      type: '$if',
                      props: {
                        condition: { $: `${KIND_OF_LINK}.icon` },
                        then: {
                          type: 'we-icon',
                          props: { name: { $: `${KIND_OF_LINK}.icon` }, size: 'xs', color: 'text-muted' },
                        },
                      },
                    },
                    { type: 'we-text', props: { variant: 'footnote' }, children: [{ $: `${KIND_OF_LINK}.name` }] },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  },
};

/**
 * Whether this record is a composed document rather than a filled-in form.
 *
 * The value, not the model's name: a `CollectionBlock` is both things depending on what made it.
 * A note has an `editorState` and its substance is in there; a call record, or a board column, is
 * the same class with none, and reads as its fields exactly as a task does.
 */
const COMPOSED = 'row.editorState';

/**
 * A note's actual content, drawn the way the cards route draws a post.
 *
 * The panel is derived from `recordStore.displays`, which is a list of *properties* — and a
 * composed document has none worth reading: its title is usually empty and its text lives in
 * `editorState`, a blob no field row can render. So the panel that had just learned to say
 * "Note" went on to say "Untitled" over nothing at all, about a sticky note with three paragraphs
 * visible on the canvas behind it.
 *
 * `BlockRenderer` is the same component the post card mounts, so a note reads here as it does
 * everywhere else. On a `surface` with a border, for the same reason the card route puts one there
 * and not a sunken well: the panel's frame paints the page, and a well belongs *in* a surface rather
 * than on the ground — what is wanted here is a card, since the strip above is a description of the
 * record and this is the record itself.
 *
 * The composer below it is opened from the HEADER'S pencil, like every other kind of record — see
 * the note on `aside` in `inspectorPanel`. It used to have a button of its own down here, on the
 * grounds that the header's pencil meant "unlock the declared fields" and a note has none; the cost
 * was that "how do I change this" had two answers depending on what was selected, and the one in
 * the corner was where people looked. It is the same composer the canvas's double-click opens, and
 * it saves through the same reconcile.
 */
const composedContent: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: COMPOSED },
    then: {
      type: 'Column',
      props: { gap: '200', width: '100%' },
      children: [
        {
          type: 'Column',
          props: {
            width: '100%',
            bg: 'surface',
            border: '1px solid border',
            r: 'surface',
            p: '300',
            overflow: 'hidden',
          },
          children: [{ type: 'BlockRenderer', props: { editorState: { $: COMPOSED } } }],
        },
        // No `$if` of its own: the fragment mounts only while `noteOpen` is set, which is what
        // resets the editor between one note and the next.
        composerModal({
          openLocal: 'noteOpen',
          title: 'Note',
          saveLabel: 'Save',
          editorState: { $: COMPOSED },
          // `arg` second: `updatePost(postId, json)`.
          saveAction: { $invoke: 'spaceStore.updatePost', args: [{ $: 'row.id' }, { $: 'arg' }] },
        }),
      ],
    },
  },
};

/**
 * The fields this record has nothing in, behind one collapsed row.
 *
 * Controls rather than captions, in both modes: the question somebody has when they open this is
 * "can I put something here", and a read-only list of blanks answers it with no. It is also why the
 * row is at the foot of the panel and shut by default — a model with twelve properties and three
 * filled in should read as three facts, not as nine gaps.
 *
 * `keepMounted`, so closing it does not unmount a control somebody is halfway through typing into —
 * `fieldEditor` writes on change, so an unmount mid-edit would drop what was typed. Every other
 * folding section here drops its contents, which is the right default and the wrong one for this.
 *
 * The heading is the same row the other sections use, which is a change from the sentence it was:
 * "3 empty fields" said the count in words and left the section unnamed, so the one row in the
 * panel that folded looked unlike the four that now do.
 */
const emptyFields: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: EMPTY_COUNT },
    then: {
      type: 'Column',
      props: { gap: '200' },
      children: [
        foldingSectionLabel({ label: 'Empty fields', count: EMPTY_COUNT, open: { field: 'showEmpty' } }),
        foldingBody({
          open: { field: 'showEmpty' },
          keepMounted: true,
          children: [
            {
              type: 'Column',
              props: { gap: '300', pb: '100' },
              children: [fieldEditor({ $: CARD_TYPE }, { $: 'routeStore.params.card' }, EMPTY_FIELDS)],
            },
          ],
        }),
      ],
    },
  },
};

/** The selected record's id — what the connection queries ask about. */
const CARD_ID = 'routeStore.params.card';

/**
 * What to call the record at one end of a connection, as an expression over that end and its type.
 *
 * The same chain the rest of the panel uses, in the order it can fail. An end that is gone — a card
 * deleted after the line was drawn — reads as that, rather than as a type name that implies there is
 * something to open. Then the model's own title property, then a note's text (a note is a
 * `CollectionBlock` whose substance is its content, so its title is usually empty and three
 * connections to "Note" would say nothing), then the kind's own name as the floor.
 */
function endName(end: string, type: string): string {
  const title = `${end}[recordStore.displays[${type}].title]`;
  return `(!${end} ? 'Removed' : ${title} ? ${title} : ${end}.textContent ? ${end}.textContent : ${kindLabel(type)})`;
}

/**
 * The type of the record at one end: the one stored on the connection, else the one the end reports.
 *
 * Stored first because a writer that recorded it meant it — see `reifiedEdgeFrom`. The fallback is
 * for connections an extraction pass wrote without `sourceType`/`targetType`: the end then arrives
 * hydrated and classified, carrying `__subjectClass`, which is the key the executor writes and the
 * graph reads (`NODE_TYPE_KEY`).
 */
function endType(stored: string, end: string): string {
  return `(${stored} ? ${stored} : ${end}.__subjectClass)`;
}

/**
 * A card's connections, as rows ready to draw — one `map` per step, so each step names what it adds.
 *
 * Chained rather than written as one object, because a comprehension binds one name and every field
 * after the first needs the ones before it: which end is *this* card decides which is the other, and
 * the other decides the name, the icon and where a click goes. A literal inlining all of that would
 * repeat the direction test a dozen times.
 *
 * - **Direction** compares the source end with the selected id. An end arrives as a hydrated record
 *   or as a bare id depending on what the backend could hydrate, so it reads `.id` and falls back to
 *   the value itself — the same tolerance `reverseLookup` has. The parentheses matter: `??` binds more
 *   loosely than `==`.
 * - **The verb** reads from this card's side. Outgoing is the kind's name; incoming is its
 *   `inverseName` where the community gave one — "is blocked by" rather than "blocks" pointing the
 *   wrong way — and a label-only connection, which has no inverse to offer, shows its label and lets
 *   the arrow carry the direction.
 * - **The arrow** is `↔` for a kind declared undirected, and otherwise which way the line runs.
 */
const CONNECTION_ROWS = [
  'local.connections',
  `.map(link, { link: link, out: (link.source.id ?? link.source) == ${CARD_ID} })`,
  '.map(c, { link: c.link, out: c.out, other: c.out ? c.link.target : c.link.source, stored: c.out ? c.link.targetType : c.link.sourceType, kind: find(local.relationshipKinds, { id: c.link.relationshipTypeId }) })',
  `.map(c, { link: c.link, out: c.out, other: c.other, kind: c.kind, type: ${endType('c.stored', 'c.other')} })`,
  [
    '.map(c, { ',
    'id: c.link.id, ',
    'otherId: c.other.id ?? c.other, ',
    'otherType: c.type, ',
    `name: ${endName('c.other', 'c.type')}, `,
    `icon: ${kindIcon('c.type')}, `,
    'verb: c.out ? (c.kind.name ? c.kind.name : c.link.label) : (c.kind.inverseName ? c.kind.inverseName : c.kind.name ? c.kind.name : c.link.label), ',
    "arrow: c.kind.directed == false ? 'arrows-left-right' : c.out ? 'arrow-right' : 'arrow-left', ",
    'tint: c.kind.color',
    ' })',
  ].join(''),
].join('');

/**
 * The two ends of a selected line, as the same kind of row — "From" and "To".
 *
 * Empty until the line's own query answers, so nothing is drawn for a frame from an absent record.
 */
const LINK_END_ROWS = [
  "count(local.link) ? [{ role: 'From', end: first(local.link).source, stored: first(local.link).sourceType }, { role: 'To', end: first(local.link).target, stored: first(local.link).targetType }]",
  `.map(e, { role: e.role, end: e.end, type: ${endType('e.stored', 'e.end')} })`,
  `.map(e, { role: e.role, id: e.end.id ?? e.end, type: e.type, name: ${endName('e.end', 'e.type')}, icon: ${kindIcon('e.type')} })`,
  ' : []',
].join('');

/**
 * Open a record in this panel — by writing the address, which is also what the canvas follows.
 *
 * The parameters rather than a `$setLocal`, because a panel is not inside the route's tree and
 * cannot reach the canvas's locals — the reason the selection travels in the address at all. And
 * writing them is the whole of it: the canvas binds `focus` to the same parameter, so it selects the
 * record and brings it into view, or clears its selection when the record lives somewhere else.
 *
 * Type before id. The panel's query is keyed on both, and each write re-asks it; the order only
 * decides which half-changed pair is asked about for the instant between them, and neither answers.
 */
export function openRecord(id: string, type: SchemaProp): SchemaProp[] {
  return [
    { $invoke: 'routeStore.setParam', args: ['cardType', type] },
    { $invoke: 'routeStore.setParam', args: ['card', { $: id }] },
  ];
}

/**
 * The part of a row that names the other end and opens it: its kind's glyph and its name.
 *
 * Disabled when the end is gone, which is the one case where there is nothing to open — the row
 * still says the connection exists, and that the thing it pointed at does not.
 */
function endButton(opts: { id: string; type: string; icon: string; name: string; lead: SchemaNode[] }): SchemaNode {
  return {
    type: 'we-button',
    props: {
      variant: 'ghost',
      size: 'sm',
      flex: '1',
      minWidth: '0',
      ax: 'start',
      gap: '200',
      disabled: { $: `!${opts.id}` },
      label: { $: `'Open ' + ${opts.name}` },
      onClick: openRecord(opts.id, { $: opts.type }),
    },
    children: [
      ...opts.lead,
      {
        type: '$if',
        props: {
          condition: { $: opts.icon },
          then: { type: 'we-icon', props: { name: { $: opts.icon }, size: 'xs', color: 'text-muted' } },
        },
      },
      { type: 'we-text', props: { variant: 'footnote', truncate: true, minWidth: '0' }, children: [{ $: opts.name }] },
    ],
  };
}

/**
 * Everything this card is connected to — including what this canvas cannot draw.
 *
 * The canvas draws a line only when both of its ends are placed on it (see the `canvas` seed), which
 * is right for a drawing and leaves the drawing silent about the rest: a task tied to a decision on
 * another call's canvas, or to a record nobody placed, looks unconnected here. This list is the one
 * place on this surface those connections are visible.
 *
 * One query, native on AD4M: a relation key in a `where` compiles to a triple pattern on that
 * relation's predicate, and an `OR` of two such arms to a SPARQL `UNION` — so a card's connections
 * are found by asking, not by reading every connection in the space and filtering. The `include`
 * brings both ends back hydrated, which is where the names and icons come from.
 *
 * Each row opens the other end; the button at its end opens the connection itself, for its label and
 * kind. No delete here — the connection's own panel has one, and so does the delete key.
 */
const cardConnections: SchemaNode = {
  type: 'Column',
  props: { gap: '100' },
  children: [
    foldingSectionLabel({
      label: 'Connections',
      count: 'count(local.connections)',
      open: { field: 'connectionsOpen' },
    }),
    foldingBody({
      open: { field: 'connectionsOpen' },
      children: [
        {
          /*
        Waiting, then counted — the same gate the thread below uses, and for the same reason: an
        unanswered query and an empty one are both `count() == 0`, so a section that tests the count
        alone declares itself empty on its first frame and fills a moment later. The connections
        arrive after the card does, so that frame is visible.
      */
          type: '$if',
          props: {
            condition: { $: 'local.connectionsLoaded' },
            else: {
              type: 'Column',
              props: { gap: '200', py: '100' },
              children: [1, 2].map(() => ({
                type: 'Row',
                props: { gap: '200', ay: 'center' },
                children: [
                  { type: 'we-skeleton', props: { width: '16px', height: '16px', bg: 'control-surface' } },
                  { type: 'we-skeleton', props: { width: '60%', height: '12px', bg: 'control-surface' } },
                ],
              })),
            },
            then: {
              type: '$if',
              props: {
                condition: { $: 'count(local.connections)' },
                then: {
                  type: '$each',
                  props: { items: { $: CONNECTION_ROWS }, as: 'conn' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '100', ay: 'center', width: '100%' },
                      children: [
                        endButton({
                          id: 'conn.otherId',
                          type: 'conn.otherType',
                          icon: 'conn.icon',
                          name: 'conn.name',
                          lead: [
                            {
                              type: 'we-icon',
                              props: {
                                name: { $: 'conn.arrow' },
                                size: 'xs',
                                // The kind's own colour, where the community chose one — the same colour its
                                // lines are drawn in on the knowledge map.
                                color: { $: "conn.tint ? conn.tint : 'text-faint'" },
                              },
                            },
                            {
                              type: 'we-text',
                              props: {
                                variant: 'footnote',
                                flexShrink: '0',
                                color: { $: "conn.verb ? 'text-muted' : 'text-faint'" },
                              },
                              children: [{ $: "conn.verb ? conn.verb : 'connected to'" }],
                            },
                          ],
                        }),
                        {
                          type: 'we-tooltip',
                          props: { content: 'Open this connection' },
                          children: [
                            {
                              type: 'we-button',
                              props: {
                                variant: 'ghost',
                                size: 'sm',
                                square: true,
                                flexShrink: '0',
                                label: 'Open this connection',
                                onClick: openRecord('conn.id', 'Relationship'),
                              },
                              children: [{ type: 'we-icon', props: { name: 'line-segment', color: 'text-faint' } }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                /*
          Nothing yet — and said as what to do.

          The connect handles appear on a selected card's edges and nowhere else, so the gesture is
          easy to miss; this is the moment somebody is looking at a selected card and wondering.

          No `Loaded` check of its own any more: the gate above only reaches here once the query has
          answered, where before this was the only thing standing between a card and the claim that
          it was connected to nothing.
        */
                else: {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint' },
                  children: ['Not connected to anything yet. Drag from one of its edges to another card.'],
                },
              },
            },
          },
        },
      ],
    }),
  ],
};

/**
 * What a selected line joins — its two ends, each opening that record.
 *
 * The create modal used to say "Post → Sighting" above the label field; with connections written on
 * the drop, the inspector is where a line is read, and it said what the line *was* without saying
 * what it connected.
 */
const linkEnds: SchemaNode = {
  type: 'Column',
  props: { gap: '100' },
  children: [
    foldingSectionLabel({ label: 'Connects', open: { field: 'connectsOpen' } }),
    foldingBody({
      open: { field: 'connectsOpen' },
      children: [
        {
          type: '$each',
          props: { items: { $: LINK_END_ROWS }, as: 'end' },
          children: [
            endButton({
              id: 'end.id',
              type: 'end.type',
              icon: 'end.icon',
              name: 'end.name',
              lead: [
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint', flexShrink: '0', minWidth: '2.5em' },
                  children: [{ $: 'end.role' }],
                },
              ],
            }),
          ],
        },
      ],
    }),
  ],
};

/** Who is on the record in the inspector — the `involvement` host function over the panel's own query. */
const ON_ROW =
  'involvement({ rows: local.involvements, types: spaceStore.involvementTypes, me: me.did }).byNode[row.id]';

/** The kinds of part this record's entity is offered — a task's Assigned and Reviewing, an event's answers. */
const ROW_KINDS = PEOPLE_KINDS;

/**
 * Everyone on the selected record, by part, by name — the detail view a card's faces stand in for.
 *
 * A card has room for three faces and a hovercard; this is where every part is read at once and each
 * person is named without hovering. Grouped by kind in the community's words, each person with the
 * face and ring the card gives them. The picker is the card's own (`involvementMenu`), so the two
 * cannot offer different choices; an × takes somebody off a part anybody may give, and your own
 * answer to an event is withdrawn the same way — nobody else's.
 *
 * Shown only for an entity somebody can be on, which is every entity a kind applies to. Where the
 * record came from is not here — see `originLine`, which is about the record rather than its people.
 */
const peopleSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: `!(${IS_RELATIONSHIP}) && count(${ROW_KINDS})` },
    then: {
      type: 'Column',
      // The same gap under the caption as Connections has; the parts below keep a wider one.
      props: { gap: '100' },
      children: [
        foldingSectionLabel({
          label: 'People',
          count: `count(${ON_ROW}.people)`,
          open: { field: 'peopleOpen' },
          /*
            `xs`, which is the size a section heading's aside is.

            It was `sm` — the size of the pencil and the bin in the panel's header — and a heading
            is not the header: the kit reserves `--we-component-height-xs` for a heading's aside
            precisely because they are the small end of the set, an xs button, a switch, a badge. At
            `sm` this row came out 32px against everything else's 24, and since the row centres its
            contents, "People" sat lower than the four names around it.

            It used to wear a `height: '1lh'` wrapper meant to stop exactly that, and the wrapper
            did not work: the button overflowed it and the row grew anyway. Measured, not guessed —
            see the `section headings agree` case.
          */
          action: {
            type: '$if',
            props: {
              // An event's answers have their own buttons on the calendar; the picker is for parts
              // one member gives another, and an entity with none of those has nothing to pick.
              condition: { $: `count(${ROW_KINDS}.filter(k, !k.reflexive))` },
              then: {
                type: 'DropdownMenu',
                props: {
                  triggerIcon: 'user-plus',
                  triggerTitle: 'Who is on this',
                  triggerVariant: 'ghost',
                  size: 'xs',
                  itemSize: 'sm',
                  placement: 'bottom-end',
                  searchable: true,
                  searchPlaceholder: 'Find a member',
                  items: {
                    $: `involvementMenu({ node: row.id, entity: ${CARD_TYPE}, rows: local.involvements, types: spaceStore.offeredInvolvementTypes, members: spaceStore.members, profiles: profileStore.profiles, me: me.did, said: row.assignee })`,
                  },
                  onSelect: {
                    $invoke: 'spaceStore.setInvolvement',
                    args: [{ $: 'row.id' }, { $: 'arg.id' }, { $: 'arg.kind' }, { $: '!arg.checked' }],
                  },
                },
              },
            },
          },
        }),
        foldingBody({
          open: { field: 'peopleOpen' },
          children: [
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: '$each',
                  props: {
                    items: { $: `${ROW_KINDS}.filter(k, count(${ON_ROW}.people.filter(p, p.kind == k.slug)))` },
                    as: 'part',
                  },
                  children: [
                    {
                      type: 'Column',
                      props: { gap: '100' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-muted', text: { $: 'part.name' } },
                        },
                        {
                          type: '$each',
                          props: { items: { $: `${ON_ROW}.people.filter(p, p.kind == part.slug)` }, as: 'holder' },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center', width: '100%' },
                              children: [
                                {
                                  type: 'AvatarStack',
                                  props: {
                                    size: 'xs',
                                    avatars: {
                                      $: '[{ image: find(profileStore.profiles, { did: holder.did }).avatar, hash: holder.did, tone: holder.tone }]',
                                    },
                                  },
                                },
                                {
                                  type: 'we-text',
                                  props: {
                                    fontSize: '200',
                                    flex: '1',
                                    minWidth: '0',
                                    truncate: true,
                                    text: {
                                      $: "holder.did == me.did ? find(profileStore.profiles, { did: holder.did }).name + ' (you)' : find(profileStore.profiles, { did: holder.did }).name",
                                    },
                                  },
                                },
                                {
                                  type: '$if',
                                  props: {
                                    // Anybody may take somebody off an assignment; only you may withdraw your own answer.
                                    condition: { $: '!holder.reflexive || holder.did == me.did' },
                                    then: {
                                      type: 'we-tooltip',
                                      props: {
                                        content: {
                                          $: "holder.reflexive ? 'Withdraw your answer' : 'Take them off this'",
                                        },
                                      },
                                      children: [
                                        {
                                          type: 'we-button',
                                          props: {
                                            variant: 'ghost',
                                            size: 'xs',
                                            square: true,
                                            label: {
                                              $: "holder.reflexive ? 'Withdraw your answer' : 'Take them off this'",
                                            },
                                            onClick: {
                                              $if: {
                                                condition: { $: 'holder.reflexive' },
                                                then: { $invoke: 'spaceStore.respondTo', args: [{ $: 'row.id' }, ''] },
                                                else: {
                                                  $invoke: 'spaceStore.setInvolvement',
                                                  args: [
                                                    { $: 'row.id' },
                                                    { $: 'holder.did' },
                                                    { $: 'holder.kind' },
                                                    false,
                                                  ],
                                                },
                                              },
                                            },
                                          },
                                          children: [{ type: 'we-icon', props: { name: 'x', color: 'text-faint' } }],
                                        },
                                      ],
                                    },
                                  },
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: `!count(${ON_ROW}.people)` },
                    then: {
                      type: 'we-text',
                      props: {
                        variant: 'footnote',
                        color: 'text-faint',
                        text: {
                          $: "row.assignee ? `Nobody yet — the conversation named “${row.assignee}”.` : 'Nobody is on this yet.'",
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        }),
      ],
    },
  },
};

/**
 * Where the selected record came from — extracted from the conversation, and on whose node, or added
 * by somebody — and when.
 *
 * Straight under the title and the description, and not the last line of People: it is about the
 * record, not about who is on it, and on a card it lives on the extracted mark for the same reason.
 * Near the top because it is the context the rest of the panel is read in. A line joining two cards
 * has no origin worth a sentence, so it is not asked.
 */
const originLine: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: `!(${IS_RELATIONSHIP})` },
    then: {
      /*
        The panel's width, stated. Without it this shrink-wraps, and the sentence — `flex: 1`, so a
        basis of zero — is sized to its narrowest unbreakable piece, which is the timestamp: "Added
        by you ·" fitted in that and the time went to a line of its own however wide the panel was.
      */
      type: 'Column',
      props: { width: '100%' },
      children: [
        {
          type: '$agent',
          props: { did: { $: 'row.author' }, as: 'author' },
          children: [
            /*
              The glyph beside one run of text, which wraps at words.

              It was three flex items in a wrapping row — the glyph, the whole sentence, the time — so
              a narrow panel wrapped *items*: the sentence dropped under the glyph as one block, and
              the time under that. One text holding the time inline lets the browser break between
              words, and the glyph sits in a box one line tall so it centres on the first line
              whatever the theme's type scale is.
            */
            {
              type: 'Row',
              props: { gap: '100', ay: 'start', width: '100%' },
              children: [
                {
                  type: 'Row',
                  props: { fontSize: '100', height: '1lh', ay: 'center', flexShrink: '0' },
                  children: [
                    {
                      type: 'we-icon',
                      props: {
                        name: {
                          $: "row.id in first(local.inspectedCall).extracted ? 'sparkle' : 'pencil-simple-line'",
                        },
                        size: 'xs',
                        color: 'text-faint',
                      },
                    },
                  ],
                },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint', flex: '1', minWidth: '0' },
                  children: [
                    {
                      $: "row.id in first(local.inspectedCall).extracted ? `Extracted from the conversation · run by ${author.name} · ` : `Added by ${author.did == me.did ? 'you' : author.name} · `",
                    },
                    { type: 'we-timestamp', props: { value: { $: 'row.createdAt' }, relative: true, fontSize: '100' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

/**
 * Whether a reply here may itself be replied to — the community's answer, in Settings → Features.
 *
 * Anything but the stored `'flat'` reads as branching, so a space that predates the setting behaves
 * exactly as it did. The test is on the value rather than on its absence because `!=` over an
 * unbound value is the trap this codebase keeps rediscovering; here it is client-side and safe, and
 * written positively so the reading is the same either way.
 */
const FRACTAL_THREADS = "spaceStore.currentSpace.threadMode != 'flat'";

/** The connection section for whatever is selected — a card's connections, or a line's two ends. */
const connectionsSection: SchemaNode = {
  type: '$if',
  props: { condition: { $: IS_RELATIONSHIP }, then: linkEnds, else: cardConnections },
};

/**
 * What people make of the selected record — its reactions, and the conversation about it.
 *
 * ## Why here rather than on the cards
 *
 * Because a canvas card is clipped and a board card is dragged. Both are previews the size of a
 * postcard, and a row of controls on each is furniture competing with the gesture the card exists
 * for — so the cards carry counts (`signalDisplay` at `compact`) and the panel carries the controls,
 * is the whole reason this panel is worth opening: it already shows every field a record holds, and
 * what the community *thinks* of the record is the part it was missing.
 *
 * ## A line gets both, exactly as a card does
 *
 * A `Relationship` is a `WeNode`, so nothing here is written twice: the same section reacts to a
 * task and to the claim that the task blocks another one. `EdgeDetail` in the views package is the
 * older surface for that and keeps its own modal; this is the canvas's answer, where opening a line
 * must not take you off the arrangement it is part of.
 */
const reactionsSection: SchemaNode = {
  type: 'Column',
  /*
    More room under this heading than the others have.

    A section whose body is prose or a list of rows starts below its heading and reads as one
    block. This one starts with a CONTROL, and a control sitting a hundred under a heading reads as
    belonging to it — as though the heading were its label rather than the section's name.
  */
  props: { gap: '300', width: '100%' },
  children: [
    foldingSectionLabel({
      label: 'Signals',
      count: 'signalTally({ signals: row.signals })',
      open: { field: 'reactionsOpen' },
      /*
        The plus goes here, beside the count, where every other per-section control in this panel
        sits — not at the foot of the list as a full-width button.

        A reaction type is a thing about the SECTION rather than about any reaction in it, and a
        button under the last type reads as belonging to that type. The list keeps rendering the
        form, from the flag declared on the panel; this only opens it.
      */
      action: newSignalTypeButton({ open: 'newSignalTypeOpen' }),
    }),
    foldingBody({
      open: { field: 'reactionsOpen' },
      children: [
        signalDisplay({
          record: 'row',
          /*
            The middle step.

            `md` is the size a control is on a page rather than in a 320px column; `xs` is the size
            it is on a card, among a row of marks, and in a panel somebody opened deliberately it
            read as too small to aim at. At `sm` every mode comes out one line tall — a toggle, a
            rating, a vote and a slider all 24px — which is also what lets each control sit on the
            same line as the name beside it.
          */
          size: 'sm',
          // The plus is in the section's heading, so the list draws none of its own. The form is
          // still this fragment's, bound to the flag the panel declares.
          newTypeOpen: 'newSignalTypeOpen',
          /*
        A space arrives with no reactions at all — nothing seeds a heart on a community's behalf, and
        that is the design rather than an omission. Without this the section was a caption over empty
        space, which reads as something failing to load; the line is also the only place anybody
        would learn that a space names its own.
      */
          empty: emptyNote('No reactions here yet — a space names its own in Settings → Vocabulary.'),
        }),
      ],
    }),
  ],
};

/**
 * The whole conversation, counted — not the top of it.
 *
 * `count(row.responses)` is the first level only: a thread of one reply carrying nine answers reads
 * "1", and a caption over a conversation should count the conversation.
 *
 * This used to add up the three levels the panel draws, by hand, and then walked the subtree with a
 * transitive count. The record's `thread` now holds every response under it at any depth, so the
 * total is a plain count of that — replies only, since a call held about the record is in its
 * thread too. It falls back to the record's own count while the read is on its way.
 */
const REPLY_TOTAL = 'first(local.card).$replies ?? count(row.responses)';

/** The thread, and the way into it. */
const discussion: SchemaNode = {
  type: 'Column',
  props: { gap: '200', width: '100%' },
  children: [
    foldingSectionLabel({ label: 'Discussion', count: REPLY_TOTAL, open: { field: 'discussionOpen' } }),
    foldingBody({
      open: { field: 'discussionOpen' },
      children: [
        /*
      No depth or breadth of its own: the kit's [10, 5, 3] at three levels.

      Three is right for THIS surface and the reason is arithmetic. Each level costs the gutter and
      its gap — 32px — and the panel is 320px wide, so six levels would spend nearly two thirds of
      the width on indent before a word is drawn. Depth past three is reached by re-rooting, which
      gives the branch the top level's whole budget and is a better place to read it from anyway.

      Said by saying nothing, so the number lives in one place. A template that restates a default
      is a template that stops following it.
    */
        discussionSection({ record: 'row', fractal: FRACTAL_THREADS }),
      ],
    }),
  ],
};

/**
 * One card, opened out — its type and its properties, beside the arrangement it is part of.
 *
 * ## Why a panel and not the record page
 *
 * There is a record page already, at `/record/:entity?id=`: the host appends it to every template's
 * route table, self-routing ones included, and it is the better surface for reading one thing
 * properly. A button here used to link to it and does not currently — see the note where it was.
 *
 * It is the wrong surface for the question a canvas asks. Navigating away to read a card loses the
 * arrangement the card is *in* — which is the whole reason the thing is on a canvas rather than in a
 * list — so the two are different acts, and this template is the one that argues for the panel:
 * every other surface here is already beside the content rather than instead of it.
 *
 * ## Nothing here names a property of anything
 *
 * Which is the point, and the case that prompted it: a community defines a model, extraction writes
 * one, and it appears on the canvas as a card nobody can look inside. `recordStore.displays` is
 * derived from the model's own declaration, so the fields, their labels and their kinds all arrive
 * from the same place the create form gets them. A model adopted this morning renders here with
 * nothing written for it.
 *
 * ## What is set, and what is not
 *
 * Two lists out of one declaration. A field holding something is a row; a field holding nothing is
 * behind a disclosure at the foot of the panel, as a *control*, so opening it is how something gets
 * added rather than a longer list of blanks to read past. That split is why the panel does not grow
 * a row per property the moment a model declares one, and why "add a due date" is reachable without
 * first deciding to edit.
 *
 * A model that declares no fields has neither list, and that is the ordinary case rather than a
 * degenerate one: a note is composed, so its content is a document and not a set of properties —
 * see `composedContent`, and `CollectionBlock`'s own manifest entry for why it declares roles and
 * no field list. Nothing here offers to name a sticky note.
 *
 * A relation that holds something is a row of its own, after the fields: the photos a sighting was
 * given, the site it names — drawn as what they point at by `linkedRecords`, which looks the records
 * up by the ids the relation holds. `WeNode`'s own relations (comments, signals, mentions) are not
 * fields of anything and are not listed; nor is an untyped one like a collection's `children`,
 * which says no model to look its members up as. Relations are read-only here: writing one is the
 * create form's, and what a card is *connected* to by a drawn line is the connections section.
 */
export interface InspectorPanelOptions {
  /** The heading over it. Default "Inspector". */
  title?: string;
  /**
   * The call whose extraction a record is compared against — "extracted from the conversation" or
   * "added by" in the line saying where a record came from. Absent, every record reads as added.
   */
  call?: { $: string };
  /** What it says while nothing is selected. */
  empty?: string;
}

/**
 * The record the address names, looked inside: its fields (edited in place behind the pencil), where
 * it came from, what it is connected to, who is on it, its workflows, its reactions and its thread —
 * or, for a line, its two ends and its kind.
 *
 * What is selected travels in the address, as `card` and `cardType`, so whatever writes them — a
 * canvas's click, a tree, a link — opens it here; see `openRecord`.
 */
export function inspectorPanel(opts: InspectorPanelOptions = {}): SchemaNode {
  const {
    title = 'Inspector',
    call = { $: "''" },
    empty = 'Click a card on the canvas to look inside it, or double-click the canvas to add one.',
  } = opts;
  return {
    type: 'Column',
    props: { width: '100%', height: '100%', p: '300', gap: '300', overflow: 'hidden' },
    /*
    Whether the fields are controls or values — the pencil in the header. Ephemeral and per panel:
    it is a mode of looking, not a fact about the record, and it drops when the panel is rebuilt.

    `noteOpen` is the other half of that same pencil, for a record whose substance is a document.
    Declared HERE rather than inside the `$each` — where it used to sit, with the button that opened
    it — because the header is outside the loop and a `$setLocal` only reaches a field an ancestor
    of the BUTTON declared. It loses the per-record reset the inner scope gave it, which costs
    nothing: the composer is modal, so the selection cannot change under it, and every way out of it
    sets the flag false.
  */
    $localState: {
      editing: { type: 'boolean', initial: false },
      noteOpen: { type: 'boolean', initial: false },
      /*
      Which sections are open — kept on the device, not in the URL.

      A preference rather than view state: somebody who works from Connections and never opens
      Discussion should find it that way tomorrow, and a link they send should not impose their
      folding on the person who opens it. The extraction panel keeps its sections the same way.

      Per panel rather than per record, which is the same decision: it is a way of working, not a
      fact about the card.

      CLOSED to begin with. The fields are the record, and the five sections are all things *about*
      it — who is on it, what it is joined to, what people made of it, what was said. Opened, they
      push the record's own properties off a 320px panel before a reader has decided they want any
      of them; closed, each is one line saying what is there and how much, which is the question
      most visits are answering.

      The keys carry `Section` because an earlier version of this defaulted them open, and anybody
      who has looked at the panel since then has `true` sitting in their device storage: a stored
      preference outranks the declaration, so keeping the old keys would mean shipping a default
      nobody who had already opened the inspector would ever see.
    */
      // Opened from the Signals heading, and read by the form `signalDisplay` renders — so it is
      // declared above both of them.
      newSignalTypeOpen: { type: 'boolean', initial: false },
      connectionsOpen: { type: 'boolean', initial: false, persist: 'inspector.connectionsSection' },
      connectsOpen: { type: 'boolean', initial: false, persist: 'inspector.connectsSection' },
      peopleOpen: { type: 'boolean', initial: false, persist: 'inspector.peopleSection' },
      workflowsOpen: { type: 'boolean', initial: false, persist: 'inspector.workflowsSection' },
      reactionsOpen: { type: 'boolean', initial: false, persist: 'inspector.reactionsSection' },
      discussionOpen: { type: 'boolean', initial: false, persist: 'inspector.discussionSection' },
    },
    $queries: {
      /*
      The record itself, by id. `limit: 1` because an id names one thing — the list is the shape a
      query answers in, not a set worth iterating.

      `entity` as an expression is what makes this work for a model this template was not written
      for; the cost is that the validator cannot check the name, and a name that has not arrived yet
      reads as "not ready" rather than as an error, which is the right way round while a route is
      settling.
    */
      card: {
        entity: { $: 'routeStore.params.cardType' },
        where: { id: { $: 'routeStore.params.card' } },
        limit: 1,
        /*
        The reactions, hydrated — what `signalDisplay` filters by type.

        Safe for a type this template was not written for, which is the question worth asking of an
        `include` on a query whose entity is an expression: every model a community defines extends
        `WeNode` (see `shapeDraft`), so `signals` is declared on all of them. A model made before
        that was true declares no such relation and the query would be refused outright rather than
        answering without it — it becomes a node again the next time it is edited.
      */
        include: {
          signals: true,
          /*
          The whole conversation under this card, as one number — every reply in its thread, at any
          depth. Without the thread this is the direct replies only, which is not what a reader takes
          "42 replies" to mean; without the kind it would count a call about the card as a reply.
        */
          $replies: { from: 'thread', count: true, where: { kind: 'reply' } },
        },
        /*
        Not until there is an id to ask about — which is what kept the panel showing a record
        nobody had selected.

        An unresolved operand in `where` is *pruned*, and pruning means "do not narrow". For an
        optional filter that is the right reading; for the id that says which record this is, it is
        the worst one available: with `?cardType=TaskBlock` in the address and no `card` — a shared
        link, or a selection cleared while the type lingered — the clause was dropped, `limit: 1`
        answered with whichever task the backend returned first, and the inspector opened out a
        card the canvas was not showing as selected. An untitled one read as "Untitled" in
        heading type, which is what made it look like a panel failing rather than a panel
        answering the wrong question.

        `when` is the distinction the pruner cannot draw: the id is not an optional narrowing, it
        is the whole query. Until it arrives there is nothing to ask, so nothing is asked and the
        panel says what it says when nothing is selected.
      */
        when: { $: 'routeStore.params.card' },
      },
      /*
      The kinds of connection this community has named — see `relationshipKind`.

      Unconditional rather than gated on the selection being a line. It is one subscription over a
      list a space has a handful of, and `when`-ing it on the card's type would tear the
      subscription down and set it up again on every click between a card and a line, to save
      nothing. Hoisted here so the row below reads one answer rather than one per render.
    */
      relationshipKinds: { entity: 'RelationshipType', order: { name: 'asc' } },
      /*
      Every connection this card is at either end of — see `cardConnections`.

      Gated on the selection being a card: a line's own connections are a different question, and
      `link` below answers the one that matters for a line. Ordered by when each was made, which is
      the one order the backend can give that stays still as connections are added.
    */
      connections: {
        entity: 'Relationship',
        where: { OR: [{ source: { $: CARD_ID } }, { target: { $: CARD_ID } }] },
        include: { source: true, target: true },
        order: { createdAt: 'asc' },
        limit: 50,
        when: { $: `${CARD_ID} && !(${IS_RELATIONSHIP})` },
      },
      /*
      The selected line with its two ends hydrated — see `linkEnds`.

      Its own query rather than an `include` on `card`, because `card` asks for whatever type is
      selected and an `include` naming `source` on a task would name a relation tasks do not have.
    */
      link: {
        entity: 'Relationship',
        where: { id: { $: CARD_ID } },
        include: { source: true, target: true },
        limit: 1,
        when: { $: `${CARD_ID} && ${IS_RELATIONSHIP}` },
      },
      /*
      Who is on the selected record — see `peopleSection`. Space-wide, for the board's reason: an
      involvement is not a child of anything. Not asked for a line, which has nobody on it.
    */
      involvements: { entity: 'Involvement', when: { $: `${CARD_ID} && !(${IS_RELATIONSHIP})` } },
      // The call's own record, for which of its records a model proposed — see `peopleSection`.
      inspectedCall: { entity: 'CollectionBlock', where: { id: call }, limit: 1, when: call },
      /*
      What this community reacts with — one subscription for the panel, read by the controls below
      and by the counts on every reply in the thread.

      Unconditional, like `relationshipKinds` and for the same reason: a space has a handful of
      these, and gating it on something about the selection would tear the subscription down and set
      it up again on every click to save nothing.
    */
      signalTypes: { entity: 'SignalType', subscribe: true },
    },
    children: [
      panelHeader({
        title,
        /*
        Edit, in the header where a mode belongs, for every kind of record the panel can open.

        One control, two things underneath, and that is the point. A record whose substance is a set
        of FIELDS unlocks in place: the inspector already shows every value it has, so it is the
        surface that edits them and a separate form would show the same rows a second time. A
        composed document — a note — has no fields to unlock; its substance is a document, and it
        opens in the composer.

        It used to be one control and a half. The pencil was gated on the model declaring an
        editable field, so a note never had one, and its own "Edit note" button sat under the
        content instead — which meant "how do I change this" had two answers depending on what you
        had selected, and the one in the corner was the one people looked for first. A note is now
        edited from the same place as everything else, and the button below it is gone.

        Lit while the field mode is on; a note's press opens a modal, so there is no lasting state
        for it to show.
      */
        aside: {
          type: 'Row',
          props: { gap: '100', ay: 'center' },
          children: [
            {
              type: '$if',
              props: {
                condition: { $: `count(local.card) && (${HAS_EDITABLE_FIELDS} || ${COMPOSED_CARD})` },
                then: {
                  type: 'we-tooltip',
                  props: {
                    content: {
                      $: `${COMPOSED_CARD} ? 'Edit this note' : (local.editing ? 'Done editing' : 'Edit this record')`,
                    },
                  },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        square: true,
                        variant: { $: `!(${COMPOSED_CARD}) && local.editing ? 'soft' : 'ghost'` },
                        onClick: {
                          $if: {
                            condition: { $: COMPOSED_CARD },
                            then: { $setLocal: 'noteOpen', value: true },
                            else: { $toggleLocal: 'editing' },
                          },
                        },
                      },
                      children: [
                        {
                          type: 'we-icon',
                          props: { name: { $: `!(${COMPOSED_CARD}) && local.editing ? 'check' : 'pencil-simple'` } },
                        },
                      ],
                    },
                  ],
                },
              },
            },
            /*
            Delete, beside the pencil — and the one control here that works for a *line*.

            This panel is the only surface the canvas has that opens a card and a connection with the
            same two locals, which is what makes it the right home for a delete that has to cover
            both: a card already has a bin on its own bar, and a line had nowhere at all. Without one,
            immediate connection (see `onEdgeCreate`) would make every mis-drop permanent — the
            modal's Cancel was the only way out of a line drawn by accident, and it is gone.

            No `edgeActions` to mirror the card's bar. A card is a box with a free top edge; a
            selected line's whole length is already committed to the handles that bend it, and for a
            straight two-point route the midpoint — where a bar would go — is exactly where the
            "drag to bend the line here" grip sits. The symmetry is only ever an appearance.

            Gated on the record being loaded rather than on it being editable: a `CollectionBlock` has
            no field the generated editor will touch, so the pencil is hidden for a note, and a note
            is certainly deletable.

            `record.delete` rather than a store action, for `nodeActions`' reason — the host's own
            confirmation stands in front of it, so a template arriving from a stranger does not get
            to decide whether deleting asks first.
          */
            {
              type: '$if',
              props: {
                condition: { $: 'count(local.card)' },
                then: {
                  type: 'we-tooltip',
                  props: { content: 'Delete this record' },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        square: true,
                        variant: 'ghost',
                        color: 'danger-text',
                        label: 'Delete this record',
                        /*
                        No `onSuccess` clearing the address, and the reason is worth writing down.

                        The obvious version clears `card`/`cardType` once the delete lands, so the
                        panel is not left pointing at a record that is gone. It cannot: the host's
                        guard wraps a destructive action as
                        `(await guard(…)) ? bound(…) : undefined` — so **refusing the confirmation
                        resolves**, exactly as accepting it does, and an `onSuccess` would fire on
                        Cancel and empty the panel over a record nobody deleted.

                        Nothing is needed anyway. The panel's `card` query is subscribed, so the
                        delete empties it and the empty state takes over on its own; a cancel leaves
                        everything where it was. The cost is a stale parameter in the URL, which the
                        query's own `when` and `limit: 1` already answer honestly. `nodeActions`'
                        delete makes the same non-choice, one surface along.
                      */
                        onClick: {
                          $invoke: 'record.delete',
                          args: [{ $: CARD_TYPE }, { $: 'routeStore.params.card' }],
                        },
                      },
                      children: [{ type: 'we-icon', props: { name: 'trash' } }],
                    },
                  ],
                },
              },
            },
          ],
        },
      }),
      {
        type: '$if',
        props: {
          condition: { $: 'count(local.card)' },
          then: panelScroll({
            children: [
              {
                type: '$each',
                props: { items: { $: 'local.card' }, as: 'row' },
                children: [
                  {
                    type: 'Column',
                    /*
                    The gap the extraction panel sets its sections apart with, and no rules between
                    them.

                    Each section drew a line above itself, which was the separation when a heading
                    was a caption and a section was a caption with rows under it. They fold now, so
                    every one already has a heading that reads as a heading — and six rules on a
                    panel 320px wide is a lot of horizontal ink for a job the space between them
                    does.
                  */
                    props: { gap: '400' },
                    /*
                    The model's own declaration, held for the subtree rather than read at each use.

                    An object local rather than five reads of `recordStore.displays[…]`: the fields
                    below index into it repeatedly, and one name is easier to follow than the same
                    expression written out six times.
                  */
                    $localState: {
                      display: { type: 'object', initial: { $: `recordStore.displays[${CARD_TYPE}]` } },
                      /*
                      Whether the empty fields are showing. Per record, because it is declared inside
                      the `$each` — selecting another card closes it again, which is right: it was
                      opened to add something to *this* one.
                    */
                      showEmpty: { type: 'boolean', initial: false },
                    },
                    children: [
                      /*
                      What kind of thing this is — the same words and glyph the key uses.

                      Through `kindLabel`/`kindIcon` rather than `local.display` directly, so the two
                      panels sitting on the same edge cannot call one card two different things: a
                      note is a "Note" in both. They also fall back to the model's own name where
                      nothing has a display for it, which is what the panel showed instead of a blank
                      strip for a `CollectionBlock` before one existed.
                    */
                      {
                        type: 'Row',
                        props: { gap: '200', ay: 'center' },
                        children: [
                          {
                            type: '$if',
                            props: {
                              condition: { $: kindIcon(CARD_TYPE) },
                              then: {
                                type: 'we-icon',
                                props: { name: { $: kindIcon(CARD_TYPE) }, color: 'accent-text' },
                              },
                            },
                          },
                          {
                            // `fontSize` rather than the `footnote` variant: this names what is
                            // selected, and at 100 it read as a caption on the thing above it.
                            type: 'we-text',
                            props: { fontSize: '400', color: 'text-muted' },
                            children: [{ $: kindLabel(CARD_TYPE) }],
                          },
                        ],
                      },
                      /*
                      What extraction is waiting on for this record, above what the record says.

                      A draft — a record a pass made — is answered with Keep or Discard, as on its
                      card. An agreed record with a change suggested is answered here field by field,
                      old → new: the canvas card is a clipped preview with no room to read a change,
                      so its "Review suggested change" opens this. Nothing at all for a record with
                      nothing staged.
                    */
                      {
                        type: '$if',
                        props: {
                          condition: { $: `row.id in ${UNCONFIRMED}` },
                          then: {
                            type: 'Row',
                            props: {
                              gap: '200',
                              ay: 'center',
                              width: '100%',
                              p: '200',
                              r: '300',
                              border: '1px dashed border-strong',
                            },
                            children: [
                              {
                                type: 'we-text',
                                props: { fontSize: '200', color: 'text-muted', flex: '1', minWidth: '0' },
                                children: ['Extraction proposed this — pending acceptance.'],
                              },
                              answerButton({
                                tone: 'success',
                                label: 'Accept',
                                onClick: { $invoke: 'modules.transcribe.acceptProposal', args: [{ $: 'row.id' }] },
                              }),
                              answerButton({
                                tone: 'danger',
                                label: 'Reject — removes it',
                                onClick: { $invoke: 'modules.transcribe.rejectProposal', args: [{ $: 'row.id' }] },
                              }),
                            ],
                          },
                        },
                      },
                      suggestedChanges({ record: 'row', collapseAfter: 6 }),
                      /*
                      Reading, or editing — the same fields, as values or as controls.

                      Editing draws the fields that hold something as controls by their kind and
                      writes each change as it is committed; see `fieldEditor`. Reading is what was
                      always here. A `$if` rather than a per-field toggle, so the two modes cannot
                      be half on. Either way the *empty* fields are one disclosure below, shared by
                      both — see `emptyFields`.
                    */
                      {
                        type: '$if',
                        props: {
                          condition: { $: 'local.editing' },
                          then: fieldEditor({ $: CARD_TYPE }, { $: 'routeStore.params.card' }, SET_FIELDS),
                          else: {
                            type: 'Column',
                            props: { gap: '300' },
                            children: [
                              {
                                type: '$if',
                                props: {
                                  condition: { $: 'row[local.display.title]' },
                                  then: {
                                    type: 'we-text',
                                    props: { variant: 'heading-sm' },
                                    children: [{ $: 'row[local.display.title]' }],
                                  },
                                },
                              },
                              /*
                              No "Untitled". There was one here, in heading type, for a record with
                              neither a name nor a document — on the argument that a record with no
                              name otherwise reads as one still loading.

                              That argument was answered before it was made: the kind strip above is
                              unconditional, so a nameless card is already headed "Task" or "Note"
                              and nothing about the panel looks unfinished. What the word added was
                              a heading asserting the record is *called* something it is not, and
                              naming it is one of the fields the disclosure below offers — so the
                              panel was arguing with its own control.
                            */
                              composedContent,
                              {
                                type: '$if',
                                props: {
                                  condition: { $: 'row[local.display.summary]' },
                                  then: {
                                    type: 'we-text',
                                    props: { color: 'text-muted' },
                                    children: [{ $: 'row[local.display.summary]' }],
                                  },
                                },
                              },
                              // Where it came from, straight under what it is — see `originLine`.
                              originLine,
                              /*
                              What this record actually says, each drawn by its kind.

                              The same switch the record page makes, and the same reason: `kind` is
                              resolved once in the store so a template branches on one word rather
                              than knowing what a property is. A date wants a timestamp, a boolean a
                              badge, and everything else reads as text.

                              The list is filtered rather than every field guarded row by row — see
                              `SET_DETAILS`. A field with nothing in it is not a row here at all: an
                              empty label over blank space reads as something failing to load, and
                              the ones with nothing in them are offered as controls below.
                            */
                              {
                                type: '$each',
                                props: { items: { $: SET_DETAILS }, as: 'field' },
                                children: [
                                  {
                                    type: 'Column',
                                    props: { py: '100', borderTop: '1px solid border' },
                                    children: [
                                      {
                                        type: 'we-text',
                                        props: { variant: 'footnote', color: 'text-faint' },
                                        children: [{ $: 'field.label' }],
                                      },
                                      {
                                        type: '$if',
                                        props: {
                                          condition: { $: "field.kind == 'datetime' || field.kind == 'date'" },
                                          then: {
                                            type: 'we-timestamp',
                                            props: { value: { $: 'row[field.name]' }, relative: true },
                                          },
                                          else: {
                                            type: '$if',
                                            props: {
                                              condition: { $: "field.kind == 'boolean'" },
                                              then: {
                                                type: 'we-badge',
                                                props: { size: 'xs' },
                                                children: [{ $: "row[field.name] ? 'Yes' : 'No'" }],
                                              },
                                              else: {
                                                type: 'we-text',
                                                props: { variant: 'footnote' },
                                                children: [{ $: 'row[field.name]' }],
                                              },
                                            },
                                          },
                                        },
                                      },
                                    ],
                                  },
                                ],
                              },
                              {
                                type: '$each',
                                props: { items: { $: SET_RELATIONS }, as: 'field' },
                                children: [
                                  {
                                    type: 'Column',
                                    props: { gap: '100', py: '100', borderTop: '1px solid border', width: '100%' },
                                    children: [
                                      {
                                        type: 'we-text',
                                        props: { variant: 'footnote', color: 'text-faint' },
                                        children: [{ $: 'field.label' }],
                                      },
                                      linkedRecords({ record: 'row', field: 'field' }),
                                    ],
                                  },
                                ],
                              },
                            ],
                          },
                        },
                      },
                      /*
                      After the fields and before the disclosure, in both modes — which is where it
                      belongs in each. Reading, it is one more detail row under the label and the
                      description; editing, it is one more control under theirs. Above the
                      disclosure because the disclosure is for what is *not* set, and this is.
                    */
                      relationshipKind,
                      emptyFields,
                      // After the record's own fields and before its connections: who is on this record
                      // is about the record, and connections are about other records.
                      // A vocabulary record is edited where the space's words are — see `WorkshopVocabulary`.
                      vocabularyEditLink(CARD_TYPE),
                      peopleSection,
                      // Beside who is on it: which workflows it is going through is also about this record.
                      workflowsSection({
                        type: CARD_TYPE,
                        open: { field: 'workflowsOpen' },
                        workflowsPath: { $: '`${spaceStore.spacePath}/workflows`' },
                      }),
                      // After the disclosure: that is about this record's own fields, and connections
                      // are about other records.
                      connectionsSection,
                      // Last, and in this order: what the record *is* comes first, then who is on it
                      // and what it is joined to, then what people make of it. The thread is last
                      // because it is the only section with no ceiling on its height.
                      reactionsSection,
                      discussion,
                      /*
                      No "Open full record". There was a ghost button here that navigated to
                      `<space>/record/<type>?id=<id>` — the record page the host appends to every
                      template's route table — and it did not arrive anywhere usable.

                      Out until it does. A control that looks like every other control in the panel
                      and does not work costs more than the reading it was offering: this panel's
                      case for existing is that it opens a card *without* leaving the arrangement
                      the card is in, so the link out was the convenience, not the feature. The
                      panel docblock above still makes the argument, and the button comes back when
                      the page it points at holds up.
                    */
                    ],
                  },
                ],
              },
            ],
          }),
          /*
          A sentence, because `label` alone builds the wrong one.

          `emptyState` composes its default from the label — "This space doesn't have any <label>."
          — which is right for a plural noun naming what a list would have held, and this is not a
          list. With `label: 'a card selected'` the panel read "This space doesn't have any a card
          selected.", in the panel this template opens by default, on the first screen anybody sees
          of it. The label stays as what a reader of the schema sees the panel is *for*; `message`
          says the true thing on screen.
        */
          else: emptyState({
            icon: 'cursor-click',
            label: 'a card selected',
            message: empty,
          }),
        },
      },
    ],
  };
}
