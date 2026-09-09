# Paddle currency release × generated TypeScript client

This case combines a **published billing change** with **unedited output from
Orval 8.30.0**. Paddle added CLP and PEN on [March 4, 2026](https://developer.paddle.com/changelog/2026/clp-pen-currencies/).
The test checks a two-field subscription projection, not a full Paddle SDK.

## Source and projection

- Before: [`aa62eb37`, February 2, 2026](https://github.com/PaddleHQ/paddle-openapi/blob/aa62eb37864619316b5e33f4abc5b35bb9b52071/v1/openapi.yaml).
- After: [`540ea173`, July 9, 2026](https://github.com/PaddleHQ/paddle-openapi/blob/540ea17369325ff866b65ecf6c5105592f16fb5d/v1/openapi.yaml).

These snapshots bracket the release; they are not claimed to be the immediately
adjacent publication commits. `upstream/v1.json` and `v2.json` preserve complete
`Subscription`, `SubscriptionId`, and `CurrencyCode` components. Raw YAML download
hashes, immutable URLs, fixture hashes, and generator version are in provenance.

`project-spec.mjs` projects `Subscription.id` and `currency_code`, resolving their
known scalar references. It preserves requiredness, scalar validation keywords,
and currency enums. The `x-enum-descriptions` display metadata is omitted; the
subscription-specific currency description is retained. Both projections use the
same authored GET/response-envelope harness. No currency or target change was
invented. This projection is outside the engine; AutoPatch still does not claim
general `$ref` resolution. The rest of the API and snapshot changes are excluded.

`project/generated/` is exact Orval output from v1. `consumer.ts`, bindings,
compiler settings, and the HTTP server are authored harness code. The generator
runs separately; the migration test does not regenerate the target or depend on
Orval being installed. Orval and Paddle licenses are included.

## Observable checks

Run `npm test -- tests/paddle-release.test.ts` from the repository root.

1. Hash the pinned fixture, run the generated client against an ephemeral loopback
   HTTP server, then migrate through the real CLI with verified writes.
2. Exactly one generated model changes; the fetch client stays byte-identical.
   USD observations are preserved, then CLP and PEN responses are displayed. All
   four requests are GET `/subscriptions/sub_example`, status 200.
3. An alternate consumer uses an exhaustive, explicitly authored currency allowlist.
   The new keys have no decisions, so TS2739 blocks the patch and leaves the model
   and consumer unchanged. Enabling newly supported markets is not inferred.

The server returns reviewed response examples; no Paddle account is contacted.
This checks transport and selected consumer observations, not amount formatting,
FX, tax, payment acceptance, or a real account's behavior. CLP's lack of a subunit
is an example of why compile success cannot establish correct billing arithmetic.
The allowlist is illustrative application policy, not a provider requirement.

## Reproduce

Run `node tests/fixtures/paddle-release/project-spec.mjs` to reproduce both
projection files from the checked-in upstream excerpts. To audit the excerpts,
download the two immutable YAML sources, verify their raw hashes, safely parse
YAML, and compare the three complete components with `upstream/`.

To regenerate the client without adding project dependencies, copy this fixture
to a temporary directory. Inside that copy, copy `generator-package.json` to
`package.json` and `generator-lock.json` to `package-lock.json`, run `npm ci`, then
`npx --no-install orval --config ./orval.config.mjs`. Compare `project/generated/`
byte-for-byte with the checked-in output. The lock records the entire generator
installation; normal AutoPatch tests and CI use only the repository dependencies.
