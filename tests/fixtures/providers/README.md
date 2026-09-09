# Provider-independent contract cases

AutoPatch has no provider switch or provider-specific codemods. These cases run
the same CLI, AST transformations, compiler gate, persistence, and HTML report
against Brex and Ramp contracts.

| Provider | Published target component | Incomplete local adapter | Outcome |
| --- | --- | --- | --- |
| Brex | Team API `Address` | Missing optional nullable `phone_number` | Add the field; preserve the city display |
| Ramp | `ApiTransactionCardHolder` | Missing optional `employee_id` | Add the field; preserve the first-name display |

For each provider a second test supplies a numeric local field and a consumer
using `toFixed`. Aligning that field with the published string contract blocks
with TS2339 and leaves source unchanged. No domain-specific repair is inferred.

## Provenance and limits

- Brex source: https://developer.brex.com/_bundle/openapi/team_api.yaml
- Ramp source: https://docs.ramp.com/openapi/developer-api.json

Retrieved September 9, 2026. Each `target.json` preserves the complete selected
component object, while omitting other components, paths, and document metadata.
`provenance.json` records the original download hash and checked-in hashes. Brex's
YAML was parsed using Ruby's standard Psych safe loader and serialized as JSON;
no schema property was rewritten. The live source URLs are mutable: the hashes
identify the captured source, not a guarantee of future reproducibility from
those URLs. The minimal schema excerpts remain attributable to their providers.

**These are adapter-alignment cases, not historical API release migrations.**
The baseline intentionally omits a real optional field; it is authored, as are
the TypeScript adapters and observations. We do not claim the providers ever
published that baseline. Stripe's separately documented case supplies historical
release evidence. No full Brex/Ramp SDK, authentication, live account access, or
financial operation is implemented or tested here.

```sh
npm test -- tests/provider-contracts.test.ts
npm run autopatch -- --from tests/fixtures/providers/brex/baseline.json --to tests/fixtures/providers/brex/target.json --project tests/fixtures/providers/brex/project/tsconfig.json --bindings tests/fixtures/providers/brex/project/bindings.json --report /tmp/brex-review.html
npm run autopatch -- --from tests/fixtures/providers/ramp/baseline.json --to tests/fixtures/providers/ramp/target.json --project tests/fixtures/providers/ramp/project/tsconfig.json --bindings tests/fixtures/providers/ramp/project/bindings.json --report /tmp/ramp-review.html
```

The tests copy adapters to temporary directories before writing. Keep the
checked-in baselines unchanged. Any other provider with supported OpenAPI 3.0/3.1
changes and suitable local TypeScript bindings uses the same entrypoint; that is
an architectural capability, not a claim of universal compatibility.
