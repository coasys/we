/**
 * Reading a record's place in a workflow, through the same port the app's Workflows page reads.
 */
import { until } from '../harness.mjs';

/** One read of a workflow's records: the port's `watch`, answered once and let go. */
export async function workflowView(ports, perspective, workflow) {
  let stop = () => {};
  const view = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no view of workflow ${workflow} in 30s`)), 30_000);
    ports.workflows
      .watch(perspective, workflow, (v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .then((unwatch) => (stop = unwatch), reject);
  });
  stop();
  return view;
}

/** Where a record stands in a workflow, and what is waiting on it; null when it is not in it. */
export async function itemOf(ports, perspective, workflow, record) {
  return (await workflowView(ports, perspective, workflow)).items.find((i) => i.record === record) ?? null;
}

/** Waits until a record's item in a workflow satisfies `accept`. */
export function untilItem(ports, perspective, workflow, record, accept, what, timeout = 120_000) {
  return until(
    () => itemOf(ports, perspective, workflow, record),
    (item) => Boolean(item) && accept(item),
    {
      timeout,
      interval: 1_500,
      what,
    },
  );
}
