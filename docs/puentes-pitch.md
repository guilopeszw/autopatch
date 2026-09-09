# Presenting AutoPatch to Puentes

## The claim

**AutoPatch maintains TypeScript integrations with subscription-billing APIs,
turning supported contract changes into reviewable, compiler-verified patches.**

The customer hypothesis is a software team maintaining billing integrations as
providers change their contracts. The engineer supplies the old/new schema and
explicit SDK bindings. AutoPatch maps the change to symbols, applies deterministic
AST edits, and proposes a patch only after the entire project type-checks in memory.
Its output is a maintenance pull request and evidence for the reviewer.

Subscription billing gives the generic engine a concrete application: subscription
states, customer portal links, cancellation data, and pause requests. It does not
make AutoPatch a billing processor, reconciliation system, or authority on pricing,
proration, entitlements, or revenue correctness. Those decisions remain in the
application and its tests. Commercial demand is a hypothesis, not a measured result.

## Three-minute demonstration

| Time | Show | Explain |
| --- | --- | --- |
| 0:00–0:25 | One-sentence claim and a subscription consumer | An API contract change can break the code around billing. The unit of value is a reviewed integration update. |
| 0:25–1:15 | Stripe Acacia → Basil report, contract provenance, bound interface, before/after code | These are published changes projected onto five fields. AST edits remove retired fields and update cancellation nullability; the full in-memory project must compile. |
| 1:15–1:50 | Blocked Stripe consumer test | Reading the removed billing period produces a compiler error. Choosing a replacement subscription item's period needs product policy; AutoPatch leaves the files unchanged. |
| 1:50–2:20 | Four-provider evidence table | Paddle, Chargebee, and Recurly exercise the same engine with pinned target contracts and authored starting adapters. These are bounded cases, not complete integrations. |
| 2:20–3:00 | Report and GitHub workflow; source for the compiler gate | The delivery surface is reviewable code with evidence. Explain the verified path, failure path, and next measured experiment. |

Generate a fresh report without editing fixtures:

```sh
AUTOPATCH_DEMO_DIR=$(mktemp -d)
npm run autopatch -- \
  --from tests/fixtures/stripe/v1.json \
  --to tests/fixtures/stripe/v2.json \
  --project tests/fixtures/stripe/project/tsconfig.json \
  --bindings tests/fixtures/stripe/project/bindings.json \
  --report "$AUTOPATCH_DEMO_DIR/stripe.html"
open "$AUTOPATCH_DEMO_DIR/stripe.html"
npm test -- tests/stripe-release.test.ts tests/subscription-billing.test.ts --reporter=verbose
```

The tests use temporary projects for writes. The report represents a verified
plan, not proof that it was persisted. If showing a GitHub migration PR, use an
actual successful workflow run and its artifacts; a checked-in workflow alone
does not establish that PR publication works. Workflow setup is documented in
[schema-migration-workflow.md](schema-migration-workflow.md).

## Evidence to put beside the pitch

- [Real Stripe release case](../tests/fixtures/stripe/README.md): a successful
  bounded migration and a blocked consumer, with upstream provenance.
- [Four-provider scope](../tests/fixtures/billing/README.md): exact contracts,
  positive and negative cases, and explicit limits for each provider.
- [Evaluation protocol](evaluation.md): the authored corpus denominator,
  generated SDK evidence, and runtime observations counted separately.
- [Review findings and repairs](reviews/pr-8.md): engineering judgment includes
  reproducing a failure and checking the next migration, not just the first one.

Do not claim production-wide 90% coverage, full SDK compatibility, live model
quality, or proven customer savings. Compiler success establishes type consistency;
the small behavioral fixtures establish only their specified observations.

## Questions the candidate should be able to answer

1. **Why ASTs?** Symbols distinguish aliases from unrelated names. AST edits can
   preserve local shorthand variables while changing the serialized property key.
2. **Why explicit bindings and rename hints?** Similar names or shapes do not
   establish identity. Unknown or ambiguous changes must remain review decisions.
3. **Why check the whole project?** A local edit can break distant consumers.
   The gate uses `Project.getPreEmitDiagnostics()` against unsaved source.
4. **Why can compilation still miss a billing bug?** A valid boolean or number
   can encode the wrong policy. Explain the behavioral checks and their limits.
5. **Where is the LLM allowed?** Opt-in repair of affected call expressions with
   only the expression and diff. Accepted output still faces AST and compiler gates.
6. **What happens on failure?** Planning restores source; blocked runs expose no
   writable plan. Persistence rechecks preimages and diagnostics. File replacement
   is atomic per file, not crash-atomic across the project.

## Product sequence after the evaluation

First, validate a second historical billing release against an independently
generated client and meaningful consumer tests. Next, trial the migration workflow
on a consenting team's repository and record attempted changes, verified patches,
manual decisions, false positives, and review time. Keep those measurements separate
from the curated corpus.

The standalone report is the current UI: schema changes, symbol evidence, edits,
and compiler results in one place. A dashboard becomes useful when multiple
repositories need a queue. Slack can later deliver a short finding and PR link;
it does not improve migration correctness and is not required for this demonstration.

[Puentes' public page](https://puentes.antigravity.capital/) describes engineering
review of a candidate's repository and depth of understanding. Lead with mechanisms,
evidence, and decisions you can explain; the detailed engineering targets in this
repository are our project goals, not a quoted public scoring rubric.
