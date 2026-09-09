# CLI guide

[Overview](../README.md) · [Architecture](architecture.md) · [HTML reports](review-report.md)

## Run against your project

Use Node 24 and run `npm ci` in the AutoPatch checkout. Supply two OpenAPI
**3.0.x / 3.1.x JSON** revisions, a target tsconfig, and bindings to local exports:

```sh
npm run autopatch -- \
  --from /path/to/api-v1.json --to /path/to/api-v2.json \
  --project /path/to/app/tsconfig.json \
  --bindings /path/to/app/bindings.json \
  --json
```

Preview is the default. Inspect the exact before/after source, then repeat with
`--write` to persist a freshly verified plan. Run your application's tests before
merging. The CLI does not create commits; [GitHub delivery](schema-migration-workflow.md)
adds branches and draft PRs.

## Bindings

Paths in the bindings file are relative to the target tsconfig directory.
Operation bindings identify local exported function declarations or directly
exported variables with an arrow-function initializer, such as `export const createUser = (input: Input) =>
input.id`. Schema bindings identify exported interface declarations. Bindings refer
to the **old** revision. Separate export lists for arrow variables, factory-created
functions, function expressions, re-export aliases used as the binding itself,
and class methods are not resolved as operation
bindings; bind the supported declaration in its defining SDK file.

```json
{
  "operations": {
    "createUser": { "file": "src/api.ts", "export": "createUser" }
  },
  "schemas": {
    "CreateUser": { "file": "src/api.ts", "export": "CreateUser" }
  }
}
```

Use a local SDK contract under the project root; AutoPatch does not mutate
`node_modules`. Successful migrations require the bound old declarations to
exist. Update the schema baseline and bindings for the next migration; replaying
a stale migration against an already migrated SDK is rejected instead of guessed.

Call-site discovery recognizes direct identifier and dotted member calls,
including aliased imports. It does not perform runtime data-flow analysis through
assigned callbacks, `bind`/`call`/`apply`, dynamic keys, or constructors. Discovery
is limited to loaded source files and resolvable dependencies. Symbol rename
coverage can exceed call-site repair coverage; unresolved cases still face the
compiler gate. Rename collision detection conservatively rejects a destination
name already used in a referencing file.

## Supported changes

| Change | Behavior |
| --- | --- |
| `operationId` renamed on the same method/path | Rename the bound local function declaration or exported arrow variable and its symbol references |
| Property renamed with explicit provenance | Rename the bound interface property and resolved references |
| Direct property added/removed | Add/remove the interface member; compiler errors block incompatible consumers |
| Property type or requiredness changed | Update the interface type and optional marker; validate every consumer |
| Required field with an explicit binding value | Insert a type-checked scalar into directly typed object literals when missing |
| Scalar and array property types | `string`, `number`, `integer`, `boolean`, `null`, nullable unions, scalar enums, recursively typed arrays |
| Broken bound API calls | Optional isolated LLM repair, with bounded attempts and timeouts |
| Unknown runtime contract changes | Report as unsupported and block the entire migration |

**Explicit property provenance** belongs on the destination field:

```json
{
  "displayName": {
    "type": "string",
    "x-autopatch-previous-name": "name"
  }
}
```

Without that extension, removal and addition remain separate changes. AutoPatch
never infers a rename because two fields look similar. Ambiguous hints and rename
collisions are rejected. A required new property does not acquire an invented
business default.

To supply an intentional value for a required field, add `defaults` to its schema
binding, for example:

```json
{ "file": "src/api.ts", "export": "CreateUser", "defaults": { "region": "eu" } }
```

These are operator-provided migration values, independent of OpenAPI's `default`
keyword. AutoPatch checks each against the destination TypeScript type, inserts
it through AST property assignments, and preserves existing fields. Values must
be finite JSON scalars; configured integer values must also be whole numbers.
Insertion requires a direct contextual reference to the bound interface; ambiguous
spreads, computed keys and unsupported producers require manual work. This also
applies to a field becoming required. TypeScript models OpenAPI integers as
`number`; it does not validate arbitrary runtime inputs for integer/range constraints.

