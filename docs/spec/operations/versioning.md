# Operations: versioning and evolution

Three things carry versions, and they move independently:

| What                    | Where                              | Changes when                                                                    |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| This spec               | The top of the [README](README.md) | The format or its semantics change.                                             |
| A manifest's operations | The manifest's `version`           | Its author changes an operation incompatibly ([below](#changing-an-operation)). |
| A bundle file's format  | The bundle's `formatVersion`       | The bundle carries something an older reader cannot read.                       |

## The spec

A minor version of this spec adds to the format (a new step field with a default that keeps today's
meaning, a new core function, a new category) without changing what any valid operation already
does. A major version may change meaning. An implementation SHOULD state the spec version it
implements, and MUST refuse an operation that uses a step, a step field, a category or a function it
does not know, rather than run it partly.

> **Why refuse.** The step set and the step objects are closed for the same reason: an
> implementation that skipped what it did not understand would run a different operation from the
> one written, and report success.

## Changing an operation

The rules follow AT Protocol Lexicon's for evolving a schema: once an operation is published under a
name, a change that could make an existing caller, an existing replay or an existing consent wrong is
not made under the same version.

**Compatible** (the manifest's `version` MAY stay):

- adding an optional param;
- making a required param optional;
- adding an error name, provided callers treat an error code they do not know as a generic
  precondition failure, which they MUST;
- changing `description`, a param's `description`, or an error's message;
- changing the steps in a way that leaves, for every invocation, the same records written with the
  same ids and fields, the same result, and an effect summary that is the same or narrower.

**Incompatible** (the manifest's `version` MUST change, or the operation takes a new name):

- removing a param, renaming one, or changing its type;
- making an optional param required;
- removing an error name a caller may handle, or raising it under different conditions;
- changing what `returns` gives;
- any change to the effect summary that widens it: a new entity, category or verb, or a write moved
  into a `forEach`, or a new `delete`, `unlink` or `setRelation` (which makes it destructive);
- any change to the steps that changes the [step path](execution.md#ids) of a `create`: reordering,
  inserting or removing steps before one, changing a `forEach`'s `key`, or routing it through a
  different `call`. Ids derived for an existing invocation would change, so a replay would create
  new records instead of being refused.

Renaming an operation is removing one and adding another.

A caller MAY send the `version` it wrote against with each invocation; a runner holding a different
version of that namespace MUST then refuse it with static `versionMismatch` rather than run an
operation the caller did not mean. A version is opaque text, compared for equality only.

> **Why the effect summary decides.** Permission and confirmation are derived from it
> ([Execution](execution.md#permission-and-confirmation)). A wider summary under the same version
> would let an operation a template was granted, or a person consented to, start writing something
> nobody granted.

## Bundles

A bundle, a file carrying a whole app as data, carries its operations top-level, in `operations`,
keyed by bare name; the host registers them under the bundle's id as namespace. Bundle format
versions:

| `formatVersion` | Contents                     |
| --------------- | ---------------------------- |
| `1`             | A bundle without operations. |
| `2`             | Format 1, plus `operations`. |

- A reader MUST refuse a `formatVersion` it does not know.
- A writer MUST stamp the lowest format that holds what the bundle carries, so a bundle without
  operations stays format 1 and a host that reads only format 1 still reads it.
- A reader MUST refuse a file claiming format 1 that carries `operations`.
- A bundle MUST NOT be installed under a namespace something else (a module, the host's own
  vocabulary, another bundle) already holds.

---

Implemented by: [`registry.ts`](../../../packages/entities/src/operations/registry.ts)
(`registerOperations` with `version`), [`run.ts`](../../../packages/entities/src/operations/run.ts)
(`versionMismatch`), [`bundle.ts`](../../../packages/schema-system/shared/src/bundle.ts)
(`bundleFormatVersionFor`),
[`bundleOperations.ts`](../../../packages/app-shell/src/shared/bundles/bundleOperations.ts) (a
bundle's namespace).
Pinned by: [`bundle.test.ts`](../../../packages/schema-system/shared/tests/bundle.test.ts),
[`inmemory/tests/operations.test.ts`](../../../packages/backend-system/inmemory/tests/operations.test.ts)
("static errors at run time").
