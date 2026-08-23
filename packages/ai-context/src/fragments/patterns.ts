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
{ "$if": { "condition": { "$local": "searchText" },
           "then": "No posts match your search.",
           "else": "This space doesn't have any posts." } }
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
        "condition": { "$count": { "items": { "$local": "postRows" } } },
        "then": {
          "type": "Grid",
          "props": { "columns": 1, "gap": "400", "width": "100%" },
          "children": [
            {
              "type": "$each",
              "props": { "items": { "$local": "postRows" }, "as": "post" },
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

### Confirm dialog

\`\`\`json
{
  "type": "$if",
  "props": {
    "condition": { "$local": "confirmDeleteOpen" },
    "then": {
      "type": "we-modal",
      "props": { "close": { "$setLocal": "confirmDeleteOpen", "value": false } },
      "children": [
        { "type": "we-text", "props": { "fontWeight": "semibold" }, "children": ["Delete post?"] },
        { "type": "we-text", "children": ["This cannot be undone."] },
        {
          "type": "Row",
          "props": { "ax": "end", "gap": "200" },
          "children": [
            { "type": "we-button", "props": { "variant": "ghost", "onClick": { "$setLocal": "confirmDeleteOpen", "value": false } }, "children": ["Cancel"] },
            {
              "type": "we-button",
              "props": {
                "variant": "danger",
                "onClick": { "$action": "spaceStore.deleteCollection", "args": ["$post.id"],
                             "onSuccess": [{ "$setLocal": "confirmDeleteOpen", "value": false }] }
              },
              "children": ["Delete"]
            }
          ]
        }
      ]
    }
  }
}
\`\`\`

The flag must be declared by an ancestor of **the button that opens it**, not merely of the modal.
Undeclared, \`$setLocal\` warns and no-ops: the button renders, takes the click, and does nothing.

If the action is slow (a recursive delete walks its whole collection), add a \`busy\` boolean set
before it and cleared in \`onFinally\`, and bind the confirm button's \`loading\` and \`disabled\` to it.

**Tall modals — pin the title and buttons.** A modal whose content can outgrow the viewport (a
long form, a settings editor) scrolls its *content*, never its own title or its action buttons.
Give the title node \`"slot": "header"\` and the button row \`"slot": "footer"\`: both are pinned
outside the scroll region, sharing the modal's padding and gap, while the default slot scrolls.
Put a \`width\` on the \`we-modal\` itself when using these slots — no single child spans it any
more. A short confirm dialog like the one above needs none of this; the default slot alone is right.

### Composing a post — the BlockComposer save handshake

\`BlockComposer\` is **pull-based**. Its \`onSave\` does *not* fire when the user types or when a modal
closes — it fires when somebody calls the composer's own \`save()\`, which it hands out exactly once
through \`onReady\`. So the sequence is: \`onReady\` stores that function in a **\`function\`-typed**
\`$localState\` field, the button calls it with \`$callLocal\`, \`save()\` serializes the tree, and
\`onSave\` runs the action with the tree as \`$arg\`.

\`\`\`json
{
  "type": "we-modal",
  "props": { "close": { "$setLocal": "composeOpen", "value": false } },
  "$localState": {
    "savePost": { "type": "function", "initial": null },
    "submitting": { "type": "boolean", "initial": false }
  },
  "children": [
    {
      "type": "BlockComposer",
      "props": {
        "perspective": { "$store": "datasetStore.currentDataset.handle" },
        "onReady": { "$setLocal": "savePost", "from": "$event.save" },
        "onSave": [
          { "$setLocal": "submitting", "value": true },
          {
            "$action": "spaceStore.createPost",
            "args": ["$arg"],
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
        "loading": { "$local": "submitting" },
        "disabled": { "$local": "submitting" },
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

\`$arg\` goes wherever the action wants it — first for \`createPost(json, options)\`, second for
\`updatePost(postId, json)\`.

**Prefer \`composerModal\` from \`@we/template-kit\`**, which owns all of the above; write it out by
hand only when the modal itself needs a different shape.

### Form field

\`\`\`json
{
  "type": "we-form-field",
  "props": { "label": "Name", "error": { "$error": "name" } },
  "children": [
    {
      "type": "we-input",
      "props": {
        "placeholder": "Space name…",
        "value": { "$local": "name" },
        "onInput": { "$setLocal": "name", "from": "$event.detail" }
      }
    }
  ]
}
\`\`\`

\`$error\` is already empty until the field is touched, so it needs no \`$if\` around it. Which event
carries the value depends on the control: \`we-input\`/\`we-textarea\` emit \`onInput\` with
\`$event.detail\`, \`we-select\` emits \`onChange\` with \`$event.detail\`, and \`Search\` calls back
with the value itself as \`$arg\`.

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

Always set \`hash\` as well as \`image\`, never as a fallback for it: \`hash\` seeds a generated avatar
that is stable per agent, so somebody whose profile has not arrived is still visually distinct from
everybody else whose profile has not arrived. A real picture wins where there is one.

### A group of faces with a count

\`\`\`json
{
  "type": "Row",
  "props": { "gap": "300", "ay": "center", "minHeight": "32px" },
  "children": [
    {
      "type": "AvatarStack",
      "props": {
        "avatars": { "$map": { "items": { "$store": "spaceStore.members" },
                               "select": { "image": "$item.avatar", "hash": "$item.did" } } },
        "max": 5, "size": "sm", "ring": "0 0 0 2px var(--we-ring-color)"
      }
    },
    {
      "type": "Row",
      "props": { "gap": "100", "ay": "center" },
      "children": [
        { "type": "we-number", "props": { "value": { "$count": { "items": { "$store": "spaceStore.members" } } }, "shorten": true } },
        { "type": "we-text", "children": [{ "$plural": { "count": { "$count": { "items": { "$store": "spaceStore.members" } } }, "one": "Member", "other": "Members" } }] }
      ]
    }
  ]
}
\`\`\`

**When the items are bare DIDs rather than profiles**, join each to its profile — and note the trap:
inside a \`$map\` \`select\`, a string is substituted only when it starts with \`$item.\`. A bare
\`"$item"\` is a **literal**, so every generated face comes out identical. Wrap it in a token object:

\`\`\`json
"select": {
  "image": { "$find": { "items": { "$store": "profileStore.profiles" }, "where": { "did": "$item" }, "select": "avatar" } },
  "hash": { "$concat": ["$item"] }
}
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
    "width": { "$if": { "condition": { "$local": "expanded" }, "then": "240px", "else": "80px" } },
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
            "condition": { "$local": "expanded" },
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
            "condition": { "$in": ["spaces", { "$local": "collapsedGroups" }] },
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
the new order from \`$arg.detail\`.
`;
