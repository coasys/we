/**
 * Patterns fragment — the shapes WE's own templates are built from, as JSON to copy.
 *
 * These are the recipes behind `@we/template-kit`. The kit is TypeScript, so a template authored
 * in the browser cannot import it; what it can do is produce the same JSON. That is the whole point
 * of the kit expanding at authoring time — the output is the shared artifact, not the helper.
 *
 * Hand-maintained. When a kit fragment's expansion changes materially, change the recipe with it —
 * they are two renderings of one decision, and a drifted recipe teaches the AI a shape the codebase
 * has stopped using.
 */
export const patterns = `
## Common Patterns (copy these shapes)

These are the shapes WE's own templates use. Prefer them over inventing a new arrangement — they
carry decisions (loading behaviour, empty states, accessibility) that are easy to omit and hard to
notice missing. Copy the JSON and change the words; every one of them is ordinary nodes you can
then edit freely.

### Empty state — what a list shows when it has nothing to show

**A list must always have one.** An empty \`$each\` renders nothing at all, so a page with no content
looks identical to a page still loading, and the reader cannot tell which.

\`\`\`json
{
  "type": "$animate",
  "props": { "enterTransition": { "type": "fade", "duration": 200, "delay": 400 } },
  "children": [
    {
      "type": "Column",
      "props": { "ax": "center", "ay": "center", "gap": "200", "p": "600", "width": "100%" },
      "children": [
        { "type": "we-icon", "props": { "name": "newspaper", "size": "lg", "color": "textFaint" } },
        {
          "type": "we-text",
          "props": { "color": "textFaint", "textAlign": "center" },
          "children": ["This space doesn't have any posts."]
        }
      ]
    }
  ]
}
\`\`\`

The \`$animate\` wrapper is not decoration. A query-backed list is empty on its first frame and fills
a moment later, so without the delayed fade the placeholder blinks on every load and states
something false while it does. Drop the wrapper only when emptiness is known synchronously (a store
array, a missing model).

**If the list filters on a search box**, say so instead of claiming the space is empty:

\`\`\`json
{ "$": "local.searchText ? 'No posts match your search.' : \"This space doesn't have any posts.\"" }
\`\`\`

### A list with its empty state — hoist the query so the count is readable

\`\`\`json
{
  "type": "Column",
  "props": { "width": "100%" },
  "$queries": { "postRows": { "entity": "CollectionBlock", "where": { "type": "root" }, "limit": 20 } },
  "children": [
    {
      "type": "$if",
      "props": {
        "condition": { "$": "count(local.postRows)" },
        "then": {
          "type": "Grid",
          "props": { "columns": 1, "gap": "400", "width": "100%" },
          "children": [
            {
              "type": "$each",
              "props": { "items": { "$": "local.postRows" }, "as": "post" },
              "children": [{ "type": "Card", "children": ["…"] }]
            }
          ]
        },
        "else": { "…": "the empty state above" }
      }
    }
  ]
}
\`\`\`

Hoisting into \`$queries\` rather than leaving the query on the \`$each\` is what makes the count
readable from outside the loop, and it means one subscription answers both branches — so the
placeholder and the grid can never disagree about how many rows there are.

### Gate / prompt page — an icon, what this is, and what to do about it

\`\`\`json
{
  "type": "Column",
  "props": { "flex": "1", "height": "100%", "ax": "center", "ay": "center", "gap": "400", "p": "600" },
  "children": [
    { "type": "we-icon", "props": { "name": "lock", "size": "xl", "gradient": "primary" } },
    { "type": "we-text", "props": { "variant": "heading-md", "textAlign": "center" }, "children": ["Join this Space"] },
    {
      "type": "we-text",
      "props": { "variant": "body", "textAlign": "center", "maxWidth": "var(--we-layout-xs)" },
      "children": ["You haven't joined this space yet."]
    },
    { "type": "we-button", "props": { "variant": "primary", "onClick": { "$action": "…" } }, "children": ["Join"] }
  ]
}
\`\`\`

Use \`gradient\` on the icon when there is something to do, and a flat \`color\` (\`text-faint\`,
or \`warning-text\`) when there is not — the two read apart at a glance, and a dead end that looks
like an invitation is worse than one that looks like a dead end.

This line used to recommend \`neutral-300\`, and every gate prompt in the repo copied it. A scale
position is not frozen — it follows the theme's hue, saturation and polarity — but it cannot follow
what a theme *decides* a faint foreground is, and the contrast corrections at apply time skip it
entirely, so nothing ever measures it against what is behind it. Guidance that names a step
reproduces that in every template written from it.

### How wide is a modal — always \`size\`, never a pixel width

\`we-modal\` sizes itself from a \`size\` prop, and **every modal should set one**:

| \`size\` | Measure | For |
|---|---|---|
| \`sm\` | 420px | A confirmation, or one or two fields. |
| \`md\` | 640px | **The default.** A form. |
| \`lg\` | 900px | A workspace — a composer, a wizard, a card opened out to be read. |
| \`fullscreen\` | The viewport, less a gutter | A lightbox, where the content is the size. |

Each keeps a gutter between itself and the edge of the screen, so a modal on a phone is never
edge-to-edge. Do **not** write \`"width": "100%"\` beside a \`"maxWidth"\` — that is what \`size\`
replaced, and \`100%\` of a viewport-wide host is the viewport.

Without a size, \`[part='base']\` shrink-wraps to its widest line of text: a short confirmation comes
out too narrow to read and a wordy one too wide, from the same rule. \`width\`/\`maxWidth\` still
override \`size\` for the rare modal that genuinely needs its own number.

### Confirm dialog

**Use \`confirmModal\` from \`@we/template-kit\`.** Every "are you sure?" in WE goes through it, so
they share an icon, a heading, a width and a button row:

\`\`\`ts
confirmModal({
  open: { $: 'local.confirmDeleteOpen' },
  close: { $setLocal: 'confirmDeleteOpen', value: false },
  title: 'Delete post?',
  body: 'This will permanently delete the post and everything inside it. This cannot be undone.',
  confirmLabel: 'Delete',
  confirm: { $action: 'spaceStore.deleteCollection', args: ['$post.id'] },
})
\`\`\`

It returns the \`$if\` as well as the modal, and clears \`open\` from all three exits — the backdrop,
Cancel, and the action's \`onSuccess\`.

- \`open\` and \`close\` are **expressions**, so a dialog gated on a store flag
  (\`{ $: 'shapeStore.confirmDiscard' }\`) or on a string id works the same way.
- \`cancel\` for a cancel button that does more than close — "Keep editing" dismisses the question
  and leaves the wizard behind it open.
- \`tone: 'primary'\` for a question with no casualty; the default \`danger\` picks a warning icon and
  a danger confirm button.
- \`detail\` for a quieter second line, \`children\` for a \`we-alert\` naming a surprising consequence.
- \`busyLocal\` if the action is not instant — a recursive delete walks its whole collection, and
  without a spinner the button absorbs the click and invites a second one. \`busy\` instead when a
  store already owns the flag.

The flag must be declared by an ancestor of **the button that opens it**, not merely of the modal.
Undeclared, \`$setLocal\` warns and no-ops: the button renders, takes the click, and does nothing.

### A form in a modal

**Use \`formModal\` from \`@we/template-kit\`** — title, fields, Cancel and Save:

\`\`\`ts
formModal({
  open: { $: 'local.composerOpen' },
  close: { $setLocal: 'composerOpen', value: false },
  title: 'New task',
  size: 'sm',
  localState: { draftTitle: { type: 'string', initial: '' } },
  children: [field({ name: 'draftTitle', label: 'What needs doing?', placeholder: 'Ship the docs' })],
  disabled: { $: '!local.draftTitle' },
  submitLabel: 'Add task',
  submit: { $action: 'record.create', args: ['TaskBlock', { title: { $: 'local.draftTitle' } }] },
})
\`\`\`

- **Declare the draft in \`localState\`, not on the page.** The modal is mounted only while open, so
  the draft resets when it closes — for free. A draft declared higher up has to be cleared by hand
  in \`onSuccess\`, and the field somebody forgets is the one that re-opens holding last time's value.
- \`disabled\` is the **precondition** only ("a task needs a title"); the in-flight flag is OR-ed
  in for you, so the Save button cannot start a second save.
- It uses the header and footer slots, so a long form scrolls its fields and never its Save button.

Reach past it only for a form with real \`validate\` rules and a \`{ "$touch": "$all" }\` submit guard
— that shape deliberately keeps the button clickable, and is written out by hand.

### Don't lose what somebody typed — the discard guard

A modal closes on a backdrop click and on Escape. Both are easy to hit by accident, and neither is
recoverable: the modal is \`$if\`-mounted, so closing unmounts the draft with it. **Any modal a
person can type into must ask before throwing that away.**

| Writing | How |
|---|---|
| \`formModal\` | \`discardWhen: <expression>\` |
| \`composerModal\` | Nothing — on by default (\`guardDraft: false\` turns it off) |
| A hand-written \`we-modal\` | \`discardGuard({ dirty, close })\` |

\`discardGuard\` returns three pieces, because a modal cannot be guarded from outside it:

\`\`\`ts
const guard = discardGuard({
  dirty: { $: 'local.name || local.description' },
  close: { $action: 'shellStore.setCreateSpaceOpen', args: [false] },
  title: 'Discard this space?',
  body: 'The name, description and images you have entered will be lost.',
});

{ type: 'we-modal',
  props: { size: 'md', close: guard.close },
  $localState: { ...myFields, ...guard.localState },
  children: [ …the form…, guard.node ] }
\`\`\`

Wire the Cancel button to \`guard.close\` as well — one way out of a modal, not two that disagree.

**Writing \`dirty\` is the part that goes wrong**, and always in one direction: a guard that fires
when there is nothing to lose. A dialog people learn to click through is worse than no dialog.

- **Test only what the person typed.** A field with a default and a picker — a status, a mode, a
  colour — is set from the first frame, so including it makes the guard fire on an untouched form.
- **A form seeded from a record asks whether it _changed_**, not whether it is filled in:
  \`{ "$": "local.titleDraft != call.title" }\`, not \`{ "$": "local.titleDraft" }\`.
- **Where the fields are not known in advance, a store answers** — \`recordStore.recordDraftDirty\`,
  \`runtimeStore.aiFormDirty\`.
- **Leave it off a single-field form** ("name this board"). The guard costs more attention than one
  word is worth.

**Tall modals — pin the title and buttons.** A modal whose content can outgrow the viewport (a
long form, a settings editor) scrolls its *content*, never its own title or its action buttons.
Give the title node \`"slot": "header"\` and the button row \`"slot": "footer"\`: both are pinned
outside the scroll region, sharing the modal's padding and gap, while the default slot scrolls.
\`confirmModal\` and \`formModal\` already do this; write it out only for a modal that is neither.

### Composing a post — the BlockComposer save handshake

\`BlockComposer\` is **pull-based**. Its \`onSave\` does *not* fire when the user types or when a modal
closes — it fires when somebody calls the composer's own \`save()\`, which it hands out exactly once
through \`onReady\`. So the sequence is: \`onReady\` stores that function in a **\`function\`-typed**
\`$localState\` field, the button calls it with \`$callLocal\`, \`save()\` serializes the tree, and
\`onSave\` runs the action with the tree as \`arg\`.

\`\`\`json
{
  "type": "we-modal",
  "props": { "size": "lg", "close": { "$setLocal": "composeOpen", "value": false } },
  "$localState": {
    "savePost": { "type": "function", "initial": null },
    "submitting": { "type": "boolean", "initial": false }
  },
  "children": [
    {
      "type": "BlockComposer",
      "props": {
        "perspective": { "$": "datasetStore.currentDataset.handle" },
        "onReady": { "$setLocal": "savePost", "value": { "$": "event.save" } },
        "onSave": [
          { "$setLocal": "submitting", "value": true },
          {
            "$action": "spaceStore.createPost",
            "args": [{ "$": "arg" }],
            "onSuccess": [{ "$setLocal": "composeOpen", "value": false }],
            "onFinally": [{ "$setLocal": "submitting", "value": false }]
          }
        ]
      }
    },
    {
      "type": "we-button",
      "props": {
        "variant": "primary",
        "loading": { "$": "local.submitting" },
        "disabled": { "$": "local.submitting" },
        "onClick": { "$callLocal": "savePost" }
      },
      "children": ["Post"]
    }
  ]
}
\`\`\`

**Do not** wire the button straight to the action against a \`draft\` local the composer was expected
to fill in. That spelling typechecks, validates, renders — and posts \`null\`, surfacing as
\`Cannot read properties of null (reading 'type')\` from inside \`persistNode\`, several frames from
the cause. And because \`onReady\` is optional, omitting it makes the composer render a floppy-disk
save button of its own, so the screen ends up with two buttons and only the unexpected one works.
(\`we-validate-schemas\` rejects \`onSave\` without \`onReady\`.)

\`{ "$": "arg" }\` goes wherever the action wants it — first for \`createPost(json, options)\`, second for
\`updatePost(postId, json)\`.

**Prefer \`composerModal\` from \`@we/template-kit\`**, which owns all of the above; write it out by
hand only when the modal itself needs a different shape.

### Form field

\`\`\`json
{
  "type": "we-form-field",
  "props": { "label": "Name", "error": { "$": "error('name')" } },
  "children": [
    {
      "type": "we-input",
      "props": {
        "placeholder": "Space name…",
        "value": { "$": "local.name" },
        "onInput": { "$setLocal": "name", "value": { "$": "event.detail" } }
      }
    }
  ]
}
\`\`\`

\`error()\` is already empty until the field is touched, so it needs no condition around it. Which event
carries the value depends on the control: \`we-input\`/\`we-textarea\` emit \`onInput\` with
\`event.detail\`, \`we-select\` emits \`onChange\` with \`event.detail\`, and \`Search\` calls back
with the value itself as \`arg\`.

### Author byline

\`\`\`json
{
  "type": "$agent",
  "props": { "did": "$post.author", "as": "author" },
  "children": [
    {
      "type": "Row",
      "props": { "ay": "center", "gap": "300" },
      "children": [
        { "type": "we-avatar", "props": { "size": "sm", "image": "$author.avatar", "hash": "$author.did" } },
        { "type": "we-text", "props": { "fontWeight": "semibold" }, "children": ["$author.name"] },
        { "type": "we-timestamp", "props": { "value": "$post.createdAt", "relative": true, "color": "textMuted" } }
      ]
    }
  ]
}
\`\`\`

Always set \`hash\` as well as \`image\`, never as a fallback for it — and seed it with an **id**, never
a name. \`hash\` is the stable thing a row *is*: a DID for a person, a uuid for a space. It does two
jobs. It colours the generated initials, so the colour survives a rename; and it draws an identicon
when there are no initials to draw, which is the case it exists for — somebody whose profile has not
arrived has no name yet, and two unresolved peers must not be two identical blank discs.

What \`we-avatar\` draws, in order: **a picture, else letters, else a generated pattern, else a
glyph.** Letters outrank the pattern, so a row that has both shows its initials on a colour seeded
from the hash. Seeding \`hash\` with a *name* is the mistake to avoid: it makes the colour change when
somebody renames the thing, which is identity art contradicting the identity.

### A record of any type — rendering from the declaration

A community can define a model this morning and record one this afternoon; the feed that lists it
was written before either. So a card cannot name the fields. It reads how the model asks to be
shown — \`recordStore.displays\`, derived from the same declaration the form comes from — and draws
whatever is there:

\`\`\`json
{
  "type": "$each",
  "props": { "items": { "$query": { "entity": "Sighting" } }, "as": "row" },
  "children": [
    {
      "type": "Card",
      "$localState": { "display": { "type": "object", "initial": { "$": "recordStore.displays['Sighting']" } } },
      "children": [
        {
          "type": "$if",
          "props": {
            "condition": { "$": "local.display.media" },
            "then": { "type": "we-image", "props": { "src": { "$": "row[local.display.media]" }, "fit": "cover", "r": "media" } }
          }
        },
        { "type": "we-text", "props": { "variant": "heading-sm" }, "children": [{ "$": "row[local.display.title]" }] },
        { "type": "we-text", "props": { "color": "text-muted" }, "children": [{ "$": "row[local.display.summary]" }] },
        {
          "type": "$each",
          "props": { "items": { "$": "local.display.fields.filter(f, f.role == 'detail')" }, "as": "field" },
          "children": [
            {
              "type": "Row",
              "props": { "gap": "300", "ay": "center" },
              "children": [
                { "type": "we-text", "props": { "variant": "label", "color": "text-muted" }, "children": ["$field.label"] },
                {
                  "type": "$if",
                  "props": {
                    "condition": { "$": "field.kind == 'datetime' || field.kind == 'date'" },
                    "then": { "type": "we-timestamp", "props": { "value": { "$": "row[field.name]" }, "relative": true } },
                    "else": {
                      "type": "$if",
                      "props": {
                        "condition": { "$": "field.kind == 'boolean'" },
                        "then": { "type": "we-badge", "children": [{ "$": "row[field.name] ? 'Yes' : 'No'" }] },
                        "else": { "type": "we-text", "children": [{ "$": "row[field.name]" }] }
                      }
                    }
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
\`\`\`

Nothing here names a property of \`Sighting\`. \`row[local.display.title]\` reads whichever property the
declaration (or the derivation) says is the title; the detail rows switch on \`field.kind\`, which is
resolved once in the store so a template switches on one word. Add branches for \`image\`, \`url\`,
\`color\` and \`longText\` as a layout needs them — the kinds are listed under \`recordStore.displays\`.

The \`$localState\` holding the display is a convenience: \`recordStore.displays['Sighting']\` could be
read in place each time. For a feed of *mixed* types, index by the row instead —
\`recordStore.displays[row.type]\` — and the same card draws every kind of record the space holds.

### A group of faces with a count

\`\`\`json
{
  "type": "Row",
  "props": { "gap": "300", "ay": "center", "minHeight": "32px" },
  "children": [
    {
      "type": "AvatarStack",
      "props": {
        "avatars": { "$": "spaceStore.members.map(m, { image: m.avatar, hash: m.did })" },
        "max": 5, "size": "sm", "ring": "0 0 0 2px var(--we-ring-color)"
      }
    },
    {
      "type": "Row",
      "props": { "gap": "100", "ay": "center" },
      "children": [
        { "type": "we-number", "props": { "value": { "$": "count(spaceStore.members)" }, "shorten": true } },
        { "type": "we-text", "children": [{ "$": "plural(count(spaceStore.members), 'Member', 'Members')" }] }
      ]
    }
  ]
}
\`\`\`

**When the items are bare DIDs rather than profiles**, join each to its profile inside the
comprehension — the variable is the DID itself:

\`\`\`json
"avatars": { "$": "spaceStore.memberDids.map(did, { image: find(profileStore.profiles, { did: did }).avatar, hash: did })" }
\`\`\`

\`minHeight\` on the row is worth keeping: \`AvatarStack\` has no height with no avatars, and people
resolve later than the record they belong to, so without a floor the row collapses and then pushes
everything below it down a second time.

### Page shell — a route's outer box

\`\`\`json
{
  "type": "Column",
  "props": { "width": "100%", "ax": "center" },
  "children": [
    {
      "type": "Column",
      "props": { "width": "100%", "maxWidth": "var(--we-layout-lg)", "gap": "500", "px": "400", "py": "500" },
      "children": ["…"]
    }
  ]
}
\`\`\`

Two Columns, because centring and constraining are different jobs: the outer spans the viewport so
the route's background reaches the edges, the inner holds the measure.

### Titled section on a card

\`\`\`json
{
  "type": "Card",
  "props": { "bg": "surfaceSunken", "border": "1px solid border" },
  "children": [
    {
      "type": "Column",
      "props": { "gap": "100" },
      "children": [
        { "type": "we-text", "props": { "variant": "heading-md" }, "children": ["About this space"] },
        { "type": "we-text", "children": ["Manage how this space appears to others."] }
      ]
    },
    "…"
  ]
}
\`\`\`

### Labelled attribute with an optional control

\`\`\`json
{
  "type": "Row",
  "props": { "ay": "center", "ax": "between", "wrap": true },
  "children": [
    {
      "type": "Row",
      "props": { "ay": "center", "gap": "400", "py": "100" },
      "children": [
        { "type": "we-icon", "props": { "name": "globe", "color": "accentText" } },
        {
          "type": "Column",
          "props": { "gap": "100" },
          "children": [
            {
              "type": "Row",
              "props": { "gap": "300" },
              "children": [
                { "type": "we-text", "props": { "fontWeight": "bold", "color": "text" }, "children": ["Discovery:"] },
                { "type": "we-text", "props": { "fontWeight": "bold" }, "children": ["Listed"] }
              ]
            },
            { "type": "we-text", "props": { "variant": "body" }, "children": ["Appears on the WE discovery globe"] }
          ]
        }
      ]
    },
    { "type": "we-switch", "props": { "checked": true, "onChange": { "$action": "…" } } }
  ]
}
\`\`\`

Drop the outer \`Row\` and the control for the read-only form.

### A rail that opens on hover — collapsed navigation

The shape of WE's shell sidebar: a narrow strip of icons that widens when pointed at, with the
labels opening sideways beside them.

Three pieces of state do all of it, and none of it needs a component. The shell owns \`expanded\`
and writes it from \`onMouseEnter\`/\`onMouseLeave\`; every label reads it. Groups hold their
collapsed ids in one \`array\` field rather than a boolean each, which is what lets the groups
themselves come from a \`$query\`.

\`\`\`json
{
  "type": "Column",
  "$localState": {
    "expanded": { "type": "boolean", "initial": false, "persist": "shell.sidebarExpanded" },
    "collapsedGroups": { "type": "array", "initial": [] }
  },
  "props": {
    "width": { "$": "local.expanded ? '240px' : '80px'" },
    "transition": "width 300 ease-in-out",
    "height": "100%",
    "overflow": "hidden",
    "position": "fixed",
    "bg": "page",
    "onMouseEnter": { "$setLocal": "expanded", "value": true },
    "onMouseLeave": { "$setLocal": "expanded", "value": false }
  },
  "children": [
    {
      "type": "we-button",
      "props": { "variant": "ghost", "width": "100%", "ax": "start", "gap": "300", "p": "300" },
      "children": [
        { "type": "we-icon", "props": { "name": "user" } },
        {
          "type": "$if",
          "props": {
            "condition": { "$": "local.expanded" },
            "enterTransition": [{ "type": "reveal", "axis": "inline", "duration": 250 }, { "type": "fade", "duration": 150 }],
            "exitTransition": [{ "type": "reveal", "axis": "inline", "duration": 250 }, { "type": "fade", "duration": 150 }],
            "then": { "type": "we-text", "props": { "truncate": true }, "children": ["Profile"] }
          }
        }
      ]
    }
  ]
}
\`\`\`

The label is mounted only while the rail is open rather than narrowed to nothing: at collapsed width
there is no room for it, and a hidden-but-present label is still in the accessibility tree and still
found by find-in-page.

A group heading toggles its own id in the set, and its body reveals on the block axis:

\`\`\`json
{
  "type": "we-button",
  "props": { "variant": "ghost", "onClick": { "$toggleLocalIn": "collapsedGroups", "value": "spaces" } },
  "children": [
    {
      "type": "we-icon",
      "props": {
        "name": {
          "$if": {
            "condition": { "$": "'spaces' in local.collapsedGroups" },
            "then": "caret-right",
            "else": "caret-down"
          }
        }
      }
    },
    { "type": "we-text", "children": ["Spaces"] }
  ]
}
\`\`\`

**Prefer \`railShell\` / \`railGroup\` / \`railItem\` from \`@we/template-kit\`**, which own all
of the above. \`railItem\` and \`railGroup\` read \`expanded\` from the shell above them, so they
are only valid inside a \`railShell\`.

For drag-to-reorder, wrap a group's items in \`we-sortable\` and give each row a \`data-we-id\` on
a **native element** — a web component's props are assigned as DOM properties, so the attribute
\`we-sortable\` looks for would never exist on a \`we-button\`. Listen with \`onReorder\` and read
the new order from \`{ "$": "arg.detail" }\`.
`;
