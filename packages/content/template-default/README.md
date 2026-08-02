# @we/template-default

WE's built-in space templates — the default template a new space renders, plus alternates.

Data, not code: a template is a JSON node tree, so these ship and version independently of the
framework that renders them. Depends on `@we/schema-shared` for the types and `@we/template-shell`
for shared shell fragments (the create-space modal), and on nothing else — no framework, no backend,
no knowledge of what holds the data.
