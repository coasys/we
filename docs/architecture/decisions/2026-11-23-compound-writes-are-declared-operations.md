# A write of several records is a declared operation, not store code

**Status:** Accepted

**Decision.** Writes that model CRUD can't express — several writes in a set order, or a read that
decides the next write — are declared as data in a model manifest's `operations`, from a closed set of
steps with values in the expression language's core subset, and run by one neutral runner in
`@we/entities` inside one transaction. Stores, templates, modules, bundles and the agent tools call
the operation; host code keeps only what data can't do (uploads, derived fields, merges, service
calls, optimistic holds, queues, undo). The JSON is canonical; a backend binds it.

**Why.** Written as store code, a compound write existed only in this app, in TypeScript, and was
written again wherever else something needed to make the same write — the agent tools had already
drifted from the composer. Nothing could say what one wrote before it ran, so a template could reach
it only as an opaque member. Declared, the same writes run identically everywhere, another
implementation runs them from the file, and because the steps are closed their effects are listable:
a template is granted an operation by the capability group its writes reach, and a destructive one is
confirmed in words derived from what it does. The rules that make that safe sit in the backend, not
the runner: each primitive write passes the write check, which sees the transaction's own staged
records, and an operation can't write the policy entities.

**Rejected.**

- _Keep compound writes as store methods._ Unportable by construction, duplicated per caller, and
  opaque to the capability model.
- _Named operations with a code body_ (GraphQL mutations, OData actions, Lexicon procedures). The name
  is portable but the body isn't, so a second host rewrites every operation and nothing can list one's
  writes before it runs.
- _An open step set or host functions in operation expressions._ Each addition is an unportable escape
  hatch; anything an operation needs that the core lacks is computed by the host and passed in.
- _A backend's own write language as the canonical form_ (a graph backend's per-record
  actions, or RDF updates). It would route every other backend through one backend's model; compiling down from
  records to a backend's writes is natural, lifting up is lossy.
- _The runner hands the write check the record as it stands._ Any caller able to supply that record
  could get round the policy, so the backend answers it from its own staged writes instead.

**Revisit when.** A common write can't be expressed without host functions in the operation (the step
set is too weak), or a backend can run operations natively and atomically across agents, which would
let preconditions mean more than "on this replica, at commit".

Details: `packages/entities/CONVENTIONS.md` ("Declaring an operation"), `docs/architecture/space-policy.md`,
`docs/architecture/capabilities-and-surfaces.md`.
The format, normatively, with its conformance vectors: [`docs/spec/operations/`](../../spec/operations/README.md).
