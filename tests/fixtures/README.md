# Migration fixtures

`openapi-v1.json` and `openapi-v2.json` describe the same `POST /users` operation.
Version 2 renames its operation ID and explicitly renames a required request
property using `x-autopatch-previous-name`.

`target/` is a real TypeScript project with explicit SDK bindings. Its consumer
includes an aliased import, a typed shorthand object, a direct object argument,
and an unrelated same-name property. `npm run demo` previews its migration.

CLI tests copy this project into temporary directories before exercising writes.
Fixture code is excluded from AutoPatch's own tsconfig and is typechecked through
its target Project. Unit tests for AST behavior create their projects in memory.
