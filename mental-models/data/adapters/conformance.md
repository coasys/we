# Conformance suite

`describeBackendConformance(name, harness)` runs one suite of the backend contract's behaviour against one backend. The cases are written against the contract alone, and each backend gives a `ConformanceHarness` that makes a fresh dataset for each case.

**Why:** A suite that runs only against the in-memory adapter proves only that the reference agrees with itself. With one suite for every backend, a difference between AD4M and the reference fails a test instead of showing up on screen. A known failure is listed with its reason and runs inverted, never skipped, so the suite also tells when the gap closes.

**Parent:** [Adapters](README.md)

<details><summary>How it works</summary>

1. `harness.setup()` returns a `ConformanceSubject`: `ports`, a `dataset` with the space schema installed and no records, and the `agent` id. `teardown` is optional.
2. `timing.settle` is how long a case waits for a write to come back through a live query. `timing.quiet` is how long it watches for a push that must not occur. Both are near zero for a backend that notifies synchronously.
3. `CONFORMANCE_CASES` names the cases in groups: `bindings.*`, `records.*`, `schema.*`, `relations.*`, `writes.checked-first`, `queries.several-entities`, `live.*`, `ephemeral.no-echo`, `references.referrers` and `workflows.*`.
4. `TEMPLATE_QUERY_CASES` are `$query`s taken from shipped templates, routed as the renderer routes them (`routeQuery`, then `findAll`) against one seeded space. The expected answers are written by hand, and the in-memory backend is the reference for them.
5. A case in `knownGaps` runs inverted: it passes while the gap is open and fails when the gap closes. A case in `knownIntermittent` is retried on a fresh subject.

| Backend   | Where it runs                             | How                                                               |
| --------- | ----------------------------------------- | ----------------------------------------------------------------- |
| in memory | `inmemory/tests/portsConformance.test.ts` | the ordinary tests                                                |
| AD4M      | `ad4m/tests/live/conformance.live.ts`     | `test:live` (`vitest.live.config.ts`), against a running executor |

</details>

<details><summary>Where in the code</summary>

- [packages/backend-system/conformance/src/index.ts](../../../packages/backend-system/conformance/src/index.ts): `describeBackendConformance`, `ConformanceHarness`, `ConformanceSubject`, `CONFORMANCE_CASES`.
- [packages/backend-system/conformance/src/templateQueries.ts](../../../packages/backend-system/conformance/src/templateQueries.ts): `TEMPLATE_QUERY_CASES`, `describeTemplateQueries`.
- [packages/backend-system/inmemory/tests/portsConformance.test.ts](../../../packages/backend-system/inmemory/tests/portsConformance.test.ts): the in-memory harness.
- [packages/backend-system/ad4m/tests/live/conformance.live.ts](../../../packages/backend-system/ad4m/tests/live/conformance.live.ts): the AD4M harness and its known gaps.

</details>
