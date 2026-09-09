/** Local request contract that incorrectly permits an omitted pause length. */
export interface SubscriptionPause { remaining_pause_cycles?: number }

/** Fixture transport: returns a request value; never calls Recurly. */
export const pauseSubscription = (request: SubscriptionPause) => request;
