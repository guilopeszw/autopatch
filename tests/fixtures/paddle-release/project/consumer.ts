import { getSubscription } from './generated/client.js';

/** Display identifiers without imposing exchange-rate or minor-unit policy. */
export async function observe() {
  const response = await getSubscription('sub_example');
  return { status: response.status, subscription: response.data.data.id, currency: response.data.data.currency_code };
}
