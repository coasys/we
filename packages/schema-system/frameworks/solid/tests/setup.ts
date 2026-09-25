/**
 * Every test starts with no shared subscriptions and lets go of them at once.
 *
 * The pool is a module singleton keyed by entity name, so two tests asking for `Post` would otherwise
 * share one — the second test's mock never asked — and a grace period would outlive the test.
 */
import { afterEach, beforeEach } from 'vitest';

import { resetSubscriptionPool, subscriptionPoolConfig } from '../src/subscriptionPool';

beforeEach(() => {
  subscriptionPoolConfig.releaseGraceMs = 0;
  resetSubscriptionPool();
});

afterEach(() => resetSubscriptionPool());
