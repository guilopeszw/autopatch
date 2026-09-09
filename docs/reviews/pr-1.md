# PR #1 review

Reviewed head: `3fc998553c5c6d7eedb4c8d9f7ce7354c9a44a2d`.
Fixed point: `2fb65a5c7432fd953a4c322431531dce35fc8ae5`.
Captured comparison: `git diff 2fb65a5c7432fd953a4c322431531dce35fc8ae5...HEAD`.
Standards and Spec were reviewed independently by parallel agents. The spec
source was the user's original AutoPatch mission and the accepted first-increment
scope; standards came from AGENTS.md and README.md, with the skill's smell baseline.

## Standards

**P1 — Explicit compiler options bypassed the strict migration gate.**
The planner and writer set `strict: true` but retained explicit suboptions such as
`strictNullChecks: false`. This violated the documented strict baseline and
AGENTS.md's compiler-gate requirement. A nullable-to-non-nullable migration could
report verified while leaving a consumer supplying null.

Fixed in `782bc00`: one shared compiler policy explicitly enforces strict
suboptions at both gates and in the public checker, restoring the caller's options
afterward. Regression tests cover planning and persistence. The Standards reviewer
independently reproduced the fix: TS2322, no patch, original source/options restored.
No other baseline smells justified changes under the repo's minimal-abstraction rule.

## Spec

**P1 — Optional-property renames silently lost values.**
The mission requires deterministic mechanical updates. Given
`Input { id: string; name?: string }` and an inferred producer
`const input = { id: '1', name: 'Ada' }; submit(input)`, renaming the bound property
changed only the SDK's field access. The consumer still supplied `name`; the
result changed from `Ada` to undefined despite zero compiler diagnostics.

Fixed by checking contextual structural flows before a symbol rename. Producers
not covered by the language-service rename now block the transaction. Regressions
include direct arguments, nested objects, arrays, callbacks, indexed containers,
and any-valued flows. The independent reviewer confirmed the direct fix and
identified an indexed-container variant, which received its own failing regression
and fix. This conservatively rejects uncertain flows rather than guessing them.

The original 90% deterministic-coverage target remains a measurement target,
not an established production statistic. The next evaluation corpus supplies an
explicit denominator and separates safe rejection from successful migration.
No other verified spec defects or scope creep were reported.

Standards: 1 P1 finding, fixed (strict gate bypass). Spec: 1 P1 finding, fixed
(optional-property semantic corruption, including indexed-container variants).
