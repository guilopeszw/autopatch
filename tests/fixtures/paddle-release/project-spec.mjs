/** Reproduce the bounded fixture from the included immutable upstream excerpts.
 * Resolve only these two known scalar references; this is not a general OpenAPI
 * resolver or engine feature. The transport envelope is an authored test harness.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
for (const revision of ['v1', 'v2']) {
  const schemas = JSON.parse(readFileSync(join(root, 'upstream', `${revision}.json`), 'utf8'));
  const currency = { ...schemas.CurrencyCode };
  delete currency['x-enum-descriptions']; // Display documentation; preserve type and enum verbatim.
  currency.description = schemas.Subscription.properties.currency_code.description;
  const document = {
    openapi: '3.1.0', info: { title: 'Paddle subscription currency projection', version: revision },
    paths: { '/subscriptions/{subscription_id}': { get: {
      operationId: 'getSubscription',
      parameters: [{ name: 'subscription_id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Subscription projection', content: { 'application/json': {
        schema: { type: 'object', required: ['data'], properties: { data: { $ref: '#/components/schemas/Subscription' } } },
      } } } },
    } } },
    components: { schemas: { Subscription: {
      type: 'object', required: schemas.Subscription.required.filter(property => ['id', 'currency_code'].includes(property)),
      properties: { id: schemas.SubscriptionId, currency_code: currency },
    } } },
  };
  writeFileSync(join(root, `${revision}.json`), `${JSON.stringify(document, null, 2)}\n`);
}
