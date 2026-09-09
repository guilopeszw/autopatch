# Evaluation protocol

Run `npm run evaluate` for the readable report or `npm run evaluate -- --json`
for per-case results and literal runtime observations. Exit 1 means an expectation
failed. No provider is configured on this path, and CI runs it without API keys.

The corpus contains **17 curated cases: 9 completed migrations, 8 expected
rejections, 17 passing expectations, and 0 LLM requests**. The completed-migration
fraction is **9/17 (52.9%)** across this deliberately mixed acceptance/rejection
set. Safe rejection counts toward correctness, never toward migration coverage.
These small, repository-authored examples do not establish the mission's 90%
production coverage target or represent a sampled population of real projects.

| Case | Expected behavior | Runtime observation |
| --- | --- | --- |
| Operation rename through a barrel and import alias | Complete | `person:42` preserved |
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
is only for reviewed, repository-owned fixtures. AutoPatch never executes arbitrary
target projects or LLM-generated code. The fixtures do not measure real HTTP server
behavior, latency, provider quality, or compatibility with every SDK generator.

## Extending the evidence

Add one failing case at a time through the agreed migration boundary, then
implement its smallest deterministic fix. Preserve cases that must fail safely.
Include literal runtime outcomes, not merely compiler success. Expand to actual
versioned SDK/client projects before making general coverage claims, and report
their selection criteria and denominator separately from this curated corpus.

Provider integration is a separate opt-in smoke test described in
`docs/submission.md`. A stubbed HTTP test establishes request isolation and the
compiler gate; it does not establish live model behavior.
