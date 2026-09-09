# Working on AutoPatch

- Keep changes focused. Use Conventional Commits and feature branches; deliver
  changes through pull requests. Do not push feature work directly to `main`.
- Use ts-morph and its bundled native TypeScript compiler for AST work. Do not
  replace source with regex codemods or spawn shell `tsc` for validation.
- Run `npm run typecheck`, `npm test`, and `npm run demo` before declaring a
  feature complete. `typecheck` uses `Project.getPreEmitDiagnostics()` in memory.
- Follow test-first vertical slices. The user has confirmed these public test
  boundaries: call-site discovery, schema diffing, deterministic codemods,
  compiler-gated migration/persistence, isolated LLM repair, and the CLI.
- Prefer real AST projects and filesystem fixtures. Mock only external provider
  transport or targeted filesystem failures. Tests must not make paid model calls.
- Never send whole files or unrelated diagnostics to a model. The dynamic request
  contract is exactly the affected call expression and target schema changes.
- A failed or unsupported migration must leave source files unchanged. Do not
  weaken compiler checks to force a repair through. Preserve concurrent user edits.
- Keep abstractions small, document public boundaries and limitations, and add
  dependencies only when existing platform capabilities do not cover the need.
