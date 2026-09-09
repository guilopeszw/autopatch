import type { Subscription } from './api.js';

/** Missing or null cancellation flags do not mean a cancellation is scheduled. */
export function display(subscription: Subscription) {
  return {
    id: subscription.id,
    label: subscription.status === 'active' ? 'Active' : 'Needs attention',
    cancellationScheduled: subscription.cancel_at_period_end === true,
  };
}
