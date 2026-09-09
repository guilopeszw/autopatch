import type { CustomerPortalSessionUrlsSubscriptionsItem } from './api.js';

/** Return a supplied portal link without fetching or following it. */
export const cancelLink = (urls: CustomerPortalSessionUrlsSubscriptionsItem) => urls.cancel_subscription;
export const observe = () => ({ cancelUrl: cancelLink({
  id: 'sub_example', cancel_subscription: 'https://example.invalid/cancel',
  ...{ update_subscription_payment_method: 'https://example.invalid/update' },
}) });
