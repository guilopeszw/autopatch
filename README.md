# AutoPatch

An AST-driven API migration engine for the Puentes technical evaluation.
Mechanical changes will use deterministic codemods; complex business-logic
repairs will receive only the affected AST node and the target schema diff.
Every generated patch must pass in-memory TypeScript diagnostics before saving
or committing.

## Current scope

This first increment scaffolds the architecture and implements call-site
discovery. Schema diffing, codemods, LLM repair, and the compiler gate are
documented placeholders, not working migration capabilities. The CLI currently
provides help and version output only.

## Development

Use Node.js 24 and npm. Dependency versions are pinned in `package-lock.json`.

```sh
npm ci
npm run autopatch -- --help
# Run only when test execution is requested:
npm test
```

Strict TypeScript settings include checked indexed access and exact optional
properties. ts-morph exposes its bundled native TypeScript compiler as `ts`;
use that instance to keep compiler nodes and options compatible. Future patch
validation must use `project.getPreEmitDiagnostics()`, never a shell `tsc` call.

## Call-site discovery

```ts
import { Project } from "ts-morph";
import { findCallSites } from "./src/core/ast/callsite-finder.js";

const project = new Project({ tsConfigFilePath: "/target/tsconfig.json" });
const declaration = project
  .getSourceFileOrThrow("/target/src/api.ts")
  .getFunctionOrThrow("getUser");

const calls = findCallSites(declaration);
// Each result is a live CallExpression for an eventual deterministic codemod.
```

The public test boundary is `findCallSites(declaration)`, confirmed by the user.
Discovery uses compiler symbol references, including aliased and namespace
imports, and filters for the actual callee. Callback arguments and unrelated
same-name functions are excluded. Output is deduplicated and sorted by source
path and offset, without changing files.

Only direct identifier and dotted member calls are currently recognized.
Parenthesized callees, bracket access, constructors, runtime callback aliases,
and `bind`/`call`/`apply` are outside this increment. Discovery is limited to the
sources loaded into the Project; unresolved dependencies can make it incomplete.

The first Vitest test uses a real in-memory Project and exercises imported calls,
aliases, namespace members, shadowing, unrelated methods, and callback references.
It was written before the implementation. Test execution is intentionally pending
the user's command; a red/green cycle has not yet been observed.

## Module boundaries

| File | Responsibility |
| --- | --- |
| `bin/autopatch.ts` | CLI entrypoint using Commander |
| `src/core/ast/callsite-finder.ts` | Resolve API declarations to direct call expressions |
| `src/core/ast/codemod-builder.ts` | Deterministic AST mutations (scaffold) |
| `src/core/diff/openapi-differ.ts` | Compare schema revisions (scaffold) |
| `src/core/agent/llm-fixer.ts` | Repair complex call sites with isolated context (scaffold) |
| `src/core/runner/type-checker.ts` | Reject patches with compiler errors in memory (scaffold) |
| `tests/fixtures/` | Reserved for schema pairs and target codebases |

API references: [symbol reference discovery](https://ts-morph.com/navigation/finding-references)
and [in-memory diagnostics](https://ts-morph.com/setup/diagnostics).
