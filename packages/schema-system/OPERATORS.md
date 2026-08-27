# Schema Operators Reference

What a schema may write besides components, and how the pieces relate. The full authoring reference
— with every function, store and pattern — is the generated `CLAUDE.md`; this page is the map.

## Four layers, and which ones are tokens

The `$`-constructs a schema writes are four different kinds of thing:

| Layer         | What it is                                                         | Spelling                                                                                                               |
| ------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Structure** | Arrangement — what renders where                                   | Node types: `$each`, `$if`, `$routes`, `$animate`, `$single`, `$surface`, `$slot`, `$agent`; `$localState`, `$queries` |
| **Query**     | What the backend is asked for                                      | `{ $query: { entity, where, order, include, … } }` and `$queries`                                                      |
| **Handlers**  | What happens on an event                                           | `$action`, `$setLocal`, `$toggleLocal`, `$toggleLocalIn`, `$callLocal`, `$touch`, `$resetLocal`                        |
| **Values**    | Anything computed — a condition, a label, a count, a filtered list | **One expression:** `{ $: "count(local.rows) > 0 && local.search != ''" }`                                             |

The first three stay data tokens on purpose. Structure is what section-level remixing operates on;
a query is an IR the backend pushes down; handlers are a closed set of verbs because capability
grants and `destructive` flags attach to verbs. The value layer is where forty operators had
accreted, and it is now a language with a closed grammar and an open function library.

## The expression language

```
{ "$": "<expression>" }
```

**References** start from a store (`spaceStore.members`, `modules.notes.open`), `local` (a
`$localState`/`$queries` field), a name bound by `$each`/`$single`/`$agent` (`post.title`; the
default is `item`), `index`/`prev`, `me`/`currentDataset`, `surface`, or `event`/`arg`/`result`
inside a handler. A plain string is always a literal. A store's actions are unreachable.

**Operators**, in JavaScript's spelling and precedence: `== !=`, `< > <= >=`, `in` (list
membership), `! && ||` (answering with booleans), `??` (fallback value), `a ? b : c`, `+ - * / %`,
`` `…${expr}…` `` interpolation, `a.b` and `a[i]` reads, `[…]` and `{ key: value }` literals.

**Comprehensions** — the one place a name is bound: `items.filter(x, …)`, `.map(x, …)`,
`.find(x, …)`, `.exists(x, …)`, `.all(x, …)`.

**Functions** — `f(a, b)` and `a.f(b)` are the same call; a value's own methods are never callable.
The library is in [`shared/src/expressions/functions.ts`](shared/src/expressions/functions.ts) and
is listed in the generated reference from that registry. Host-registered sources
(`packages/app-shell/src/shared/sources/index.ts`) are callable the same way.

**Where-objects** — `filter(items, { role: 'admin', name: { contains: local.search } })` — are the
same grammar `$query`'s `where` takes: equality, list membership, `not`, `contains`, `startsWith`,
`endsWith`, `exists`, and `OR`/`AND`/`NOT`.

**Total and inert.** A missing path is `undefined`, arithmetic on a non-number is on 0, a
comprehension over a non-list is empty; nothing throws during paint. Property reads reach data only;
`__proto__`, `constructor` and `prototype` are refused by the parser; a function met on the way is
read only if it is a tagged accessor — a store's actions are unreachable from a value.

**Checked statically.** `we-validate-schemas` parses every expression and reports, with a column:
an unknown name (with "did you mean"), an unknown store member, an undeclared local, an unknown
function, a wrong argument count, prototype access — and a reference written as a plain string
(`'$item.name'`), which would render as text.

**Call time.** An expression naming `event`/`arg`/`result` at the top level of `$action`'s `args`,
or as a `$setLocal` `value`, is evaluated when the handler fires. Nested inside another token it
would be a constant; the validator refuses that.

## The grammar is closed

No new value operators, and no new syntax — ever. A need for computation is answered on the code
side of the data/code line:

- a **function in the library** (`defineFunction`; pure, total, three real uses), or
- a **host source** (registered by the deployment, catalogued into the context).

Neither touches the parser, the validator's grammar, the renderer or what an author has to learn.

## Strings are text

A plain string is a literal everywhere — in a prop, in `children`, in an `$action` argument. There
is no reference spelled as a string: `'$item.name'` renders those ten characters, and the validator
rejects it. The value operators that once lived beside the expression (`$eq`, `$and`, `$concat`,
`$count`, `$filter`, `$find`, `$plural`, `$map`, `$pick`, `$store`, `$local`, the prop-level `$if`)
are gone; each is a spelling inside the expression now.

## The tokens that remain

Documented in full in the generated reference; the short list:

- **Handlers** — `{ $action: 'store.method', args, onSuccess, onError, onFinally }`,
  `{ $setLocal: 'field', value | merge }` (an expression `value` is evaluated when the handler
  fires), `{ $toggleLocal }`, `{ $toggleLocalIn }`, `{ $callLocal }`, `{ $touch }`,
  `{ $resetLocal }`, and `{ $if: { condition, then, else } }` choosing between handlers; handler
  arrays compose them.
- **Queries** — `{ $query: … }` in a prop, `$queries` hoisted on a node.
- **Local state** — `$localState` with `validate`, `persist`, `syncParam`.
- **Structure** — `$each`, node-level `$if` (with transitions), `$animate`, `$single`, `$routes`,
  `$surface`, `$slot`, `$agent`.

## Security

An expression can name only what the template's bag holds. `templateSurface.ts` builds that bag
per tier and its walker reads every store path an expression mentions, so a reference past the
grant is reported at install time, and resolves to nothing at paint.
