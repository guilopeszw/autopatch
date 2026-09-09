# Subscription-billing contract evidence

The primary product focus is maintaining TypeScript integrations with Stripe,
Paddle, Chargebee, and Recurly. Provider names select examples, not codemods. Every
case uses the generic diff, AST, compiler gate, report, and persistence path.

| Provider | Contract under test | Verified example | Blocked counterpart |
| --- | --- | --- | --- |
| [Stripe](../stripe/README.md) | Five subscription fields, Acacia → Basil | Remove legacy billing periods; accept nullable cancellation flag | Consumer still reads a removed billing period |
| Paddle | `CustomerPortalSessionUrlsSubscriptionsItem` | Add the required payment-update link to a local response model whose consumer already supplies it | A constructed response lacks the required link |
| Chargebee | `Subscription.id`, `status`, `auto_collection` | Admit the published `paused` state; preserve the active-state view | An exhaustive state-label function has no paused policy |
| Recurly | Complete `SubscriptionPause` request body | Require a pause length; insert the example's explicitly configured one-cycle value | No configured value exists for an omitted pause length |

Only Stripe is a **historical API release migration**. The other three use
unchanged published target property contracts with **authored adapter baselines**:
Paddle's baseline omits one required link; Chargebee's union omits `paused`;
Recurly's baseline incorrectly makes the pause length optional. We do not claim
the providers ever published those baselines. The adapters and runtime inputs
are authored. They are not complete official SDKs, production client integrations,
or proof of all subscription lifecycle behavior.

## Pinned sources

- Paddle: [`PaddleHQ/paddle-openapi@540ea173`](https://github.com/PaddleHQ/paddle-openapi/blob/540ea17369325ff866b65ecf6c5105592f16fb5d/v1/openapi.yaml).
- Chargebee: [`chargebee/openapi@2c7ce2c8`](https://github.com/chargebee/openapi/blob/2c7ce2c8a72c7393bece50ff418033130bdc9591/spec/chargebee_api_v2_pc_v2_spec.json).
- Recurly: [`recurly/recurly-client-go@0dcfa5b9`](https://github.com/recurly/recurly-client-go/blob/0dcfa5b9f620071c5c5b4a6c236fe85198fae600/openapi/api.yaml).

Each directory contains the upstream license and `provenance.json` with an
immutable source URL, raw-download SHA-256, selected component/properties, and
checked-in hashes. YAML inputs were converted with Ruby's standard Psych safe
loader. Targets preserve full selected property definitions. Paddle includes its
unchanged `SubscriptionId` dependency; Recurly includes the complete selected
request object. Chargebee projects three fields and their requiredness. Paths
and unrelated components are excluded. Tests check the recorded fixture hashes.

## Run

```sh
npm test -- tests/subscription-billing.test.ts tests/stripe-release.test.ts
```

Runtime checks execute only the small reviewed fixture adapters and compare
literal observations. They make no network requests or financial operations.
Recurly's expected request intentionally changes from `{}` to
`{ remaining_pause_cycles: 1 }`; the value comes from the fixture's bindings, not
an inferred provider default. A real user must supply their own policy.

The workflow's writable copies live in `examples/`. The immutable fixtures stay
unchanged when automated migration PRs are merged. Brex and Ramp remain secondary
provider-independent examples under `tests/fixtures/providers/`.