The supported input format is OpenAPI **3.0.x / 3.1.x JSON**. This is a focused
migration parser, not a complete OpenAPI validator or SDK generator. Endpoint
additions/removals, parameter/response transport changes, schema additions/removals,
changed server/security settings, compositions, nested object property updates,
property `$ref` changes, and unrepresentable constraints require manual work.
Documentation-only changes at recognized metadata positions are ignored;
unrecognized differences are handled conservatively.

## Flags and exit codes

| Flag | Purpose |
| --- | --- |
| `--from`, `--to` | Required old/new OpenAPI JSON files |
| `--project` | Target tsconfig; defaults to `tsconfig.json` |
| `--bindings` | Required explicit SDK symbol map |
| `--dry-run` | Explicit preview; also the default |
| `--write` | Persist a compiler-verified plan |
| `--check` | Return 1 when verified edits remain, without writing |
| `--json` | Structured report with changes, exact files, diagnostics and LLM rounds |
| `--report <file.html>` | Create a standalone review of the migration plan; destination must not exist |
| `--llm`, `--model` | Opt-in provider and explicit model ID |
| `--max-attempts`, `--timeout-ms` | Repair bounds |
| `--help`, `--version` | CLI metadata |

Exit **0** means a verified preview/write, or a clean `--check`. Exit **1** means
blocked migration or pending edits under `--check`. Exit **2** means invalid CLI
input, setup failure, or a persistence error. Conflicting write/preview/check
flags are rejected.

## Optional LLM repair

The deterministic path makes **no model requests**. To enable a provider, supply
an API key in its normal environment variable, choose an actual model available
to your account, and explicitly pass the provider and model:

```sh
# Set OPENAI_API_KEY using your normal secret-management workflow.
npm run autopatch -- --from v1.json --to v2.json \
  --project ./target/tsconfig.json --bindings ./bindings.json \
  --llm openai --model "$AUTOPATCH_MODEL" --max-attempts 2 --timeout-ms 30000
```

Use `--llm anthropic` with `ANTHROPIC_API_KEY` for Anthropic. AutoPatch does not
assume that a model label from a desktop application is an API model identifier.

The transport sends a static instruction and exactly `{ snippet, changes }`.
It has no file access, tools, conversation history, or surrounding source.
Retries begin from the original snippets and never add full diagnostics or files
to the model context. Insufficient context can legitimately leave a migration
blocked. OpenAI requests use `store: false`; provider data policies still apply.

Limits: 1–5 repair rounds, 1–120000 ms per request, 16000 characters per snippet
and response expression, 64000 characters per diff, and a 128000-byte HTTP body
limit. Truncated responses, refusals, HTTP failures, invalid ASTs, and unresolved
compiler errors fail closed. Tests replace only the external HTTP boundary; they
do not make paid model calls. Live provider quality is not established by them.

### Check a live provider

Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in your environment or ignored
`.env.local`, then choose an API model ID available to your account:

```sh
npm run smoke:llm -- --llm openai --model YOUR_API_MODEL_ID
# Or: npm run smoke:llm -- --llm anthropic --model YOUR_API_MODEL_ID
```

This optional, potentially billable check sends only `submit({ count: "3" })`
and a string-to-number property diff. It allows one attempt with a 30-second
timeout, never executes the result, and leaves the fixture unchanged. Without
`--llm`, it makes no request and reports the expected compiler block. Tests and
CI use stubbed transport; live model quality remains unmeasured.

## Writes and recovery

Writes use an exclusive `.autopatch.lock`, verify original source content, stage
new files and recovery copies beside each destination, and rename replacements
into place. Existing user edits, duplicate destinations, symlink files, writes
outside the project, and compiler-invalid plans are rejected. Ordinary replacement
errors roll back files already written. If an editor changes a newly written file
before rollback, preserve that edit and retain the original recovery copy.
Cleanup failures after a successful write are reported separately as warnings.

The transaction is **atomic per file, not across the whole project**. A killed
process, power failure, or concurrent non-cooperating editor can interrupt the
operation. A durable journal and editor coordination are outside this version.
After an interrupted write, inspect Git status and `.autopatch-*.bak` recovery
copies before removing a stale lock. Never remove another running process's lock.
The CLI does not create a Git commit. The optional GitHub workflow wraps it in a
branch and draft PR; review changes and run the target application's tests before
merging.
