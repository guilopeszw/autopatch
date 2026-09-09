/** Local subscription adapter for the five fields used by this case study. */
export interface Subscription {
  id: string;
  status: 'active' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'past_due' | 'paused' | 'trialing' | 'unpaid';
  cancel_at_period_end?: boolean | null;
}
