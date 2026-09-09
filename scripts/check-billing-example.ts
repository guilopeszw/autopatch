/** Approved, offline application checks for the four writable billing examples. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const provider = process.argv[2];
if (!provider || !["stripe", "paddle", "chargebee", "recurly"].includes(provider)) throw new Error("Choose stripe, paddle, chargebee, or recurly");
const consumer = await import(pathToFileURL(resolve(`examples/${provider}/project/consumer.ts`)).href) as {
  display?: (input: unknown) => unknown;
  observe?: () => unknown;
};
if (provider === "stripe") {
  assert.equal(typeof consumer.display, "function");
  assert.deepEqual(consumer.display!({ id: "sub_example", status: "active", cancel_at_period_end: true }),
    { id: "sub_example", label: "Active", cancellationScheduled: true });
  assert.deepEqual(consumer.display!({ id: "sub_example", status: "active", cancel_at_period_end: null }),
    { id: "sub_example", label: "Active", cancellationScheduled: false });
} else {
  assert.equal(typeof consumer.observe, "function");
  const expected = provider === "paddle" ? { cancelUrl: "https://example.invalid/cancel" }
    : provider === "chargebee" ? { active: true } : { remaining_pause_cycles: 1 };
  assert.deepEqual(consumer.observe!(), expected);
}
process.stdout.write(`${provider}: application observation passed\n`);
