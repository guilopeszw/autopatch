# Review: real contracts, reports, and migration PRs

Baseline: release snapshot `01d4194056dc2c3fc9eb1f4b4e1cfc121b9a8428`.
Initial reviewed head: `ac24462`. Fix reviewed independently: `3bac14b`.
Two independent agents reviewed Standards and Spec using the code-review skill.

## Standards

The original review found one documented-invariant violation: PR preparation
advanced the source and schema baseline after an operation rename but left
operation bindings stale, contrary to the README's next-migration requirement.
No smell judgments warranted changes.

The follow-up found no remaining Standards issues. Operation keys and export
names now advance with the baseline, unrelated fields are preserved, duplicate
destination keys are rejected before persistence, and binding/schema preimages
are checked. The reviewer independently ran all three automation tests.

## Spec

The original review reproduced a second supported rename failing with a missing
binding after the first rename had succeeded. The unchanged-target rerun test did
not exercise that failure.

The follow-up found no remaining Spec issues. The test now covers
`createUser → registerUser → enrollUser`, with an intermediate no-op run, plus
blocked migrations and rejection of untracked patches. All three automation
tests passed independently.

Final findings: Standards 0; Spec 0. The review is bounded to these commits and
does not establish production coverage, live-provider behavior, or business
correctness.
