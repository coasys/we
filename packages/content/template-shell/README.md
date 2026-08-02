# @we/template-shell

WE's own shell surfaces, authored as templates: sidebar, settings, profile, boot screen,
marketplace, about, template editor chrome, module rail.

## Why these are a package

They are **data** — JSON node trees with no behaviour — so they version and ship independently of the
framework that renders them. That is the schema system's thesis stated as a package boundary: if the
shell's own UI were code, "the app is not the unit" would be a slogan rather than a fact about the
build.

It also keeps the schema system honest. WE's chrome is its heaviest consumer, so anything the shell
needs that templates can't express shows up here first.

## What belongs here

Shell-level `SchemaNode` / `TemplateSchema` values, and the assets they reference.

## What doesn't

Anything with behaviour. `SchemaTests` stays in `app-framework` for exactly this reason — its store
and mutation actions are real code driving models and signals, so it is a developer surface rather
than content.

The only dependency is `@we/schema-shared`, for the types.
