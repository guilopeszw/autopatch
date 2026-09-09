# PR #2 follow-up review

Reviewed diff: `git diff feat/migration-engine...fed79b5`.
Two independent reviewers checked the evaluation corpus, configured required
values and opt-in provider smoke against AGENTS.md, README.md and the mission.

## Standards

**P1 — A configured default overwrote a supplied computed property.**
For `const key: string = "region"; const input: Input = { [key]: "us" }`, the
named-property lookup missed the existing runtime field. Inserting `region: "eu"`
violated the documented preservation of existing values while passing compilation.
Fixed in `83d1f10` and `61f24a0`: unresolved computed names block insertion; literal
names remain supported, including those created by earlier AST edits. The corpus
checks safe rejection and successful insertion of multiple configured values.

## Spec

**P1 — Computed-key overwrite violated deterministic value preservation.**
The Spec reviewer independently reproduced the same computed-property defect.
The regression and guard above resolve it at the shared insertion boundary.

**P2 — Fractional configured values passed an integer contract.**
TypeScript represents OpenAPI `integer` as `number`, so a configured `1.5` passed
the compiler and was inserted into a required integer field. Fixed in `a00d498`:
validate the known literal's integrality before lowering, unless the schema also
explicitly permits `number`. The fractional-value corpus case now rejects with
original sources restored and no exposed patch. This does not claim validation
of arbitrary runtime inputs beyond TypeScript's type system.

Counts remain honest: completed migrations and expected rejection cases are
reported separately. The offline corpus installs no provider. Live validation
is pending configuration and is not implied by the stubbed HTTP test.

Standards: 1 finding, worst P1, fixed. Spec: 2 findings, worst P1, both fixed.
