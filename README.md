# AutoPatch

**Turn supported billing API changes into compiler-verified TypeScript patches.**

Give AutoPatch an old and new OpenAPI schema, your TypeScript project, and a map
of API symbols to local exports. It updates supported declarations and consumers
with **ts-morph AST edits**, checks the entire project in memory, and produces
an exact patch for review. Preview is the default; writing changes is explicit.

The engine is provider-independent. Examples focus on Stripe, Paddle, Chargebee,
and Recurly subscription contracts; they cover selected changes, not entire SDKs.

## Try it

Requires **Node.js 24** and npm. From this checkout:

```sh
npm ci
npm run demo               # preview the included fixture; no source writes
npm run demo -- --json     # inspect exact before/after edits
```

The demo renames `createUser` → `registerUser` and `name` → `displayName` across
a typed request and its consumer. Import aliases and local variables are preserved;
unrelated properties with the same name remain unchanged.

To inspect a billing example in a browser:

```sh
AUTOPATCH_REPORT_DIR=$(mktemp -d)
npm run autopatch -- \
  --from tests/fixtures/stripe/v1.json \
  --to tests/fixtures/stripe/v2.json \
  --project tests/fixtures/stripe/project/tsconfig.json \
  --bindings tests/fixtures/stripe/project/bindings.json \
  --report "$AUTOPATCH_REPORT_DIR/stripe.html"
```

Open the generated HTML file. It shows schema changes, symbol references, source
edits, and compiler findings. No server or account is needed.

## What it handles

- **Mechanical changes:** operation renames, explicit property renames, and direct
  interface property additions, removals, type changes, and requiredness changes.
- **Verification:** both the original and patched project must pass strict native
  TypeScript diagnostics. Unsupported changes or unresolved errors block the patch.
- **Delivery:** JSON/HTML review reports, optional verified writes, and a GitHub
  workflow that opens draft migration PRs from checked-in schema updates.
- **Optional AI:** bounded repair of affected call expressions, with only the
  expression and schema diff as context. Disabled by default.

AutoPatch does not poll providers, upgrade whole SDKs, process payments, choose
billing policy, or merge/deploy changes. **Compilation proves type consistency,
not business correctness.** Run your application's tests and review the patch.

## Documentation

| Need | Read |
| --- | --- |
| Use your own project; check supported schemas, flags, and recovery | [CLI guide](docs/usage.md) |
| Review a patch in the browser | [HTML reports](docs/review-report.md) |
| Create migration PRs in GitHub Actions | [Workflow setup](docs/schema-migration-workflow.md) |
| See exact provider coverage | [Examples](examples/README.md) |
| Inspect test results, historical cases, and limitations | [Test evidence](docs/evaluation.md) |
| Understand or contribute to the implementation | [Architecture](docs/architecture.md) |
