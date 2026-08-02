# @we/template-default

WE's built-in space templates — the default template a new space renders, plus alternates.

Data, not code: a template is a JSON node tree, so these ship and version independently of the
framework that renders them. Depends on `@we/schema-shared` for the types and `@we/template-shell`
for shared shell fragments (the create-space modal), and on nothing else — no framework, no backend,
no knowledge of what holds the data.

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
