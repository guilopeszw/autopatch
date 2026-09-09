import type { Subscription } from './api.js';

/** This view intentionally asks only whether a subscription is active. */
export const isActive = (subscription: Subscription) => subscription.status === 'active';
export const observe = () => ({ active: isActive({ id: 'subscription_example', status: 'active' }) });
