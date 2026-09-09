import { pauseSubscription } from './api.js';

/** The example's bindings explicitly select one billing cycle for an omitted value. */
export const observe = () => pauseSubscription({});
