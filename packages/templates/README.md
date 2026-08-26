# Templates

WE's built-in UI, as data. A template is a JSON schema rendered live against
the component registry — inspectable, forkable, editable by AI in place.
These three packages are the templates WE itself ships and the toolkit they
are built from.

| Package                | Role                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@we/template-kit`     | Reusable fragments — authoring-time helpers that expand to plain schema nodes (`cardList`, `emptyState`, `marketplaceList`, `installedList`, `gatePrompt`, …). **Read `kit/CONVENTIONS.md` before adding one.** |
| `@we/template-shell`   | The shell's own surfaces as data: boot screen, settings, runtime settings, sidebar, about                                                                                                                       |
| `@we/template-default` | The built-in space templates (the default space experience, marketplace, cards routes)                                                                                                                          |

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
- All three packages have `typecheck` scripts; `pnpm typecheck` runs them.
