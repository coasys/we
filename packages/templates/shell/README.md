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

Anything with behaviour. `SchemaTests` stays in `app-shell` for exactly this reason — its store
and mutation actions are real code driving models and signals, so it is a developer surface rather
than content.

The only dependency is `@we/schema-shared`, for the types.

## Consumed as source, not as a bundle

This package has **no build step**, and its `exports` point at `src/`.

Templates reference assets (`import forBuilders from '../assets/CTAv1/ForBuilders.jpg'`). If the
package were pre-bundled, esbuild would resolve those imports at *package* build time — emitting the
images into this package's `dist/` and freezing plain relative strings like
`"./ForBuilders-4RJHDICV.jpg"` into the JS. The consuming app's bundler cannot rewrite a plain
string, so the URLs ship unchanged and 404 at runtime: the about page renders with every image
missing, and nothing fails loudly.

Consumed as source, the **app's** bundler sees the asset imports, emits them into its own output, and
rewrites the URLs. This is the same reason `@we/app-shell` exports `./solid` as source.

Practical rule: **a package containing asset imports must be consumed as source.** Only the bundler
that emits the final output can resolve an asset URL.
