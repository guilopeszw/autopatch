# Stripe Acacia → Basil: a real release, a bounded adapter

This case migrates **five subscription fields** from Stripe API
`2025-02-24.acacia` to `2025-03-31.basil`. It is not a full Stripe SDK upgrade.
The local TypeScript adapter and response examples are authored for AutoPatch;
the old and new property contracts come from two independently published Stripe
specifications. No rename hints or invented target changes are inserted.

## Evidence and scope

- Old spec: [`5a411d0`](https://github.com/stripe/openapi/blob/5a411d0d1e527229cdb4d6633197ab8009899ce6/openapi/spec3.json).
- New spec: [`9fa5188`](https://github.com/stripe/openapi/blob/9fa5188b0933d46d2ac3c601d2d9c50904fb54de/openapi/spec3.json).
- [Stripe's billing-period migration guidance](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end).

`upstream/before.json` and `upstream/after.json` contain the original info and
complete `subscription` and `subscription_item` schema objects. Stripe's MIT
license is in `upstream/LICENSE`. `provenance.json` records immutable URLs, the
SHA-256 of each downloaded full spec, and the SHA-256 of each checked-in excerpt
and projection. To audit, download those URLs, verify their hashes, and compare
the two component objects with the excerpts. Tests verify checked-in hashes and
that selected property contracts and requiredness match the upstream excerpts.

`v1.json` and `v2.json` project exactly `id`, `status`, `cancel_at_period_end`,
`current_period_start`, and `current_period_end`; properties absent upstream stay
absent. They preserve every selected property keyword and filter `required` to
those fields. They intentionally exclude paths, other fields, and schema-level
Stripe expansion metadata. The full release contains additional changes outside
this adapter. Passing this case is not evidence of whole-release coverage.

## What is demonstrated

The engine removes both subscription-level billing-period fields and changes
`cancel_at_period_end` from required boolean to optional nullable boolean.
The account-display consumer continues returning the same observation on the
authored old/new response examples. These are offline behavioral checks, not
live Stripe calls or exhaustive contract validation.

A second consumer reads `current_period_end`. AutoPatch refuses to persist that
migration with TS2339 and preserves both files. Choosing which subscription
item's period to display requires a product decision; compilation cannot decide
that policy.

```sh
npm test -- tests/stripe-release.test.ts
npm run autopatch -- --from tests/fixtures/stripe/v1.json --to tests/fixtures/stripe/v2.json --project tests/fixtures/stripe/project/tsconfig.json --bindings tests/fixtures/stripe/project/bindings.json --json
```

The test copies the project to a temporary directory before applying edits.
Keep the checked-in baseline unchanged.
