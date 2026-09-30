# Templates

WE's built-in UI, as data. A template is a JSON schema rendered live against
the component registry — inspectable, forkable, editable by AI in place.
These packages are the templates WE itself ships and the toolkit they are
built from.

| Package                 | Role                                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@we/template-kit`      | Reusable fragments — authoring-time helpers that expand to plain schema nodes (`cardList`, `emptyState`, `marketplaceList`, `installedList`, `gatePrompt`, …). **Read `kit/CONVENTIONS.md` before adding one.** |
| `@we/template-shell`    | The shell's own surfaces as data: boot screen, settings, runtime settings, sidebar, about                                                                                                                       |
| `@we/template-default`  | The built-in space templates (the default space experience, marketplace, cards routes)                                                                                                                          |
| `@we/template-views`    | A space's **sections** — about, cards, graph, globe, tasks, calendar, flux. One section, not a whole interface: `meta.role: 'view'`. See [docs/architecture/views.md](../../docs/architecture/views.md)         |
| `@we/template-showcase` | Whole-interface templates showing what the system can express — Discord, Twitter, Instagram, YouTube, Kanban, Events shapes                                                                                     |
| `@we/template-fixtures` | Sample data the preview harness and the template screenshots render against. Not shipped                                                                                                                        |

**Shell or view?** A shell owns a space's chrome, arrangement and route table;
a view renders one section inside one. `meta.role` says which, and absent means
shell. A shell marks where its sections go with `{ path: '$views' }` rather than
hardcoding them, and reads `spaceStore.viewNav` rather than writing a nav strip
from a literal array — those two lists have drifted before.

Both, plus fragments, are contribution surfaces:
[docs/contributing/surfaces.md](../../docs/contributing/surfaces.md) has what
registers each one.

## Why fragments exist

Templates copied from templates drift — the audit's `TemplatesList`/
`ThemesList` pair diverged exactly this way. A fragment holds a decision once
(what an empty state says while a query is in flight, how a marketplace row
wires install + spinner) and every template that expands it stays correct
together. The extraction threshold and the options-object API rules live in
`kit/CONVENTIONS.md`; the architecture story is
`docs/architecture/template-fragments.md`.

## Working here

- Everything is plain data + pure functions: no framework imports anywhere in
  this directory.
- Validate after any schema change: `pnpm --filter @we/schema-shared validate`
  (covers `app-shell`'s schemas, `templates/shell`, `default`, `views`, `showcase`
  and `module-system`).
- Then `pnpm --filter @we/schema-shared role-audit` — it walks the _composed_ tree,
  so it attributes nodes a fragment from another package contributed, which no grep
  over source can do.
- The kit's contracts are tested: `pnpm --filter @we/template-kit test`
  asserts each fragment's expansion.
- Every package here has a `typecheck` script; `pnpm typecheck` runs them all.
