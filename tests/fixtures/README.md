# Fixtures

Store OpenAPI v1/v2 schema pairs and target TypeScript projects here when their
modules receive their first behavior tests. Target projects may intentionally
contain migration errors, so they are excluded from the repository tsconfig.

Call-site discovery tests should create real ts-morph Projects in memory, with
small source modules that expose symbol identity, import aliases, and shadowing.
