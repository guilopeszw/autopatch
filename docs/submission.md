# Puentes walkthrough

Use Node 24. Install once with `npm ci`, then run:

```sh
npm run typecheck
npm test
npm run demo
npm run evaluate
```

The demo is a preview: two schema changes, two changed files, zero compiler
errors, zero LLM rounds. Show `npm run demo -- --json` to inspect exact source
edits. It renames an operation through an import alias and renames a request
property while preserving the local shorthand variable.

The evaluation report distinguishes nine completed migrations from eight safe
rejections. It checks literal runtime observations as well as compiler diagnostics.
For structured output, use `npm run evaluate -- --json`. The denominator and
limitations are in [evaluation.md](evaluation.md); do not present 17 passing
expectations as 17 completed migrations or claim 90% production coverage.

## Code to inspect

1. `src/core/diff/openapi-differ.ts`: explicit change classification and rename
   provenance; unsupported changes block the whole migration.
2. `src/core/ast/callsite-finder.ts` and `codemod-builder.ts`: symbol references,
   language-service rename, AST property edits, and explicitly configured required
   values. `rename-safety.ts` guards structural flows a symbol rename misses.
3. `src/core/runner/type-checker.ts`: `Project.getPreEmitDiagnostics()` and strict
   suboption enforcement. `migration.ts` stages edits and restores every preview.
4. `src/core/agent/llm-fixer.ts`: bounded call-expression replacement with exactly
   `{ snippet, changes }` as dynamic context and a full-program compiler gate.
5. `src/core/runner/patch-writer.ts`: fresh verification, preimage checks, staged
   per-file writes and rollback. Whole-project crash atomicity is not claimed.

The [PR #1 review](reviews/pr-1.md) records two reproduced P1 bugs and regression
fixes: permissive compiler flags bypassing strictness, and optional-property
renames losing a runtime value despite a clean compiler result.

## Optional live provider smoke

This makes a real, potentially billable provider request. It is excluded from
tests and CI. Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in the environment or
ignored `.env.local`. Choose an API model ID available to that account. Never put
keys into CLI arguments, tracked files, or the report.

```sh
npm run smoke:llm -- --llm openai --model YOUR_API_MODEL_ID
# Alternatively:
npm run smoke:llm -- --llm anthropic --model YOUR_API_MODEL_ID
```

The fixture changes `Input.count` from string to number. The provider sees only
`submit({ count: "3" })` and that property diff. The command uses one attempt, a
30-second request timeout, and preview mode. It never executes the returned code
or writes the fixture. It reports a verified plan only after zero compiler errors;
provider refusal or an invalid repair exits nonzero. This small conversion tests
transport and isolation, not complex business-logic quality.

Running the command without `--llm` makes no request and reports the expected
compiler block. A regular Vitest CLI test replaces only external HTTP and verifies
the exact dynamic payload, one repair attempt, a compiler-valid plan and unchanged
fixture files. That test is **not evidence of a successful live provider call**.
Record provider, model, date, status and repair rounds after an actual live run;
live validation is pending until credentials and model configuration are supplied.

## Submission access

The repository is private. Confirm the committee's GitHub identities and grant
them access before submission. Keep subsequent work in focused Conventional
Commits and review it through pull requests.
