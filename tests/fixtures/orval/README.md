# Pinned generated SDK integration

Upstream: [Orval v8.30.0](https://github.com/orval-labs/orval/tree/fd3c00d363981267f9a0f5625683ae3d40ad4ff4/samples/next-app-with-fetch),
commit `fd3c00d363981267f9a0f5625683ae3d40ad4ff4`.

`upstream/` contains exact copies of the generated Petstore fetch client, all its
models, its custom fetch adapter, generator configuration, original OpenAPI YAML,
and the repository MIT license. `provenance.json` records their SHA-256 digests;
the integration test checks every digest before running. No generator dependency
or upstream download is needed to run tests or CI.

`v1.json` is a semantic JSON conversion of the upstream YAML. `v2.json` changes
only GET `/pets` operationId from `listPets` to `fetchPets`. This target revision
is authored for the migration scenario; it is not claimed to be a released Orval
API revision. Consumer, barrel, environment declaration, bindings and tsconfig
are AutoPatch-owned test scaffolding. The ambient declaration supplies only the
adapter's `process.env.NODE_ENV`; the target uses strict compilation and DOM types.

Run `npm run test:integration` from the repository root. The test copies the whole
fixture to a temporary directory and exercises the public CLI in preview and write
modes. A real ephemeral loopback HTTP server returns a literal Petstore response.
The child process forwards only the upstream adapter's hard-coded localhost:3000
origin to that server; any other origin is rejected. It executes the trusted
consumer before and after migration, asserting HTTP method, path/query, status,
response names, unchanged consumer alias, zero diagnostics and zero model rounds.
No arbitrary target project or model-generated code is executed.

This is one independently generated SDK case, measured separately from the curated
corpus. It proves this pinned operation rename and transport observation, not full
Orval support, complete schema migration coverage, or live provider quality.

To inspect provenance independently, checkout the pinned Orval commit and compare
the files under `samples/next-app-with-fetch/` with `upstream/` (license comes from
the upstream repository root). The included generator configuration records how
Orval produced its client; regenerating it is not required for this vendored test.
