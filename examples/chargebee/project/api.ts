/** Local adapter whose state union has not yet admitted the published paused state. */
export interface Subscription {
  id: string;
  status: "future" | "in_trial" | "active" | "non_renewing" | "paused" | "cancelled" | "transferred";
  auto_collection?: 'on' | 'off';
}
