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

## Fresh review of the final PR head

Pinned head: `84ae148db43e3a581bdbdab0c2df34e86e965eaa`.
Base: `fc8e96167cd6e098281253b8373ddc5fac67f0cc`.
Command: `git diff fc8e96167cd6e098281253b8373ddc5fac67f0cc...84ae148db43e3a581bdbdab0c2df34e86e965eaa`.
Two independent reviewers used AGENTS.md, README.md, the mission and PR scope.
The findings above were already resolved at this pinned head.

### Standards

No new documented-rule breaches or actionable Fowler smells found.

### Spec

**P1 — Nullable enum lowering admitted a forbidden configured null.** The PR
promises to check configured values against the destination contract. With
`type: string`, `nullable: true`, `enum: ["eu", "us"]` and a configured null, the
planner returned a verified patch because enum lowering appended null. In
[OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3.html#fixed-fields-20), nullable
widens the scalar type while other constraints still apply. Enum can exclude null.

Fixed at the shared schema-to-type boundary: enum output contains exactly its
validated enumerated values. A failing rejection regression now passes; a paired
runtime fixture verifies that explicitly enumerated null still migrates correctly.
Both use the same public migration runner and in-memory compiler as the CLI.

Fresh review: Standards 0 findings. Spec 1 finding, worst P1, fixed.
