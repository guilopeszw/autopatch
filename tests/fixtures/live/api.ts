/** Local contract for the provider smoke test; no network or side effects. */
export interface Input { count: string }
export function submit(input: Input): void { void input; }
