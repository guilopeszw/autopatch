# Test evidence

Run `npm run evaluate` for the readable report or `npm run evaluate -- --json`
for per-case results and literal runtime observations. Exit 1 means an expectation
failed. No provider is configured on this path, and CI runs it without API keys.

The corpus contains **18 curated cases: 10 completed migrations, 8 expected
rejections, 18 passing expectations, and 0 LLM requests**. The completed-migration
fraction is **10/18 (55.6%)** across this deliberately mixed acceptance/rejection
set. Safe rejection counts toward correctness, never toward migration coverage.
These authored examples are not a sampled population of real projects; production
coverage is unmeasured.

| Case | Expected behavior | Runtime observation |
| --- | --- | --- |
| Operation rename through a barrel and import alias | Complete | `person:42` preserved |
| Exported arrow operation through a barrel and alias | Complete | `person:42` preserved |
| Optional property, shorthand and destructuring | Complete | `Ada` preserved |
| Typed response property rename | Complete | `Ada` preserved |
| Optional property addition | Complete | `Ada` preserved |
| Requiredness tightened with an existing value | Complete | `Ada` preserved |
| Scalar enum widened | Complete | `active` preserved |
| Required field with a configured value | Complete | Serialized request gains `region: "eu"` |
| Multiple configured required fields | Complete | Serialized request gains `region` and `zone` |
| Nullable enum explicitly includes null | Complete | Serialized request gains `region: null` |
| Required field without a business value | Reject | Compiler errors; no patch |
| Incompatible property type | Reject | Compiler errors; no patch |
| Inferred optional producer from PR #1 review | Reject | Structural rename cannot be proven |
| Removed operation | Reject | Unsupported contract change |
| Invalid configured enum value | Reject | Value fails the destination type |
| Dynamic computed property | Reject | An inserted default could overwrite a supplied value |
| Fractional default for an integer field | Reject | Known value violates the integer constraint |
| Nullable enum excludes null | Reject | Null violates the enum despite scalar nullability |

## What is checked

Each case in `tests/fixtures/corpus/cases.ts` contains both OpenAPI revisions,
complete local SDK/consumer modules, explicit bindings, and hand-specified literal
outcomes. `evaluateCase` creates a real in-memory ts-morph Project and invokes the
same migration runner as the CLI. It verifies that planning restored every source.

Completed cases install the returned plan in memory and pass the full strict
compiler gate again. The evaluator executes both trusted fixture revisions and
compares the exported consumer `result` with independent literal expectations.
The required-region example intentionally changes its runtime outcome; other
completed cases preserve their listed observations. Rejected cases must expose
no writable files and report the expected blocking reason.

Execution uses the native TypeScript transpiler and Node's VM, with imports
restricted to the fixture modules. **VM is not a security sandbox.** This runner
is only for reviewed, repository-owned fixtures. The core planner and writer do not execute target code. Scheduled monitoring
can run explicitly configured application checks in a disposable checkout;
monitoring never enables LLM repair. The fixtures do not measure real HTTP server
behavior, latency, provider quality, or compatibility with every SDK generator.

## Extending the evidence

Add one failing case at a time through the agreed migration boundary, then
implement its smallest deterministic fix. Preserve cases that must fail safely.
Include literal runtime outcomes, not merely compiler success. Expand to actual
versioned SDK/client projects before making general coverage claims, and report
their selection criteria and denominator separately from this curated corpus.

Provider integration is a separate opt-in smoke test described in
[the CLI guide](usage.md#check-a-live-provider). A stubbed HTTP test establishes request isolation and the
compiler gate; it does not establish live model behavior.

## Independently generated SDK

`npm run test:integration` covers **1 pinned Orval v8.30.0 scenario** separately
from the 18-case authored corpus. It migrates a generated operation through CLI
preview and verified persistence, then checks actual loopback HTTP observations
before and after. The generated SDK, adapter and models remain exact upstream
copies in the repository; only a temporary target is patched. Provenance and
limits are in [the Orval fixture](../tests/fixtures/orval/README.md). The API rename target is synthetic;
the SDK itself is independently generated. No provider request occurs.

## Real API release case

The [Stripe case](../tests/fixtures/stripe/README.md) adds two CLI scenarios for
published Acacia → Basil changes: a successful five-field subscription adapter
migration with before/after behavioral observations, and a rejected consumer of
a removed billing-period field. These are separate from the authored corpus and
the generated Orval SDK scenario. The adapter and response examples are authored;
the target contract changes are upstream, with pinned provenance.

## Other provider contracts

The [Brex and Ramp cases](../tests/fixtures/providers/README.md) add four checks:
one successful adapter alignment and one safe rejection per provider. Their
targets are published component objects captured with source hashes; their
incomplete baselines are authored. Count these separately from historical release
migrations. The same engine runs all providers with no provider-specific branch.

## Subscription-billing focus

[Paddle, Chargebee, and Recurly](../tests/fixtures/billing/README.md) add six
contract checks: one verified case and one blocked consumer per provider. They
exercise required response data, subscription-state enum widening, and an
explicitly configured value for a required pause request. All target contracts
are pinned upstream excerpts; all three starting adapters are authored. These
are separate from the real Stripe release pair and the 18-case authored corpus.

## Historical Paddle release with a generated client

The [Paddle currency case](../tests/fixtures/paddle-release/README.md) adds two
checks against a two-field subscription projection from published snapshots
bracketing the March 2026 CLP/PEN release. An unedited Orval 8.30.0 generated
client preserves loopback HTTP observations after its model is migrated. An
exhaustive currency-policy consumer blocks until an owner supplies decisions for
the new currencies. Count this separately from the earlier authored Paddle
customer-portal baseline. It is a real contract change with a generated bounded
client, not a full Paddle upgrade or live payment test.

[Observed draft PR delivery](delivery-evidence.md) records the GitHub workflow run.
[Customer validation](customer-validation.md) describes the proposed pilot; no
customer results have been measured.

## Monitor preparation checks

On 2026-09-09, the four configured public sources were downloaded and pinned.
Their captured raw snapshots were then replayed through the monitor in separate
clean Git checkouts, with real filesystem writes and configured application checks.
All four prepared a verified patch. After committing each patch in its disposable
checkout, a second poll returned `unchanged`. No PR was published by this check.

| Provider | Captured upstream revision | Application observation |
| --- | --- | --- |
| Stripe | `32561ba834b5e1ec2e2725052b76ba9944180673` | Active label and true/null cancellation flag |
| Paddle | `540ea17369325ff866b65ecf6c5105592f16fb5d` | Existing customer-portal cancellation URL |
| Chargebee | `2c7ce2c8a72c7393bece50ff418033130bdc9591` | Active subscription view |
| Recurly | `0dcfa5b9f620071c5c5b4a6c236fe85198fae600` | Explicit one-cycle pause request |

These checks use the [authored example adapters](../examples/README.md), not customer
applications or live billing accounts. Regression tests also exercise failed-check
recovery, retained diagnostics, provider retries, publication retries after base
advancement, and notice deduplication through the public monitor/publisher CLIs.
The [monitoring guide](monitoring.md) describes scope and operational limits.
