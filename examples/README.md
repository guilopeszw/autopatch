# Reviewable migration examples

These are writable demonstrations for the GitHub workflow. Tests use separate,
immutable fixtures, so applying a demo migration does not invalidate the test
baseline. Each example supplies a target contract, a recorded baseline, a local
adapter, and ordinary provider-independent bindings.

| Example | Evidence |
| --- | --- |
| `stripe` | [Five-field Acacia → Basil subscription case](../tests/fixtures/stripe/README.md), with pinned historical schemas |
| `brex` | [Published Address contract](../tests/fixtures/providers/README.md), authored incomplete adapter baseline |
| `ramp` | [Published cardholder contract](../tests/fixtures/providers/README.md), authored incomplete adapter baseline |

The source attribution, hashes, and limitations in those fixture documents also
apply to these copies. The Stripe excerpts are covered by the included upstream
license. These are local adapters, not complete provider SDKs or authenticated
account integrations.

See [workflow operation and adoption](../docs/schema-migration-workflow.md) and
[the review report](../docs/review-report.md). All three use the same engine.
