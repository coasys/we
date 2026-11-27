/**
 * The neutral write group, on AD4M: `Ad4mModel.transaction` over one perspective.
 *
 * The SDK opens a batch, hands its id to the callback, and commits the batch when the callback
 * resolves. When the callback throws it discards the batch and rethrows — so nothing the group
 * staged lands, and the batch does not stay open on the executor until it times out. That is what
 * `runEntityTransaction` promises, and `transactions.test.ts` holds this runner to it, so a pin of
 * the SDK that stopped discarding would fail there rather than leave batches open in the field.
 *
 * Where it falls short of "all or nothing" is the executor's commit, not this runner, and the live
 * conformance run says where. A write that goes to a language call rather than to the perspective
 * runs outside any batch, so it is not undone either.
 */
import { Ad4mModel, type PerspectiveProxy } from '@coasys/ad4m';
import type { EntityTransactionRunner } from '@we/entities';

export const runAd4mTransaction: EntityTransactionRunner = (dataset, run) =>
  Ad4mModel.transaction(dataset as PerspectiveProxy, (tx) => run({ batchId: tx.batchId }));
