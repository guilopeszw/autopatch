# First customer validation

## Hypothesis and participant

A team with a TypeScript billing integration spends enough time diagnosing and
repairing provider contract changes to value compiler-verified migration PRs.
This has not been validated with a customer. The first participant should own a
working Stripe, Paddle, Chargebee, or Recurly integration and be able to describe
a recent migration and its actual review process.

## Thirty-minute session

1. Ask for their last contract or SDK upgrade: what changed, who found the break,
   what failed, and how much engineering/review time it took. Ask for a concrete
   example before showing AutoPatch. Record estimates as estimates.
2. Show the real Stripe/Paddle cases and a blocked policy decision. Ask what they
   would need in the report before trusting it enough to review the patch.
3. With explicit permission, choose one past migration in a disposable checkout.
   Run a baseline check, attempt the supported diff, inspect the report, and run
   their existing behavioral tests. Do not use production credentials or deploy.
4. Compare the patch with their actual solution. Count incorrect edits, useful
   edits, missing changes, and manual policy decisions. Record time to configure
   bindings separately from time saved during migration.
5. Ask whether they would try the next real update and what concrete commitment
   they would make: supply a case, run a pilot, or discuss a budget. Interest alone
   is not willingness to pay.

## Measurements

For every attempted migration record: provider, old/new revisions, selected
scope, compiler baseline, supported/unsupported changes, completed/blocked result,
review corrections, application-test results, setup minutes, review minutes,
and the participant's estimate of their previous manual effort. Keep all attempts
in the denominator, including failures. Never present safe rejections as automated
migration coverage. Distinguish fixture observations from customer evidence.

Success for this first experiment is one team agreeing that a specific migration
PR is useful enough to try on their next update. It is not a revenue forecast.
If binding setup dominates the work, prioritize onboarding improvements. If
unsupported schema constructs dominate, prioritize those constructs using the
actual cases. Build a shared dashboard or Slack delivery only when the workflow
needs it.

## Outreach draft — not sent

Hi [name] — I'm building AutoPatch, a tool that turns supported billing API
contract changes into reviewable TypeScript patches, checked against the whole
project in memory. It explicitly blocks updates that need a billing-policy
choice. Do you own a Stripe, Paddle, Chargebee, or Recurly integration and have a
recent upgrade we could walk through for 30 minutes? I'd like to understand the
work involved and test whether the patch/report would actually save review time.
We can start with a historical case in a disposable checkout, without production
credentials or deployment access.

No outreach, repository access, customer result, or willingness-to-pay evidence
is claimed until the participant is identified and the session actually happens.
